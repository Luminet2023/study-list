import { resolveApiUrl } from "../lib/apiUrl.js";
import { base64ToBytes, bytesToBase64 } from "./protocol.js";

export const MAX_HTTP_PROTOBUF_BYTES = 512 * 1024;
const MAX_BASE64_BYTES = Math.ceil(MAX_HTTP_PROTOBUF_BYTES * 4 / 3) + 4;

export class SyncHttpError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = "SyncHttpError";
    this.code = code;
    Object.assign(this, extra);
  }
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(Math.ceil(seconds * 1000), 1000);
  const date = Date.parse(value ?? "");
  return Number.isNaN(date) ? 1000 : Math.max(date - Date.now(), 1000);
}

export async function postSyncProtobuf(path, protobuf, options = {}) {
  const bytes = protobuf instanceof Uint8Array ? protobuf : new Uint8Array(protobuf ?? 0);
  if (bytes.length > MAX_HTTP_PROTOBUF_BYTES) {
    throw new SyncHttpError("同步请求超过 512 KiB", "REQUEST_TOO_LARGE");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new SyncHttpError("当前环境不支持 fetch", "FETCH_UNAVAILABLE");
  let response;
  try {
    response = await fetchImpl(resolveApiUrl(path, options.apiBaseUrl), {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ protobuf: bytesToBase64(bytes) }),
      referrerPolicy: "strict-origin-when-cross-origin",
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new SyncHttpError("同步请求已暂停", "SYNC_PAUSED", { cause: error });
    }
    throw new SyncHttpError("无法连接同步接口", "CONNECTION_LOST", { cause: error });
  }
  if (response.status === 401) throw new SyncHttpError("登录已失效", "AUTH_REQUIRED");
  if (response.status === 413) {
    throw new SyncHttpError("同步响应过大，需要缩小批次", "SYNC_RESPONSE_TOO_LARGE");
  }
  if (response.status === 429) {
    throw new SyncHttpError("云同步请求过于频繁", "RATE_LIMITED", {
      retryAfterMs: retryAfterMs(response),
    });
  }
  if (!response.ok) {
    throw new SyncHttpError(`同步接口返回 ${response.status}`, "HTTP_ERROR", {
      status: response.status,
    });
  }
  let envelope;
  try {
    envelope = await response.json();
  } catch (cause) {
    if (options.signal?.aborted) {
      throw new SyncHttpError("同步请求已暂停", "SYNC_PAUSED", { cause });
    }
    throw new SyncHttpError("同步接口返回了无效 JSON", "INVALID_RESPONSE", { cause });
  }
  if (!envelope || typeof envelope.protobuf !== "string" || envelope.protobuf.length > MAX_BASE64_BYTES) {
    throw new SyncHttpError("同步接口返回了无效 Protobuf 信封", "INVALID_RESPONSE");
  }
  let result;
  try {
    result = base64ToBytes(envelope.protobuf);
  } catch (cause) {
    throw new SyncHttpError("同步接口返回了无效 Base64", "INVALID_RESPONSE", { cause });
  }
  if (result.length > MAX_HTTP_PROTOBUF_BYTES) {
    throw new SyncHttpError("同步响应超过 512 KiB", "RESPONSE_TOO_LARGE");
  }
  return result;
}
