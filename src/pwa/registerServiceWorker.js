export function registerPwaServiceWorker({
  navigatorObject = globalThis.navigator,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  if (!navigatorObject?.serviceWorker || !windowObject || !documentObject) return;

  const register = async () => {
    try {
      await navigatorObject.serviceWorker.register("/service-worker.js", {
        scope: "/",
        updateViaCache: "none",
      });
    } catch (error) {
      console.warn("PWA Service Worker 注册失败", error);
    }
  };

  if (documentObject.readyState === "complete") {
    void register();
    return;
  }

  windowObject.addEventListener("load", register, { once: true });
}
