/** 浏览器标签可见时允许维持只读长连接。 */
export function isPageVisible() {
  const document = globalThis.document;
  if (!document) return true;
  return document.visibilityState === "visible";
}

/** 浏览器标签可见且窗口拥有焦点时才允许执行持久化 I/O。 */
export function isPageActive() {
  if (!isPageVisible()) return false;
  const document = globalThis.document;
  if (!document) return true;
  return typeof document.hasFocus !== "function" || document.hasFocus();
}
