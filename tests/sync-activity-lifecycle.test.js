import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultState } from "../src/domain/campaign.js";
import {
  BASELINE_CHOICE,
  decodeResolveBaselineRequest,
  decodeSyncRequest,
  encodeJsonValue,
  encodeResolveBaselineResponse,
  encodeSyncResponse,
} from "../src/sync/protocol.js";
import {
  decodeClientFrame,
  encodeServerResult,
} from "../src/sync/webSocketFrames.js";
import {
  resolveWithLocalProgress,
  startCloudSync,
  stopCloudSync,
} from "../src/sync/syncEngine.js";

const BASELINE_ID = "baseline_0123456789abcdef0123456789abcdef";
const SERVER_BASELINE_ID = "baseline_abcdef0123456789abcdef0123456789";
const FORKED_BASELINE_ID = "baseline_cccccccccccccccccccccccccccccccc";
const REMOTE_JOURNAL_KEY = "stella/v1/day/2026-07-13/journal";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }
}

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

class FakeWebSocket {
  static instances = [];

  constructor(_url, protocol) {
    this.protocol = "";
    this.requestedProtocol = protocol;
    this.readyState = 0;
    this.sent = [];
    this.closeCalls = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.protocol = this.requestedProtocol;
    this.readyState = 1;
    this.dispatch("open");
  }

  message(data) {
    this.dispatch("message", { data });
  }

  send(message) {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(message);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }
}

function createState() {
  const base = createDefaultState();
  return {
    ...base,
    baselineId: BASELINE_ID,
    schemaVersion: 1,
    revision: 0,
    lastUpdatedAt: null,
    quoteLikes: {},
    preferences: {
      selectedDate: "2026-07-13",
      fontFamily: "lxgw-wenka",
      quoteSource: "native",
      hitokotoCategories: [],
    },
    raffle: { ...base.raffle, paperClaims: [] },
  };
}

function createStore() {
  let changeListener;
  return {
    mutableState: createState(),
    subscribeToChanges(listener) {
      changeListener = listener;
      return () => { changeListener = undefined; };
    },
    emitChange() {
      changeListener?.();
    },
    async replaceFromSync(nextState) {
      this.mutableState = structuredClone(nextState);
    },
    createCleanSyncState(baselineId) {
      return { ...createState(), baselineId };
    },
    replaceFromPersistedSync(nextState) {
      this.mutableState = structuredClone(nextState);
    },
  };
}

function exchangeFrames(socket) {
  return socket.sent
    .filter((message) => message !== "ping")
    .map((message) => decodeClientFrame(message))
    .filter((frame) => frame.type === "exchange");
}

function respondToExchange(socket, frame, changes = [], baselineId = BASELINE_ID) {
  const nextCursor = changes.at(-1)?.cursor ?? 0;
  socket.message(encodeServerResult(
    "exchange_result",
    frame.requestId,
    encodeSyncResponse({
      nextCursor,
      acks: [],
      changes,
      hasMore: false,
      resetRequired: false,
      baselineId,
      serverVersion: nextCursor,
      serverUpdatedAtMs: nextCursor ? Date.now() : 0,
      serverProgressDay: "2026-07-13",
      baselineMismatch: false,
    }),
  ));
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("blur keeps one socket quiet, focus pulls once without uploading, and offline closes", async () => {
  const originalDescriptors = new Map(
    [
      "document",
      "navigator",
      "localStorage",
      "WebSocket",
      "addEventListener",
      "removeEventListener",
      "setTimeout",
      "clearTimeout",
    ]
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const windowEvents = new EventTarget();
  const document = new EventTarget();
  const navigator = { onLine: true };
  const timers = new FakeTimers();
  let focused = true;
  Object.defineProperties(document, {
    visibilityState: { configurable: true, get: () => "visible" },
    hasFocus: { configurable: true, value: () => focused },
  });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: document },
    navigator: { configurable: true, value: navigator },
    localStorage: { configurable: true, value: new MemoryStorage() },
    WebSocket: { configurable: true, value: FakeWebSocket },
    addEventListener: {
      configurable: true,
      value: windowEvents.addEventListener.bind(windowEvents),
    },
    removeEventListener: {
      configurable: true,
      value: windowEvents.removeEventListener.bind(windowEvents),
    },
    setTimeout: { configurable: true, value: timers.setTimeout },
    clearTimeout: { configurable: true, value: timers.clearTimeout },
  });
  FakeWebSocket.instances = [];

  try {
    const store = createStore();
    await startCloudSync(store, "activity-test-owner");
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const initialFrame = exchangeFrames(socket)[0];
    assert.ok(initialFrame);
    respondToExchange(socket, initialFrame);
    await nextTurn();

    focused = false;
    windowEvents.dispatchEvent(new Event("blur"));
    assert.equal(socket.readyState, 1);
    assert.deepEqual(socket.closeCalls, []);
    assert.deepEqual(decodeClientFrame(socket.sent.at(-1)), {
      version: 1,
      type: "activity",
      active: false,
    });

    store.mutableState.preferences.fontFamily = "system";
    assert.equal(exchangeFrames(socket).length, 1);

    focused = true;
    windowEvents.dispatchEvent(new Event("focus"));
    await nextTurn();
    const resumedFrames = exchangeFrames(socket);
    assert.equal(resumedFrames.length, 2);
    const resumedRequest = decodeSyncRequest(resumedFrames[1].protobuf);
    assert.deepEqual(resumedRequest.mutations, []);

    respondToExchange(socket, resumedFrames[1], [{
      cursor: 1,
      entityKey: REMOTE_JOURNAL_KEY,
      valueJson: encodeJsonValue("远端补拉内容"),
      deleted: false,
      deviceId: "device_remote",
      clientTimeMs: Date.now(),
      opId: "operation_remote_0001",
    }]);
    await nextTurn();
    assert.equal(store.mutableState.days["2026-07-13"].journal, "远端补拉内容");
    assert.equal(store.mutableState.preferences.fontFamily, "system");

    document.dispatchEvent(new Event("visibilitychange"));
    windowEvents.dispatchEvent(new Event("focus"));
    await nextTurn();
    assert.equal(exchangeFrames(socket).length, 2);

    timers.advance(4_000);
    await nextTurn();
    assert.equal(exchangeFrames(socket).length, 2);
    timers.advance(1_000);
    await nextTurn();
    const uploadFrames = exchangeFrames(socket);
    assert.equal(uploadFrames.length, 3);
    const uploadRequest = decodeSyncRequest(uploadFrames[2].protobuf);
    assert.equal(uploadRequest.mutations.length, 1);
    assert.equal(uploadRequest.mutations[0].entityKey, "stella/v1/preference/fontFamily");

    navigator.onLine = false;
    windowEvents.dispatchEvent(new Event("offline"));
    await nextTurn();
    assert.equal(socket.readyState, 3);
    assert.deepEqual(socket.closeCalls, [{ code: 1000, reason: "sync_paused" }]);
  } finally {
    stopCloudSync();
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("USE_LOCAL adopts a forked server baseline before the next exchange", async () => {
  const originalDescriptors = new Map(
    [
      "document",
      "navigator",
      "localStorage",
      "WebSocket",
      "addEventListener",
      "removeEventListener",
      "setTimeout",
      "clearTimeout",
    ]
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const windowEvents = new EventTarget();
  const document = new EventTarget();
  const timers = new FakeTimers();
  Object.defineProperties(document, {
    visibilityState: { configurable: true, value: "visible" },
    hasFocus: { configurable: true, value: () => true },
  });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: document },
    navigator: { configurable: true, value: { onLine: true } },
    localStorage: { configurable: true, value: new MemoryStorage() },
    WebSocket: { configurable: true, value: FakeWebSocket },
    addEventListener: {
      configurable: true,
      value: windowEvents.addEventListener.bind(windowEvents),
    },
    removeEventListener: {
      configurable: true,
      value: windowEvents.removeEventListener.bind(windowEvents),
    },
    setTimeout: { configurable: true, value: timers.setTimeout },
    clearTimeout: { configurable: true, value: timers.clearTimeout },
  });
  FakeWebSocket.instances = [];

  try {
    const store = createStore();
    await startCloudSync(store, "resolution-test-owner");
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const initialFrame = exchangeFrames(socket)[0];
    socket.message(encodeServerResult(
      "exchange_result",
      initialFrame.requestId,
      encodeSyncResponse({
        nextCursor: 0,
        acks: [],
        changes: [],
        hasMore: false,
        resetRequired: false,
        baselineId: SERVER_BASELINE_ID,
        serverVersion: 3,
        serverUpdatedAtMs: Date.now(),
        serverProgressDay: "2026-07-14",
        baselineMismatch: true,
      }),
    ));
    await nextTurn();

    const resolutionPromise = resolveWithLocalProgress();
    const resolveFrame = socket.sent
      .filter((message) => message !== "ping")
      .map((message) => decodeClientFrame(message))
      .findLast((frame) => frame.type === "resolve");
    assert.ok(resolveFrame);
    const resolveRequest = decodeResolveBaselineRequest(resolveFrame.protobuf);
    assert.equal(resolveRequest.choice, BASELINE_CHOICE.USE_LOCAL);
    assert.equal(resolveRequest.localBaselineId, BASELINE_ID);
    assert.equal(resolveRequest.expectedServerBaselineId, SERVER_BASELINE_ID);

    socket.message(encodeServerResult(
      "resolve_result",
      resolveFrame.requestId,
      encodeResolveBaselineResponse({
        baselineId: FORKED_BASELINE_ID,
        serverVersion: 0,
        serverUpdatedAtMs: Date.now(),
        serverProgressDay: "2026-07-13",
        records: [],
        stale: false,
        serverCursor: 0,
      }),
    ));
    assert.equal(await resolutionPromise, true);
    assert.equal(store.mutableState.baselineId, FORKED_BASELINE_ID);

    await nextTurn();
    const followUpFrame = exchangeFrames(socket).at(-1);
    assert.ok(followUpFrame);
    const followUpRequest = decodeSyncRequest(followUpFrame.protobuf);
    assert.equal(followUpRequest.baselineId, FORKED_BASELINE_ID);
    respondToExchange(socket, followUpFrame, [], FORKED_BASELINE_ID);
    await nextTurn();
  } finally {
    stopCloudSync();
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
