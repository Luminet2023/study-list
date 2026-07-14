import { base64ToBytes, bytesToBase64 } from "./protocol.js";

export const SYNC_WEBSOCKET_PATH = "/api/v1/sync/ws";
export const SYNC_WEBSOCKET_PROTOCOL = "stella-sync-v1";
export const SYNC_WEBSOCKET_VERSION = 1;
export const MAX_PROTOBUF_BYTES = 512 * 1024;
export const MAX_SYNC_ENVELOPE_BYTES = Math.ceil(MAX_PROTOBUF_BYTES * 4 / 3) + 128;
export const MAX_WEBSOCKET_FRAME_BYTES = MAX_SYNC_ENVELOPE_BYTES + 512;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/u;
const BASELINE_ID_PATTERN = /^baseline_[a-f0-9]{32}$/u;
const REQUEST_TYPES = new Set(["exchange", "resolve"]);
const RESULT_TYPES = new Set(["exchange_result", "resolve_result"]);
const ERROR_CODES = new Set([
  "INVALID_ARGUMENT",
  "UNSUPPORTED_VERSION",
  "RATE_LIMITED",
  "FAILED_PRECONDITION",
  "AUTH_REQUIRED",
  "INTERNAL",
]);
const textEncoder = new TextEncoder();

export class SyncWebSocketFrameError extends Error {
  constructor(message, { code = "INVALID_ARGUMENT", closeCode = null } = {}) {
    super(message);
    this.name = "SyncWebSocketFrameError";
    this.code = code;
    this.closeCode = closeCode;
  }
}

export function createSyncRequestId(prefix = "req") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function assertFrameSize(message) {
  if (textEncoder.encode(message).length > MAX_WEBSOCKET_FRAME_BYTES) {
    throw new SyncWebSocketFrameError("sync WebSocket frame is too large", { closeCode: 1009 });
  }
}

function parseJsonFrame(message) {
  if (typeof message !== "string") {
    throw new SyncWebSocketFrameError("sync WebSocket requires text frames", { closeCode: 1003 });
  }
  assertFrameSize(message);
  let frame;
  try {
    frame = JSON.parse(message);
  } catch {
    throw new SyncWebSocketFrameError("sync WebSocket frame contains invalid JSON", { closeCode: 1007 });
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new SyncWebSocketFrameError("sync WebSocket frame must be an object", { closeCode: 1007 });
  }
  if (frame.version !== SYNC_WEBSOCKET_VERSION) {
    throw new SyncWebSocketFrameError("unsupported sync WebSocket protocol version", {
      code: "UNSUPPORTED_VERSION",
    });
  }
  return frame;
}

function assertRequestId(value) {
  if (!REQUEST_ID_PATTERN.test(value ?? "")) {
    throw new SyncWebSocketFrameError("invalid sync WebSocket requestId");
  }
  return value;
}

function decodeProtobuf(value) {
  if (typeof value !== "string" || value.length > MAX_SYNC_ENVELOPE_BYTES) {
    throw new SyncWebSocketFrameError("invalid sync WebSocket protobuf envelope", {
      closeCode: value?.length > MAX_SYNC_ENVELOPE_BYTES ? 1009 : null,
    });
  }
  let protobuf;
  try {
    protobuf = base64ToBytes(value);
  } catch {
    throw new SyncWebSocketFrameError("invalid sync WebSocket protobuf Base64");
  }
  if (protobuf.length > MAX_PROTOBUF_BYTES) {
    throw new SyncWebSocketFrameError("sync WebSocket protobuf is too large", { closeCode: 1009 });
  }
  return protobuf;
}

function encodedProtobuf(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? 0);
  if (bytes.length > MAX_PROTOBUF_BYTES) {
    throw new SyncWebSocketFrameError("sync WebSocket protobuf is too large", { closeCode: 1009 });
  }
  return bytesToBase64(bytes);
}

function serializeFrame(frame) {
  const message = JSON.stringify(frame);
  assertFrameSize(message);
  return message;
}

export function encodeClientFrame(type, protobuf, requestId = createSyncRequestId()) {
  if (!REQUEST_TYPES.has(type)) throw new TypeError(`unsupported sync request type: ${type}`);
  assertRequestId(requestId);
  return serializeFrame({
    version: SYNC_WEBSOCKET_VERSION,
    requestId,
    type,
    protobuf: encodedProtobuf(protobuf),
  });
}

export function encodeActivityFrame(active) {
  if (typeof active !== "boolean") throw new TypeError("sync activity must be a boolean");
  return serializeFrame({
    version: SYNC_WEBSOCKET_VERSION,
    type: "activity",
    active,
  });
}

export function decodeClientFrame(message) {
  const frame = parseJsonFrame(message);
  if (frame.type === "activity") {
    if (typeof frame.active !== "boolean") {
      throw new SyncWebSocketFrameError("invalid sync WebSocket activity state");
    }
    return {
      version: frame.version,
      type: frame.type,
      active: frame.active,
    };
  }
  if (!REQUEST_TYPES.has(frame.type)) {
    throw new SyncWebSocketFrameError("unsupported sync WebSocket request type");
  }
  return {
    version: frame.version,
    requestId: assertRequestId(frame.requestId),
    type: frame.type,
    protobuf: decodeProtobuf(frame.protobuf),
  };
}

export function encodeServerResult(type, requestId, protobuf) {
  if (!RESULT_TYPES.has(type)) throw new TypeError(`unsupported sync result type: ${type}`);
  assertRequestId(requestId);
  return serializeFrame({
    version: SYNC_WEBSOCKET_VERSION,
    requestId,
    type,
    protobuf: encodedProtobuf(protobuf),
  });
}

export function encodeSyncHint({ baselineId, serverCursor, serverVersion }) {
  if (!BASELINE_ID_PATTERN.test(baselineId ?? "")) throw new TypeError("invalid sync hint baselineId");
  if (!Number.isSafeInteger(serverCursor) || serverCursor < 0) throw new TypeError("invalid sync hint cursor");
  if (!Number.isSafeInteger(serverVersion) || serverVersion < 0) throw new TypeError("invalid sync hint version");
  return serializeFrame({
    version: SYNC_WEBSOCKET_VERSION,
    type: "sync_hint",
    baselineId,
    serverCursor,
    serverVersion,
  });
}

export function encodeServerError({ requestId, code, retryAfterMs }) {
  if (requestId !== undefined && requestId !== null) assertRequestId(requestId);
  if (!ERROR_CODES.has(code)) throw new TypeError(`unsupported sync error code: ${code}`);
  const frame = {
    version: SYNC_WEBSOCKET_VERSION,
    ...(requestId ? { requestId } : {}),
    type: "error",
    code,
  };
  if (retryAfterMs !== undefined) {
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) throw new TypeError("invalid retryAfterMs");
    frame.retryAfterMs = retryAfterMs;
  }
  return serializeFrame(frame);
}

export function decodeServerFrame(message) {
  const frame = parseJsonFrame(message);
  if (RESULT_TYPES.has(frame.type)) {
    return {
      version: frame.version,
      requestId: assertRequestId(frame.requestId),
      type: frame.type,
      protobuf: decodeProtobuf(frame.protobuf),
    };
  }
  if (frame.type === "sync_hint") {
    if (!BASELINE_ID_PATTERN.test(frame.baselineId ?? "")) {
      throw new SyncWebSocketFrameError("invalid sync hint baselineId");
    }
    if (!Number.isSafeInteger(frame.serverCursor) || frame.serverCursor < 0) {
      throw new SyncWebSocketFrameError("invalid sync hint cursor");
    }
    if (!Number.isSafeInteger(frame.serverVersion) || frame.serverVersion < 0) {
      throw new SyncWebSocketFrameError("invalid sync hint version");
    }
    return {
      version: frame.version,
      type: frame.type,
      baselineId: frame.baselineId,
      serverCursor: frame.serverCursor,
      serverVersion: frame.serverVersion,
    };
  }
  if (frame.type === "error") {
    if (frame.requestId !== undefined) assertRequestId(frame.requestId);
    if (!ERROR_CODES.has(frame.code)) throw new SyncWebSocketFrameError("invalid sync error code");
    if (
      frame.retryAfterMs !== undefined &&
      (!Number.isSafeInteger(frame.retryAfterMs) || frame.retryAfterMs < 0)
    ) {
      throw new SyncWebSocketFrameError("invalid sync retryAfterMs");
    }
    return {
      version: frame.version,
      type: frame.type,
      requestId: frame.requestId ?? null,
      code: frame.code,
      retryAfterMs: frame.retryAfterMs ?? 0,
    };
  }
  throw new SyncWebSocketFrameError("unsupported sync WebSocket response type");
}
