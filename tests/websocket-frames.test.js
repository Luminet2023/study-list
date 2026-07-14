import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyncRequestId,
  decodeClientFrame,
  decodeServerFrame,
  encodeActivityFrame,
  encodeClientFrame,
  encodeServerError,
  encodeServerResult,
  encodeSyncHint,
  MAX_PROTOBUF_BYTES,
  MAX_WEBSOCKET_FRAME_BYTES,
  SyncWebSocketFrameError,
} from "../src/sync/webSocketFrames.js";

const REQUEST_ID = "request_0123456789abcdef";
const BASELINE_ID = "baseline_0123456789abcdef0123456789abcdef";

function assertFrameError(action, { code, closeCode } = {}) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof SyncWebSocketFrameError);
    if (code !== undefined) assert.equal(error.code, code);
    if (closeCode !== undefined) assert.equal(error.closeCode, closeCode);
    return true;
  });
}

test("exchange and resolve request frames round-trip protobuf bytes", () => {
  for (const type of ["exchange", "resolve"]) {
    const protobuf = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
    assert.deepEqual(
      decodeClientFrame(encodeClientFrame(type, protobuf, REQUEST_ID)),
      {
        version: 1,
        requestId: REQUEST_ID,
        type,
        protobuf,
      },
    );
  }
});

test("activity frames round-trip active and inactive states", () => {
  for (const active of [true, false]) {
    assert.deepEqual(decodeClientFrame(encodeActivityFrame(active)), {
      version: 1,
      type: "activity",
      active,
    });
  }
});

test("activity frames reject non-boolean active values", () => {
  for (const active of [undefined, null, 0, 1, "true", {}]) {
    assert.throws(() => encodeActivityFrame(active), TypeError);
    assertFrameError(
      () => decodeClientFrame(JSON.stringify({ version: 1, type: "activity", active })),
      { code: "INVALID_ARGUMENT", closeCode: null },
    );
  }
});

test("exchange and resolve result frames round-trip protobuf bytes", () => {
  for (const type of ["exchange_result", "resolve_result"]) {
    const protobuf = Uint8Array.from([255, 128, 42, 0, 7]);
    assert.deepEqual(
      decodeServerFrame(encodeServerResult(type, REQUEST_ID, protobuf)),
      {
        version: 1,
        requestId: REQUEST_ID,
        type,
        protobuf,
      },
    );
  }
});

test("sync hint frames preserve baseline head metadata", () => {
  const hint = {
    baselineId: BASELINE_ID,
    serverCursor: 128,
    serverVersion: 17,
  };
  assert.deepEqual(decodeServerFrame(encodeSyncHint(hint)), {
    version: 1,
    type: "sync_hint",
    ...hint,
  });
});

test("error frames preserve request correlation and retry delay", () => {
  assert.deepEqual(
    decodeServerFrame(encodeServerError({
      requestId: REQUEST_ID,
      code: "RATE_LIMITED",
      retryAfterMs: 12_500,
    })),
    {
      version: 1,
      type: "error",
      requestId: REQUEST_ID,
      code: "RATE_LIMITED",
      retryAfterMs: 12_500,
    },
  );
});

test("generated request IDs are random and accepted by the frame codec", () => {
  const first = createSyncRequestId();
  const second = createSyncRequestId();

  assert.match(first, /^req_[a-f0-9]{32}$/u);
  assert.match(second, /^req_[a-f0-9]{32}$/u);
  assert.notEqual(first, second);
  assert.equal(decodeClientFrame(encodeClientFrame("exchange", new Uint8Array(), first)).requestId, first);
});

test("client decoder rejects invalid JSON and non-object JSON frames", () => {
  assertFrameError(() => decodeClientFrame("{"), { closeCode: 1007 });
  for (const message of ["null", "[]", '"frame"']) {
    assertFrameError(() => decodeClientFrame(message), { closeCode: 1007 });
  }
});

test("client decoder rejects unsupported versions, request IDs, types, and Base64", () => {
  const validFrame = {
    version: 1,
    requestId: REQUEST_ID,
    type: "exchange",
    protobuf: "AA==",
  };

  assertFrameError(
    () => decodeClientFrame(JSON.stringify({ ...validFrame, version: 2 })),
    { code: "UNSUPPORTED_VERSION", closeCode: null },
  );
  assertFrameError(
    () => decodeClientFrame(JSON.stringify({ ...validFrame, requestId: "short" })),
    { code: "INVALID_ARGUMENT", closeCode: null },
  );
  assertFrameError(
    () => decodeClientFrame(JSON.stringify({ ...validFrame, type: "unknown" })),
    { code: "INVALID_ARGUMENT", closeCode: null },
  );
  assertFrameError(
    () => decodeClientFrame(JSON.stringify({ ...validFrame, protobuf: "***=" })),
    { code: "INVALID_ARGUMENT", closeCode: null },
  );
});

test("binary client frames are rejected with close code 1003", () => {
  assertFrameError(() => decodeClientFrame(Uint8Array.of(1, 2, 3)), { closeCode: 1003 });
});

test("oversized WebSocket frames are rejected with close code 1009", () => {
  assertFrameError(
    () => decodeClientFrame("x".repeat(MAX_WEBSOCKET_FRAME_BYTES + 1)),
    { closeCode: 1009 },
  );
});

test("protobuf payloads larger than 512 KiB are rejected on encode and decode", () => {
  const protobuf = new Uint8Array(MAX_PROTOBUF_BYTES + 1);
  assertFrameError(() => encodeClientFrame("exchange", protobuf, REQUEST_ID), { closeCode: 1009 });

  const message = JSON.stringify({
    version: 1,
    requestId: REQUEST_ID,
    type: "exchange",
    protobuf: Buffer.from(protobuf).toString("base64"),
  });
  assert.ok(Buffer.byteLength(message) <= MAX_WEBSOCKET_FRAME_BYTES);
  assertFrameError(() => decodeClientFrame(message), { closeCode: 1009 });
});
