import { getSession, handleLinuxDoCallback, handleLinuxDoLogin, handleLogout, handleSession } from "./auth.js";
import { sha256Hex } from "./jwt.js";
import { base64ToBytes, bytesToBase64 } from "../src/sync/protocol.js";
import { SYNC_WEBSOCKET_PATH, SYNC_WEBSOCKET_PROTOCOL } from "../src/sync/webSocketFrames.js";
export { UserSyncCoordinator } from "./syncCoordinator.js";

const JSON_TYPE = "application/json";
const MAX_PROTOBUF_BYTES = 512 * 1024;
const MAX_SYNC_ENVELOPE_BYTES = Math.ceil(MAX_PROTOBUF_BYTES * 4 / 3) + 128;

function apiError(status, error, headers = {}) {
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin;
}

function exactSameOrigin(request, url) {
  return request.headers.get("origin") === url.origin;
}

function hasWebSocketProtocol(request, protocol) {
  return (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .some((candidate) => candidate.trim() === protocol);
}

function sanitizedSyncHeaders(request, ownerKey, sessionExp) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-stella-")) headers.delete(name);
  }
  headers.set("x-stella-owner-key", ownerKey);
  headers.set("x-stella-session-exp", String(sessionExp));
  return headers;
}

async function handleSyncWebSocket(request, env, url) {
  if (request.method !== "GET") {
    return apiError(405, "method_not_allowed", { allow: "GET" });
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return apiError(426, "websocket_upgrade_required", { upgrade: "websocket" });
  }
  if (!exactSameOrigin(request, url)) return apiError(403, "invalid_origin");

  const session = await getSession(request, env);
  const sessionExp = Number(session?.exp);
  if (
    !session ||
    typeof session.sub !== "string" ||
    !session.sub ||
    !Number.isSafeInteger(sessionExp) ||
    sessionExp <= Math.floor(Date.now() / 1000)
  ) {
    return apiError(401, "authentication_required");
  }
  if (!hasWebSocketProtocol(request, SYNC_WEBSOCKET_PROTOCOL)) {
    return apiError(400, "websocket_subprotocol_required");
  }

  const ownerKey = await sha256Hex(`linuxdo:${session.sub}`);
  const coordinator = env.USER_SYNC.getByName(ownerKey);
  return coordinator.fetch(new Request(request, {
    headers: sanitizedSyncHeaders(request, ownerKey, sessionExp),
  }));
}

function logLegacySync(operation) {
  console.log(JSON.stringify({
    event: "sync_transport",
    transport: "http_legacy",
    operation,
  }));
}

async function handleSync(request, env) {
  const session = await getSession(request, env);
  if (!session) return apiError(401, "authentication_required");
  const body = await readProtobufEnvelope(request);
  if (body instanceof Response) return body;
  const ownerKey = await sha256Hex(`linuxdo:${session.sub}`);
  const coordinator = env.USER_SYNC.getByName(ownerKey);
  logLegacySync("exchange");
  const result = await coordinator.exchange(body, ownerKey);
  return protobufEnvelopeResponse(result);
}

async function readProtobufEnvelope(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith(JSON_TYPE)) {
    return apiError(415, "json_base64_protobuf_required");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SYNC_ENVELOPE_BYTES) return apiError(413, "sync_payload_too_large");
  const encodedBody = new Uint8Array(await request.arrayBuffer());
  if (encodedBody.length > MAX_SYNC_ENVELOPE_BYTES) return apiError(413, "sync_payload_too_large");
  let protobuf;
  try {
    const envelope = JSON.parse(new TextDecoder().decode(encodedBody));
    if (typeof envelope?.protobuf !== "string") throw new TypeError("missing protobuf field");
    protobuf = base64ToBytes(envelope.protobuf);
  } catch {
    return apiError(400, "invalid_sync_envelope");
  }
  if (protobuf.length > MAX_PROTOBUF_BYTES) return apiError(413, "sync_payload_too_large");
  return protobuf;
}

function protobufEnvelopeResponse(result) {
  if (result.retryAfterMs > 0) {
    return apiError(429, "sync_rate_limited", {
      "retry-after": String(Math.ceil(result.retryAfterMs / 1000)),
    });
  }
  return Response.json({ protobuf: bytesToBase64(result.body) }, {
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handleResolveBaseline(request, env) {
  const session = await getSession(request, env);
  if (!session) return apiError(401, "authentication_required");
  const body = await readProtobufEnvelope(request);
  if (body instanceof Response) return body;
  const ownerKey = await sha256Hex(`linuxdo:${session.sub}`);
  const coordinator = env.USER_SYNC.getByName(ownerKey);
  logLegacySync("resolve");
  const result = await coordinator.resolveBaseline(body, ownerKey);
  return protobufEnvelopeResponse(result);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === SYNC_WEBSOCKET_PATH) {
        return await handleSyncWebSocket(request, env, url);
      }
      if (url.pathname === "/api/v1/auth/login/linuxdo" && request.method === "GET") {
        return await handleLinuxDoLogin(request, env);
      }
      if (url.pathname === "/api/v1/auth/callback" && request.method === "GET") {
        return await handleLinuxDoCallback(request, env);
      }
      if (url.pathname === "/api/v1/auth/session" && request.method === "GET") {
        return await handleSession(request, env);
      }
      if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
        if (!sameOrigin(request, url)) return apiError(403, "invalid_origin");
        return handleLogout();
      }
      if (url.pathname === "/api/v1/sync/exchange" && request.method === "POST") {
        if (!sameOrigin(request, url)) return apiError(403, "invalid_origin");
        return await handleSync(request, env);
      }
      if (url.pathname === "/api/v1/sync/resolve" && request.method === "POST") {
        if (!sameOrigin(request, url)) return apiError(403, "invalid_origin");
        return await handleResolveBaseline(request, env);
      }
      if (url.pathname.startsWith("/api/")) return apiError(404, "not_found");
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", path: url.pathname, message: error?.message }));
      if (url.pathname === "/api/v1/auth/callback") {
        const target = new URL("/day/2026-07-13?auth_error=oauth_failed", url.origin);
        return Response.redirect(target, 302);
      }
      return apiError(500, "internal_error");
    }
  },
};
