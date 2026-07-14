import { resolveApiUrl } from "../src/lib/apiUrl.js";

export const API_BASE_URL = process.env.API_BASE_URL ?? "https://api.luminet.cn/hifumi/";

const frontendUrl = new URL(
  process.env.FRONTEND_ORIGIN ?? "https://stellafortuna.luminet.cn",
);
if (
  !["http:", "https:"].includes(frontendUrl.protocol)
  || frontendUrl.pathname !== "/"
  || frontendUrl.search
  || frontendUrl.hash
) {
  throw new Error("FRONTEND_ORIGIN 必须是无路径、查询参数和片段的绝对 origin");
}
export const FRONTEND_ORIGIN = frontendUrl.origin;

export const SESSION_ISSUER = new URL(API_BASE_URL).toString().replace(/\/+$/u, "");

export function apiUrl(path) {
  return resolveApiUrl(path, API_BASE_URL);
}

export function apiRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", frontendUrl.origin);
  if (!headers.has("referer")) headers.set("referer", `${frontendUrl.origin}/`);
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
    referrerPolicy: "strict-origin-when-cross-origin",
  });
}
