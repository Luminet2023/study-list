import {
  SYNC_WEBSOCKET_PATH,
  SYNC_WEBSOCKET_PROTOCOL,
  createSyncRequestId,
  decodeServerFrame,
  encodeClientFrame,
} from "./webSocketFrames.js";

const OPEN = 1;
const NORMAL_CLOSE = 1000;
const AUTH_REQUIRED_CLOSE = 4001;
const RPC_TIMEOUT_CLOSE = 4000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_MS = 30_000;

function syncTransportError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function defaultSocketUrl() {
  const location = globalThis.location;
  if (!location?.href) return SYNC_WEBSOCKET_PATH;
  const url = new URL(SYNC_WEBSOCKET_PATH, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function createSyncWebSocketTransport(options = {}) {
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const setTimer = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis);
  const random = options.random ?? Math.random;
  const isActive = options.isActive ?? (() => true);
  const socketUrl = options.url ?? defaultSocketUrl();
  let running = false;
  let socket;
  let generation = 0;
  let reconnectAttempt = 0;
  let reconnectTimer;
  let heartbeatTimer;
  let pongTimer;
  let pendingRpc;
  let state = "stopped";

  function setState(next) {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function clearNamedTimer(name) {
    const value = name === "reconnect" ? reconnectTimer : name === "heartbeat" ? heartbeatTimer : pongTimer;
    if (value !== undefined) clearTimer?.(value);
    if (name === "reconnect") reconnectTimer = undefined;
    else if (name === "heartbeat") heartbeatTimer = undefined;
    else pongTimer = undefined;
  }

  function clearConnectionTimers() {
    clearNamedTimer("heartbeat");
    clearNamedTimer("pong");
  }

  function rejectPending(error) {
    if (!pendingRpc) return;
    clearTimer?.(pendingRpc.timeout);
    const reject = pendingRpc.reject;
    pendingRpc = undefined;
    reject(error);
  }

  function closeSocket(code = NORMAL_CLOSE, reason = "sync_paused") {
    const current = socket;
    socket = undefined;
    generation += 1;
    clearConnectionTimers();
    rejectPending(syncTransportError("云同步连接已关闭", "CONNECTION_LOST"));
    if (current && current.readyState <= OPEN) {
      try {
        current.close(code, reason);
      } catch {
        // 已关闭的浏览器 WebSocket 无需再次处理。
      }
    }
  }

  function scheduleHeartbeat(current, currentGeneration) {
    clearNamedTimer("heartbeat");
    heartbeatTimer = setTimer?.(() => {
      heartbeatTimer = undefined;
      if (socket !== current || generation !== currentGeneration || current.readyState !== OPEN) return;
      try {
        current.send("ping");
      } catch {
        closeSocket(RPC_TIMEOUT_CLOSE, "heartbeat_send_failed");
        if (running && isActive()) scheduleReconnect();
        return;
      }
      clearNamedTimer("pong");
      pongTimer = setTimer?.(() => {
        pongTimer = undefined;
        if (socket !== current || generation !== currentGeneration) return;
        closeSocket(RPC_TIMEOUT_CLOSE, "heartbeat_timeout");
        if (running && isActive()) scheduleReconnect();
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function scheduleReconnect() {
    if (!running) {
      setState("stopped");
      return;
    }
    if (!isActive()) {
      setState("paused");
      return;
    }
    if (reconnectTimer !== undefined) return;
    const ceiling = Math.min(1000 * (2 ** reconnectAttempt), MAX_RECONNECT_MS);
    reconnectAttempt += 1;
    const delay = Math.floor(random() * ceiling);
    setState("backoff");
    reconnectTimer = setTimer?.(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function handleAuthRequired(error) {
    running = false;
    clearNamedTimer("reconnect");
    closeSocket(AUTH_REQUIRED_CLOSE, "auth_required");
    setState("stopped");
    options.onAuthRequired?.(error);
  }

  function handleMessage(current, currentGeneration, event) {
    if (socket !== current || generation !== currentGeneration) return;
    if (event.data === "pong") {
      clearNamedTimer("pong");
      scheduleHeartbeat(current, currentGeneration);
      return;
    }

    let frame;
    try {
      frame = decodeServerFrame(event.data);
    } catch (error) {
      rejectPending(error);
      closeSocket(error.closeCode ?? 1007, "invalid_server_frame");
      if (running && isActive()) scheduleReconnect();
      return;
    }

    if (frame.type === "sync_hint") {
      options.onHint?.(frame);
      return;
    }
    if (frame.type === "error") {
      const error = syncTransportError(`云同步返回 ${frame.code}`, frame.code, {
        retryAfterMs: frame.retryAfterMs,
      });
      if (frame.code === "AUTH_REQUIRED") {
        rejectPending(error);
        handleAuthRequired(error);
        return;
      }
      if (frame.requestId && pendingRpc?.requestId === frame.requestId) rejectPending(error);
      return;
    }
    if (!pendingRpc || frame.requestId !== pendingRpc.requestId) return;
    const expected = pendingRpc.type === "exchange" ? "exchange_result" : "resolve_result";
    if (frame.type !== expected) {
      const error = syncTransportError("云同步响应类型不匹配", "INVALID_RESPONSE");
      rejectPending(error);
      closeSocket(1007, "unexpected_response_type");
      if (running && isActive()) scheduleReconnect();
      return;
    }
    const rpc = pendingRpc;
    const resolve = rpc.resolve;
    clearTimer?.(rpc.timeout);
    pendingRpc = undefined;
    if (rpc.type === "exchange") reconnectAttempt = 0;
    resolve(frame.protobuf);
  }

  function connect() {
    if (!running || !isActive()) {
      setState(running ? "paused" : "stopped");
      return;
    }
    if (!WebSocketImpl) {
      options.onFatalError?.(syncTransportError("当前浏览器不支持 WebSocket", "WEBSOCKET_UNAVAILABLE"));
      setState("stopped");
      running = false;
      return;
    }
    if (socket) return;
    clearNamedTimer("reconnect");
    const currentGeneration = ++generation;
    const current = new WebSocketImpl(socketUrl, SYNC_WEBSOCKET_PROTOCOL);
    socket = current;
    setState("connecting");

    current.addEventListener("open", () => {
      if (socket !== current || generation !== currentGeneration) return;
      if (current.protocol !== SYNC_WEBSOCKET_PROTOCOL) {
        closeSocket(1002, "invalid_subprotocol");
        scheduleReconnect();
        return;
      }
      setState("open");
      scheduleHeartbeat(current, currentGeneration);
      Promise.resolve(options.onOpen?.()).catch((error) => options.onFatalError?.(error));
    });
    current.addEventListener("message", (event) => handleMessage(current, currentGeneration, event));
    current.addEventListener("close", (event) => {
      if (socket !== current || generation !== currentGeneration) return;
      socket = undefined;
      clearConnectionTimers();
      rejectPending(syncTransportError("云同步连接意外断开", "CONNECTION_LOST"));
      if (event.code === AUTH_REQUIRED_CLOSE) {
        handleAuthRequired(syncTransportError("登录已失效", "AUTH_REQUIRED"));
      } else {
        scheduleReconnect();
      }
    });
    current.addEventListener("error", () => {
      // 浏览器随后会派发 close；统一在 close 中安排重连。
    });
  }

  function start() {
    running = true;
    if (isActive()) connect();
    else setState("paused");
  }

  function pause() {
    clearNamedTimer("reconnect");
    closeSocket(NORMAL_CLOSE, "sync_paused");
    setState(running ? "paused" : "stopped");
  }

  function resume() {
    if (!running) return;
    if (!isActive()) {
      setState("paused");
      return;
    }
    connect();
  }

  function stop() {
    running = false;
    clearNamedTimer("reconnect");
    closeSocket(NORMAL_CLOSE, "sync_stopped");
    setState("stopped");
  }

  function request(type, protobuf, { requestId = createSyncRequestId() } = {}) {
    if (!running || !isActive()) {
      return Promise.reject(syncTransportError("页面未聚焦，云同步已暂停", "SYNC_PAUSED"));
    }
    if (!socket || socket.readyState !== OPEN || state !== "open") {
      return Promise.reject(syncTransportError("云同步连接尚未建立", "CONNECTION_LOST"));
    }
    if (pendingRpc) {
      return Promise.reject(syncTransportError("已有同步请求正在进行", "SYNC_BUSY"));
    }
    const message = encodeClientFrame(type, protobuf, requestId);
    return new Promise((resolve, reject) => {
      const timeout = setTimer?.(() => {
        if (pendingRpc?.requestId !== requestId) return;
        pendingRpc = undefined;
        reject(syncTransportError("云同步响应超时", "CONNECTION_LOST"));
        closeSocket(RPC_TIMEOUT_CLOSE, "rpc_timeout");
        if (running && isActive()) scheduleReconnect();
      }, RPC_TIMEOUT_MS);
      pendingRpc = { requestId, type, resolve, reject, timeout };
      try {
        socket.send(message);
      } catch (error) {
        clearTimer?.(timeout);
        pendingRpc = undefined;
        reject(error);
        closeSocket(RPC_TIMEOUT_CLOSE, "send_failed");
        if (running && isActive()) scheduleReconnect();
      }
    });
  }

  return {
    start,
    pause,
    resume,
    stop,
    request,
    getState: () => state,
    isOpen: () => Boolean(socket && socket.readyState === OPEN && state === "open"),
  };
}
