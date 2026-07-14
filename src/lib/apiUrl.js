const configuredApiBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim() ?? "";

function normalizedApiPath(path) {
  const normalized = String(path ?? "").replace(/^\/+/, "");
  if (!normalized) throw new TypeError("API path must not be empty");
  return normalized;
}

function normalizedApiBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("API base URL must use HTTP or HTTPS");
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function resolveApiUrl(path, baseUrl = configuredApiBaseUrl) {
  const normalizedPath = normalizedApiPath(path);
  if (!baseUrl) return `/${normalizedPath}`;
  return new URL(normalizedPath, normalizedApiBaseUrl(baseUrl)).toString();
}

export function resolveApiWebSocketUrl(
  path,
  {
    baseUrl = configuredApiBaseUrl,
    locationHref = globalThis.location?.href,
  } = {},
) {
  const resolved = resolveApiUrl(path, baseUrl);
  if (!baseUrl && !locationHref) return resolved;

  const url = locationHref ? new URL(resolved, locationHref) : new URL(resolved);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new TypeError("WebSocket API URL must use HTTP or HTTPS");
  return url.toString();
}
