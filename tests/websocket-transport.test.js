import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeClientFrame,
  encodeServerError,
  encodeServerResult,
  encodeSyncHint,
  SYNC_WEBSOCKET_PROTOCOL,
} from "../src/sync/webSocketFrames.js";
import { createSyncWebSocketTransport } from "../src/sync/webSocketTransport.js";

const SOCKET_URL = "wss://study.example.test/api/v1/sync/ws";
const BASELINE_ID = "baseline_0123456789abcdef0123456789abcdef";

class FakeTimers {
  #nextId = 1;
  #now = 0;
  #tasks = new Map();

  setTimeout = (callback, delay = 0) => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#tasks.set(id, {
      at: this.#now + Math.max(0, Number(delay) || 0),
      callback,
    });
    return id;
  };

  clearTimeout = (id) => {
    this.#tasks.delete(id);
  };

  advance(milliseconds) {
    const target = this.#now + milliseconds;
    while (true) {
      let nextId;
      let nextTask;
      for (const [id, task] of this.#tasks) {
        if (task.at > target) continue;
        if (!nextTask || task.at < nextTask.at || (task.at === nextTask.at && id < nextId)) {
          nextId = id;
          nextTask = task;
        }
      }
      if (!nextTask) break;
      this.#tasks.delete(nextId);
      this.#now = nextTask.at;
      nextTask.callback();
    }
    this.#now = target;
  }
}

function createFakeWebSocketClass() {
  return class FakeWebSocket {
    static instances = [];

    constructor(url, requestedProtocol) {
      this.url = url;
      this.requestedProtocol = requestedProtocol;
      this.protocol = "";
      this.readyState = 0;
      this.sent = [];
      this.closeCalls = [];
      this.listeners = new Map();
      this.constructor.instances.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    open(protocol = this.requestedProtocol) {
      this.readyState = 1;
      this.protocol = protocol;
      this.dispatch("open");
    }

    message(data) {
      this.dispatch("message", { data });
    }

    remoteClose(code = 1006, reason = "abnormal") {
      this.readyState = 3;
      this.dispatch("close", { code, reason });
    }

    send(message) {
      if (this.readyState !== 1) throw new Error("socket is not open");
      this.sent.push(message);
    }

    close(code, reason) {
      this.closeCalls.push({ code, reason });
      this.readyState = 3;
    }
  };
}

function createHarness(overrides = {}) {
  const timers = new FakeTimers();
  const WebSocketImpl = createFakeWebSocketClass();
  const states = [];
  const transport = createSyncWebSocketTransport({
    WebSocketImpl,
    url: SOCKET_URL,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onStateChange: (state) => states.push(state),
    ...overrides,
  });
  return { timers, WebSocketImpl, states, transport };
}

test("start transitions from stopped through connecting to open", () => {
  const { WebSocketImpl, states, transport } = createHarness();

  assert.equal(transport.getState(), "stopped");
  transport.start();

  assert.equal(transport.getState(), "connecting");
  assert.deepEqual(states, ["connecting"]);
  assert.equal(WebSocketImpl.instances.length, 1);
  assert.equal(WebSocketImpl.instances[0].url, SOCKET_URL);
  assert.equal(WebSocketImpl.instances[0].requestedProtocol, SYNC_WEBSOCKET_PROTOCOL);

  WebSocketImpl.instances[0].open();
  assert.equal(transport.getState(), "open");
  assert.equal(transport.isOpen(), true);
  assert.deepEqual(states, ["connecting", "open"]);
});

test("an upgrade without the negotiated sync subprotocol is rejected", () => {
  const { WebSocketImpl, transport } = createHarness({ random: () => 0.5 });

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open("");

  assert.equal(transport.isOpen(), false);
  assert.equal(transport.getState(), "backoff");
  assert.deepEqual(socket.closeCalls, [{ code: 1002, reason: "invalid_subprotocol" }]);
});

test("request sends a correlated frame and resolves matching protobuf result", async () => {
  const { WebSocketImpl, transport } = createHarness();
  const requestId = "request_0123456789abcdef";
  const requestBytes = Uint8Array.from([1, 2, 3, 255]);
  const responseBytes = Uint8Array.from([9, 8, 7]);

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  const resultPromise = transport.request("exchange", requestBytes, { requestId });

  assert.equal(socket.sent.length, 1);
  assert.deepEqual(decodeClientFrame(socket.sent[0]), {
    version: 1,
    requestId,
    type: "exchange",
    protobuf: requestBytes,
  });

  socket.message(encodeServerResult("exchange_result", requestId, responseBytes));
  assert.deepEqual(await resultPromise, responseBytes);
});

test("sync_hint is delivered without disturbing the active connection", () => {
  const hints = [];
  const { WebSocketImpl, transport } = createHarness({ onHint: (hint) => hints.push(hint) });

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  socket.message(encodeSyncHint({
    baselineId: BASELINE_ID,
    serverCursor: 128,
    serverVersion: 17,
  }));

  assert.deepEqual(hints, [{
    version: 1,
    type: "sync_hint",
    baselineId: BASELINE_ID,
    serverCursor: 128,
    serverVersion: 17,
  }]);
  assert.equal(transport.isOpen(), true);
});

test("inactive activity keeps the socket alive while suppressing requests and hints", async () => {
  const hints = [];
  const { timers, WebSocketImpl, transport } = createHarness({
    onHint: (hint) => hints.push(hint),
  });

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();

  transport.setActivity(false);
  assert.equal(transport.isActivityActive(), false);
  assert.equal(transport.isOpen(), true);
  assert.deepEqual(socket.closeCalls, []);
  assert.deepEqual(decodeClientFrame(socket.sent[0]), {
    version: 1,
    type: "activity",
    active: false,
  });

  await assert.rejects(
    transport.request("exchange", Uint8Array.of(1), { requestId: "request_inactive_0001" }),
    (error) => error.code === "SYNC_PAUSED",
  );
  assert.equal(socket.sent.length, 1);

  socket.message(encodeSyncHint({
    baselineId: BASELINE_ID,
    serverCursor: 128,
    serverVersion: 17,
  }));
  assert.deepEqual(hints, []);

  timers.advance(30_000);
  assert.equal(socket.sent[1], "ping");
  assert.deepEqual(socket.closeCalls, []);
  socket.message("pong");

  transport.setActivity(true);
  assert.equal(transport.isActivityActive(), true);
  assert.equal(transport.isOpen(), true);
  assert.deepEqual(decodeClientFrame(socket.sent[2]), {
    version: 1,
    type: "activity",
    active: true,
  });

  socket.message(encodeSyncHint({
    baselineId: BASELINE_ID,
    serverCursor: 129,
    serverVersion: 18,
  }));
  assert.deepEqual(hints, [{
    version: 1,
    type: "sync_hint",
    baselineId: BASELINE_ID,
    serverCursor: 129,
    serverVersion: 18,
  }]);

  const requestId = "request_reactivated_01";
  const resultPromise = transport.request("exchange", Uint8Array.of(2), { requestId });
  assert.equal(decodeClientFrame(socket.sent[3]).requestId, requestId);
  socket.message(encodeServerResult("exchange_result", requestId, Uint8Array.of(3)));
  assert.deepEqual(await resultPromise, Uint8Array.of(3));
  assert.deepEqual(socket.closeCalls, []);
});

test("an inactive reconnect advertises activity false before reopening", async () => {
  const { timers, WebSocketImpl, transport } = createHarness({ random: () => 0 });

  transport.start();
  const first = WebSocketImpl.instances[0];
  first.open();
  transport.setActivity(false);
  first.remoteClose();

  assert.equal(transport.getState(), "backoff");
  timers.advance(0);
  const second = WebSocketImpl.instances[1];
  assert.equal(transport.getState(), "connecting");
  second.open();

  assert.equal(transport.getState(), "open");
  assert.equal(transport.isOpen(), true);
  assert.deepEqual(second.closeCalls, []);
  assert.deepEqual(second.sent.map((message) => decodeClientFrame(message)), [{
    version: 1,
    type: "activity",
    active: false,
  }]);
  await assert.rejects(
    transport.request("exchange", new Uint8Array(), { requestId: "request_still_inactive" }),
    (error) => error.code === "SYNC_PAUSED",
  );
});

test("heartbeat sends ping and a pong arms the next heartbeat", () => {
  const { timers, WebSocketImpl, transport } = createHarness();

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();

  timers.advance(29_999);
  assert.deepEqual(socket.sent, []);
  timers.advance(1);
  assert.deepEqual(socket.sent, ["ping"]);

  socket.message("pong");
  timers.advance(29_999);
  assert.deepEqual(socket.sent, ["ping"]);
  timers.advance(1);
  assert.deepEqual(socket.sent, ["ping", "ping"]);
  assert.deepEqual(socket.closeCalls, []);
});

test("heartbeat reconnects when pong is not received within ten seconds", () => {
  const { timers, WebSocketImpl, transport } = createHarness({ random: () => 0.5 });

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  timers.advance(30_000);
  assert.deepEqual(socket.sent, ["ping"]);

  timers.advance(10_000);
  assert.equal(transport.isOpen(), false);
  assert.equal(transport.getState(), "backoff");
  assert.deepEqual(socket.closeCalls, [{ code: 4000, reason: "heartbeat_timeout" }]);
});

test("pause and stop close their sockets normally with distinct states", () => {
  const { WebSocketImpl, transport } = createHarness();

  transport.start();
  const first = WebSocketImpl.instances[0];
  first.open();
  transport.pause();
  assert.equal(transport.getState(), "paused");
  assert.deepEqual(first.closeCalls, [{ code: 1000, reason: "sync_paused" }]);

  transport.resume();
  const second = WebSocketImpl.instances[1];
  second.open();
  transport.stop();
  assert.equal(transport.getState(), "stopped");
  assert.deepEqual(second.closeCalls, [{ code: 1000, reason: "sync_stopped" }]);
});

test("abnormal closes use exponential full-jitter backoff before reconnecting", () => {
  const randomValues = [0.25, 0.75];
  const { timers, WebSocketImpl, transport } = createHarness({
    random: () => randomValues.shift(),
  });

  transport.start();
  const first = WebSocketImpl.instances[0];
  first.open();
  first.remoteClose();
  assert.equal(transport.getState(), "backoff");

  timers.advance(249);
  assert.equal(WebSocketImpl.instances.length, 1);
  timers.advance(1);
  assert.equal(WebSocketImpl.instances.length, 2);
  const second = WebSocketImpl.instances[1];
  assert.equal(transport.getState(), "connecting");

  second.open();
  second.remoteClose();
  assert.equal(transport.getState(), "backoff");
  timers.advance(1_499);
  assert.equal(WebSocketImpl.instances.length, 2);
  timers.advance(1);
  assert.equal(WebSocketImpl.instances.length, 3);
  assert.equal(transport.getState(), "connecting");
});

test("RATE_LIMITED rejects its RPC with retryAfterMs and keeps the socket open", async () => {
  const { WebSocketImpl, transport } = createHarness();
  const requestId = "request_rate_limited_01";

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  const resultPromise = transport.request("exchange", new Uint8Array(), { requestId });
  socket.message(encodeServerError({ requestId, code: "RATE_LIMITED", retryAfterMs: 12_500 }));

  await assert.rejects(resultPromise, (error) => {
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.retryAfterMs, 12_500);
    return true;
  });
  assert.equal(transport.isOpen(), true);
  assert.deepEqual(socket.closeCalls, []);
});

test("AUTH_REQUIRED rejects the RPC, stops reconnecting, and notifies the caller", async () => {
  const authErrors = [];
  const { timers, WebSocketImpl, transport } = createHarness({
    onAuthRequired: (error) => authErrors.push(error),
  });
  const requestId = "request_auth_required_01";

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  const resultPromise = transport.request("exchange", new Uint8Array(), { requestId });
  socket.message(encodeServerError({ requestId, code: "AUTH_REQUIRED" }));

  await assert.rejects(resultPromise, (error) => error.code === "AUTH_REQUIRED");
  assert.equal(transport.getState(), "stopped");
  assert.equal(transport.isOpen(), false);
  assert.equal(authErrors.length, 1);
  assert.equal(authErrors[0].code, "AUTH_REQUIRED");
  assert.deepEqual(socket.closeCalls, [{ code: 4001, reason: "auth_required" }]);

  timers.advance(60_000);
  transport.resume();
  assert.equal(WebSocketImpl.instances.length, 1);
});

test("AUTH_REQUIRED without a requestId still rejects the active RPC as authentication failure", async () => {
  const { WebSocketImpl, transport } = createHarness();
  const requestId = "request_auth_expired_001";

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  const resultPromise = transport.request("exchange", new Uint8Array(), { requestId });
  socket.message(encodeServerError({ code: "AUTH_REQUIRED" }));

  await assert.rejects(resultPromise, (error) => error.code === "AUTH_REQUIRED");
  assert.equal(transport.getState(), "stopped");
  assert.deepEqual(socket.closeCalls, [{ code: 4001, reason: "auth_required" }]);
});

test("messages from a stale socket generation cannot settle the current RPC", async () => {
  const { WebSocketImpl, transport } = createHarness();
  const requestId = "request_stale_generation";
  const staleBytes = Uint8Array.of(1);
  const currentBytes = Uint8Array.of(2);

  transport.start();
  const staleSocket = WebSocketImpl.instances[0];
  staleSocket.open();
  transport.pause();
  transport.resume();
  const currentSocket = WebSocketImpl.instances[1];
  currentSocket.open();

  let settled = false;
  const resultPromise = transport.request("exchange", new Uint8Array(), { requestId });
  void resultPromise.then(() => { settled = true; }, () => { settled = true; });
  staleSocket.message(encodeServerResult("exchange_result", requestId, staleBytes));
  await Promise.resolve();
  assert.equal(settled, false);

  currentSocket.message(encodeServerResult("exchange_result", requestId, currentBytes));
  assert.deepEqual(await resultPromise, currentBytes);
});

test("only one RPC may be in flight at a time", async () => {
  const { WebSocketImpl, transport } = createHarness();
  const firstId = "request_single_flight_01";
  const secondId = "request_single_flight_02";

  transport.start();
  const socket = WebSocketImpl.instances[0];
  socket.open();
  const first = transport.request("exchange", Uint8Array.of(1), { requestId: firstId });

  await assert.rejects(
    transport.request("resolve", Uint8Array.of(2), { requestId: secondId }),
    (error) => error.code === "SYNC_BUSY",
  );
  assert.equal(socket.sent.length, 1);

  socket.message(encodeServerResult("exchange_result", firstId, Uint8Array.of(3)));
  assert.deepEqual(await first, Uint8Array.of(3));
});
