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
