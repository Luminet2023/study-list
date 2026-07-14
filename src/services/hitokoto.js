export const HITOKOTO_ENDPOINT = "https://v1.hitokoto.cn/";

export const HITOKOTO_CATEGORIES = Object.freeze([
  { value: "a", label: "动画" },
  { value: "b", label: "漫画" },
  { value: "c", label: "游戏" },
  { value: "d", label: "文学" },
  { value: "e", label: "原创" },
  { value: "f", label: "来自网络" },
  { value: "g", label: "其他" },
  { value: "h", label: "影视" },
  { value: "i", label: "诗词" },
  { value: "j", label: "网易云" },
  { value: "k", label: "哲学" },
  { value: "l", label: "抖机灵" },
]);

const CATEGORY_VALUES = new Set(HITOKOTO_CATEGORIES.map((item) => item.value));

export function normalizeHitokotoCategories(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).filter((value) => CATEGORY_VALUES.has(value)))].sort();
}

export function buildHitokotoUrl(categories = []) {
  const url = new URL(HITOKOTO_ENDPOINT);
  for (const category of normalizeHitokotoCategories(categories)) {
    url.searchParams.append("c", category);
  }
  url.searchParams.set("encode", "json");
  url.searchParams.set("charset", "utf-8");
  return url;
}

export function normalizeHitokotoPayload(payload) {
  const uuid = String(payload?.uuid ?? "").trim();
  const hitokoto = String(payload?.hitokoto ?? "").trim();
  if (!uuid || !hitokoto) throw new TypeError("一言响应缺少 uuid 或 hitokoto");
  return {
    uuid,
    hitokoto,
    type: String(payload?.type ?? "").trim() || null,
    from: String(payload?.from ?? "").trim() || null,
    fromWho: String(payload?.from_who ?? "").trim() || null,
  };
}

export async function fetchHitokoto(categories = [], options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const response = await fetchImpl(buildHitokotoUrl(categories), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: options.signal,
  });
  if (!response?.ok) {
    throw new Error(`一言请求失败（HTTP ${response?.status ?? "unknown"}）`);
  }
  return normalizeHitokotoPayload(await response.json());
}

function delay(milliseconds, signal) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener?.("abort", () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export async function fetchUniqueHitokoto(categories = [], options = {}) {
  const usedUuids = options.usedUuids instanceof Set
    ? options.usedUuids
    : new Set(options.usedUuids ?? []);
  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 5));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 550));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await fetchHitokoto(categories, options);
    if (!usedUuids.has(result.uuid)) return result;
    if (attempt + 1 < maxAttempts) await delay(retryDelayMs, options.signal);
  }
  throw new Error("一言连续返回已绑定句子，请稍后重试");
}
