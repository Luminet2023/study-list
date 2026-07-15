import { resolveApiUrl } from "../lib/apiUrl.js";
import { base64ToBytes, decodeSyncResponse } from "./protocol.js";

export const SYNC_EVENTS_PATH = "/v1/sync/events";
export const SYNC_SSE_VERSION = 1;
export const MAX_SYNC_PROTOBUF_BYTES = 512 * 1024;
export const MAX_SYNC_SSE_EVENT_BYTES = Math.ceil(MAX_SYNC_PROTOBUF_BYTES * 4 / 3) + 2048;

const EVENT_TYPES = new Set(["changes", "ready", "baseline_mismatch", "reset_required"]);
const CONTROL_TYPES = new Set(["auth_required", "unavailable"]);
const EVENT_ID_PATTERN = /^(baseline_[a-f0-9]{32}):(\d+)$/u;
const MAX_RECONNECT_MS = 30_000;

export class SyncSseError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = "SyncSseError";
    this.code = code;
    Object.assign(this, extra);
  }
}

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(Math.ceil(seconds * 1000), 0);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(date - now, 0);
}

function assertEventBudget(buffer, eventLength) {
  if (buffer.length + eventLength > MAX_SYNC_SSE_EVENT_BYTES) {
    throw new SyncSseError("SSE event is too large", "RESPONSE_TOO_LARGE");
  }
}

/** 增量解析 SSE 行协议；feed 返回当前 chunk 中完整结束的事件。 */
export function createSseParser() {
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];
  let explicitId;
  let lastEventId = "";
  let retry;
  let eventLength = 0;

  function resetEvent() {
    eventName = "message";
    dataLines = [];
    explicitId = undefined;
    retry = undefined;
    eventLength = 0;
  }

  function processLine(line, events) {
    assertEventBudget("", eventLength + line.length + 1);
    eventLength += line.length + 1;
    if (line === "") {
      if (dataLines.length) {
        if (explicitId !== undefined) lastEventId = explicitId;
        events.push({
          type: eventName || "message",
          data: dataLines.join("\n"),
          lastEventId,
          retry,
        });
      }
      resetEvent();
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    else if (field === "id" && !value.includes("\0")) explicitId = value;
    else if (field === "retry" && /^\d+$/u.test(value)) retry = Number(value);
  }

  function consume(final = false) {
    const events = [];
    let offset = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      if (!final && character === "\r" && index === buffer.length - 1) break;
      processLine(buffer.slice(offset, index), events);
      if (character === "\r" && buffer[index + 1] === "\n") index += 1;
      offset = index + 1;
    }
    buffer = buffer.slice(offset);
    assertEventBudget(buffer, eventLength);
    return events;
  }

  return {
    feed(chunk) {
      const text = typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), { stream: true });
      buffer += text;
      assertEventBudget(buffer, eventLength);
      return consume(false);
    },
    finish() {
      buffer += decoder.decode();
      const events = consume(true);
      if (buffer || dataLines.length || eventName !== "message") {
        throw new SyncSseError("SSE stream ended inside an event", "TRUNCATED_STREAM");
      }
      return events;
    },
  };
}

function parseEnvelope(event) {
  let envelope;
  try {
    envelope = JSON.parse(event.data);
  } catch {
    throw new SyncSseError("SSE event contains invalid JSON", "INVALID_RESPONSE");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new SyncSseError("SSE envelope must be an object", "INVALID_RESPONSE");
  }
  if (envelope.version !== SYNC_SSE_VERSION) {
    throw new SyncSseError("Unsupported SSE protocol version", "UNSUPPORTED_VERSION");
  }
  if (CONTROL_TYPES.has(event.type)) {
    if (typeof envelope.code !== "string" || !envelope.code) {
      throw new SyncSseError("SSE control event is missing its code", "INVALID_RESPONSE");
    }
    return { type: event.type, code: envelope.code };
  }
  if (!EVENT_TYPES.has(event.type) || typeof envelope.protobuf !== "string") {
    throw new SyncSseError("Unsupported SSE event", "INVALID_RESPONSE");
  }
  if (envelope.protobuf.length > Math.ceil(MAX_SYNC_PROTOBUF_BYTES * 4 / 3) + 4) {
    throw new SyncSseError("SSE protobuf is too large", "RESPONSE_TOO_LARGE");
  }
  let protobuf;
  try {
    protobuf = base64ToBytes(envelope.protobuf);
  } catch {
    throw new SyncSseError("SSE event contains invalid Base64", "INVALID_RESPONSE");
  }
  if (protobuf.length > MAX_SYNC_PROTOBUF_BYTES) {
    throw new SyncSseError("SSE protobuf is too large", "RESPONSE_TOO_LARGE");
  }
  let response;
  try {
    response = decodeSyncResponse(protobuf);
  } catch (cause) {
    throw new SyncSseError("SSE event contains invalid Protobuf", "INVALID_RESPONSE", { cause });
  }
  const decoded = { type: event.type, response, lastEventId: event.lastEventId };
  if (event.type === "changes") {
    const match = EVENT_ID_PATTERN.exec(event.lastEventId ?? "");
    if (!match) throw new SyncSseError("SSE changes event has an invalid id", "INVALID_RESPONSE");
    const cursor = Number(match[2]);
    if (!Number.isSafeInteger(cursor) || cursor !== response.nextCursor || match[1] !== response.baselineId) {
      throw new SyncSseError("SSE changes event id does not match its payload", "INVALID_RESPONSE");
    }
    decoded.cursor = cursor;
  }
  return decoded;
}

function eventUrl(path, { baselineId, cursor }, options) {
  const resolved = resolveApiUrl(path, options.apiBaseUrl);
  const url = new URL(resolved, options.locationHref ?? globalThis.location?.href);
  url.searchParams.set("baselineId", baselineId);
  url.searchParams.set("cursor", String(cursor));
  return url.toString();
}

export function createSyncSseTransport(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const setTimer = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis);
  const random = options.random ?? Math.random;
  const isActive = options.isActive ?? (() => true);
  const getConnectionParams = options.getConnectionParams ?? (() => ({ baselineId: "", cursor: 0 }));
  const path = options.path ?? SYNC_EVENTS_PATH;
  let state = "stopped";
  let running = false;
  let generation = 0;
  let controller;
  let reconnectTimer;
  let reconnectAttempt = 0;
  let ready = false;

  function setState(next) {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function clearReconnect() {
    if (reconnectTimer !== undefined) clearTimer?.(reconnectTimer);
    reconnectTimer = undefined;
  }

  function abortConnection() {
    generation += 1;
    ready = false;
    controller?.abort();
    controller = undefined;
  }

  function scheduleReconnect(minimumDelay = 0) {
    if (!running || !isActive()) {
      setState(running ? "paused" : "stopped");
      return;
    }
    if (reconnectTimer !== undefined) return;
    const ceiling = Math.min(1000 * (2 ** reconnectAttempt), MAX_RECONNECT_MS);
    reconnectAttempt += 1;
    const delay = Math.max(Math.floor(random() * ceiling), minimumDelay);
    setState("backoff");
    reconnectTimer = setTimer?.(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
  }

  async function handleDecodedEvent(decoded) {
    if (decoded.type === "auth_required") {
      const error = new SyncSseError("登录已失效", "AUTH_REQUIRED");
      running = false;
      abortConnection();
      setState("stopped");
      await options.onAuthRequired?.(error);
      return;
    }
    if (decoded.type === "unavailable") {
      await options.onUnavailable?.(new SyncSseError("云同步暂不可用", decoded.code));
      return;
    }
    await options.onEvent?.(decoded);
    if (decoded.type === "ready") {
      ready = true;
      reconnectAttempt = 0;
      setState("open");
      await options.onReady?.(decoded);
    }
  }

  async function consumeResponse(response, currentGeneration) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("text/event-stream")) {
      throw new SyncSseError("同步事件接口未返回 text/event-stream", "INVALID_RESPONSE");
    }
    if (!response.body?.getReader) {
      throw new SyncSseError("当前浏览器不支持流式响应", "SSE_UNAVAILABLE");
    }
    setState("catching_up");
    const reader = response.body.getReader();
    const parser = createSseParser();
    while (running && generation === currentGeneration) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.feed(value)) {
        if (!running || generation !== currentGeneration) return;
        await handleDecodedEvent(parseEnvelope(event));
      }
    }
    if (running && generation === currentGeneration) {
      for (const event of parser.finish()) await handleDecodedEvent(parseEnvelope(event));
      throw new SyncSseError("同步事件流已断开", "CONNECTION_LOST");
    }
  }

  async function connect() {
    if (!running || !isActive()) {
      setState(running ? "paused" : "stopped");
      return;
    }
    if (!fetchImpl || controller) return;
    clearReconnect();
    ready = false;
    const currentGeneration = ++generation;
    const currentController = new AbortController();
    controller = currentController;
    setState("connecting");
    try {
      const response = await fetchImpl(eventUrl(path, getConnectionParams(), options), {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "text/event-stream",
        },
        cache: "no-store",
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: currentController.signal,
      });
      if (response.status === 401) {
        const error = new SyncSseError("登录已失效", "AUTH_REQUIRED");
        running = false;
        setState("stopped");
        await options.onAuthRequired?.(error);
        return;
      }
      if (response.status === 429) {
        throw new SyncSseError("同步事件连接过于频繁", "RATE_LIMITED", {
          retryAfterMs: Math.max(parseRetryAfter(response.headers.get("retry-after")), 1000),
        });
      }
      if (!response.ok) {
        throw new SyncSseError(`同步事件接口返回 ${response.status}`, "CONNECTION_LOST");
      }
      await consumeResponse(response, currentGeneration);
    } catch (error) {
      if (currentController.signal.aborted || !running || generation !== currentGeneration) return;
      options.onError?.(error);
      scheduleReconnect(error.code === "RATE_LIMITED" ? error.retryAfterMs : 0);
    } finally {
      if (controller === currentController) controller = undefined;
    }
  }

  function start() {
    if (running) return;
    running = true;
    void connect();
  }

  function pause() {
    clearReconnect();
    abortConnection();
    setState(running ? "paused" : "stopped");
  }

  function resume() {
    if (!running || !isActive()) {
      setState(running ? "paused" : "stopped");
      return;
    }
    void connect();
  }

  function restart() {
    if (!running) return;
    clearReconnect();
    abortConnection();
    void connect();
  }

  function stop() {
    running = false;
    clearReconnect();
    abortConnection();
    setState("stopped");
  }

  return {
    start,
    pause,
    resume,
    restart,
    stop,
    getState: () => state,
    isReady: () => ready,
  };
}
