import assert from "node:assert/strict";
import test from "node:test";

import { bytesToBase64, encodeSyncResponse } from "../src/sync/protocol.js";
import {
  createSseParser,
  createSyncSseTransport,
  MAX_SYNC_PROTOBUF_BYTES,
  MAX_SYNC_SSE_EVENT_BYTES,
} from "../src/sync/sseTransport.js";

const BASELINE_ID = "baseline_0123456789abcdef0123456789abcdef";

function syncEnvelope(response) {
  return JSON.stringify({ version: 1, protobuf: bytesToBase64(encodeSyncResponse(response)) });
}

function responseBody(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function headers(values = {}) {
  return new Headers({ "content-type": "text/event-stream; charset=utf-8", ...values });
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("SSE parser handles arbitrary chunks, CRLF, comments, and multiple data lines", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.feed("event: changes\r"), []);
  assert.deepEqual(parser.feed("\nid: baseline:1\r\n:data ignored\r\ndata: one\r\ndata: two\r\n\r"), []);
  assert.deepEqual(parser.feed("\n"), [{
    type: "changes",
    data: "one\ntwo",
    lastEventId: "baseline:1",
    retry: undefined,
  }]);
  assert.deepEqual(parser.finish(), []);
});

test("SSE parser rejects truncated and oversized events", () => {
  const parser = createSseParser();
  parser.feed("event: ready\ndata: partial");
  assert.throws(() => parser.finish(), (error) => error.code === "TRUNCATED_STREAM");
  assert.throws(
    () => createSseParser().feed(`data: ${"x".repeat(MAX_SYNC_SSE_EVENT_BYTES)}\n\n`),
    (error) => error.code === "RESPONSE_TOO_LARGE",
  );
});

test("transport sends credentialed prefixed GET and applies changes before ready", async () => {
  const calls = [];
  const events = [];
  const states = [];
  const syncResponse = {
    nextCursor: 2,
    acks: [],
    changes: [],
    hasMore: false,
    resetRequired: false,
    baselineId: BASELINE_ID,
    serverVersion: 1,
    serverUpdatedAtMs: 123,
    serverProgressDay: "2026-07-13",
    baselineMismatch: false,
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: headers(),
      body: responseBody([
        `event: changes\nid: ${BASELINE_ID}:2\ndata: ${syncEnvelope(syncResponse)}\n\n`,
        `: heartbeat\n\nevent: ready\ndata: ${syncEnvelope(syncResponse)}\n\n`,
      ]),
    };
  };
  const transport = createSyncSseTransport({
    fetchImpl,
    apiBaseUrl: "https://api.luminet.cn/hifumi/",
    getConnectionParams: () => ({ baselineId: BASELINE_ID, cursor: 1 }),
    onStateChange: (state) => states.push(state),
    onEvent: async (event) => { events.push(event.type); },
  });
  transport.start();
  await nextTurn();
  await nextTurn();

  assert.equal(calls[0].url, `https://api.luminet.cn/hifumi/v1/sync/events?baselineId=${BASELINE_ID}&cursor=1`);
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.deepEqual(calls[0].options.headers, { accept: "text/event-stream" });
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(events, ["changes", "ready"]);
  assert.ok(states.includes("catching_up"));
  assert.ok(states.includes("open"));
  transport.stop();
});

test("transport reports 401 and backs off for 429", async () => {
  const authErrors = [];
  const authTransport = createSyncSseTransport({
    fetchImpl: async () => ({ ok: false, status: 401, headers: headers(), body: null }),
    apiBaseUrl: "https://api.example.test/",
    getConnectionParams: () => ({ baselineId: BASELINE_ID, cursor: 0 }),
    onAuthRequired: (error) => authErrors.push(error),
  });
  authTransport.start();
  await nextTurn();
  assert.equal(authErrors[0].code, "AUTH_REQUIRED");
  assert.equal(authTransport.getState(), "stopped");

  const timers = [];
  const rateTransport = createSyncSseTransport({
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: headers({ "retry-after": "12" }),
      body: null,
    }),
    apiBaseUrl: "https://api.example.test/",
    getConnectionParams: () => ({ baselineId: BASELINE_ID, cursor: 0 }),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
    random: () => 0,
  });
  rateTransport.start();
  await nextTurn();
  assert.equal(rateTransport.getState(), "backoff");
  assert.equal(timers[0].delay, 12_000);
  rateTransport.stop();
});

test("pause aborts an active stream and resume reconnects from fresh parameters", async () => {
  const calls = [];
  let cursor = 3;
  const fetchImpl = (url, options) => new Promise((_resolve, reject) => {
    calls.push({ url, options });
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
  const transport = createSyncSseTransport({
    fetchImpl,
    apiBaseUrl: "https://api.example.test/",
    getConnectionParams: () => ({ baselineId: BASELINE_ID, cursor }),
  });
  transport.start();
  await nextTurn();
  transport.pause();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(transport.getState(), "paused");

  cursor = 9;
  transport.resume();
  await nextTurn();
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /cursor=9/u);
  transport.stop();
});

test("transport rejects invalid SSE JSON, Base64, and decoded payloads over 512 KiB", async () => {
  const cases = [
    "{",
    JSON.stringify({ version: 1, protobuf: "!!!!" }),
    JSON.stringify({
      version: 1,
      protobuf: bytesToBase64(new Uint8Array(MAX_SYNC_PROTOBUF_BYTES + 1)),
    }),
  ];
  for (const data of cases) {
    const errors = [];
    const transport = createSyncSseTransport({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: headers(),
        body: responseBody([`event: ready\ndata: ${data}\n\n`]),
      }),
      apiBaseUrl: "https://api.example.test/",
      getConnectionParams: () => ({ baselineId: BASELINE_ID, cursor: 0 }),
      setTimeout: () => 1,
      clearTimeout: () => {},
      onError: (error) => errors.push(error),
    });
    transport.start();
    await nextTurn();
    await nextTurn();
    assert.equal(errors.length, 1);
    assert.ok(["INVALID_RESPONSE", "RESPONSE_TOO_LARGE"].includes(errors[0].code));
    transport.stop();
  }
});
