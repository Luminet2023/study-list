/** 浏览器标签可见且窗口拥有焦点时才允许执行持久化 I/O。 */
export function isPageActive() {
  const document = globalThis.document;
  if (!document) return true;
  if (document.visibilityState !== "visible") return false;
  return typeof document.hasFocus !== "function" || document.hasFocus();
}
