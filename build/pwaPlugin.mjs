import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PUBLIC_PRECACHE_PATHS = [
  "/manifest.webmanifest",
  "/icons/app-icon-192.png",
  "/icons/app-icon-512.png",
  "/icons/app-icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
  "/assets/study-wash-bg.png",
  "/assets/study-wash-bg-dark.png",
  "/assets/seal-mark.png",
  "/assets/brush-alert.png",
  "/assets/brush-alert-dark.png",
  "/assets/page-fold.png",
  "/assets/page-fold-dark.png",
];

const SERVICE_WORKER_SCHEMA_VERSION = "1";

function bundleAssetSource(output) {
  if (output.type === "chunk") return output.code;
  if (typeof output.source === "string") return output.source;
  return Buffer.from(output.source);
}

function shouldPrecacheBundleFile(fileName) {
  // 仅预缓存图标字体；8.8 MB 的正文字体在首次受控访问时进入 runtime cache。
  return fileName === "index.html"
    || /\.(?:css|js)$/u.test(fileName)
    || /materialdesignicons-webfont-[^/]+\.woff2$/u.test(fileName);
}

export function renderServiceWorker({ version, precacheUrls }) {
  return `const VERSION = ${JSON.stringify(version)};
const PRECACHE_NAME = \`stella-precache-\${VERSION}\`;
const RUNTIME_NAME = \`stella-runtime-\${VERSION}\`;
const CACHE_PREFIX = "stella-";
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && ![PRECACHE_NAME, RUNTIME_NAME].includes(name))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_NAME);
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match("/index.html", { ignoreVary: true });
    if (cached) return cached;
    return new Response("当前处于离线状态，请恢复网络后重试。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (["font", "image", "manifest", "script", "style"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
`;
}

export function pwaServiceWorkerPlugin() {
  let projectRoot = process.cwd();

  return {
    name: "stella-pwa-service-worker",
    apply: "build",
    configResolved(config) {
      projectRoot = config.root;
    },
    async generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      const bundleUrls = [];

      hash.update(SERVICE_WORKER_SCHEMA_VERSION);
      hash.update(renderServiceWorker.toString());

      for (const [fileName, output] of Object.entries(bundle)) {
        if (!shouldPrecacheBundleFile(fileName)) continue;
        bundleUrls.push(`/${fileName}`);
        hash.update(fileName);
        hash.update(bundleAssetSource(output));
      }

      for (const publicPath of PUBLIC_PRECACHE_PATHS) {
        hash.update(publicPath);
        hash.update(await readFile(resolve(projectRoot, "public", publicPath.slice(1))));
      }

      const precacheUrls = [
        "/index.html",
        ...bundleUrls,
        ...PUBLIC_PRECACHE_PATHS,
      ].filter((value, index, values) => values.indexOf(value) === index).sort();

      this.emitFile({
        type: "asset",
        fileName: "service-worker.js",
        source: renderServiceWorker({
          version: hash.digest("hex").slice(0, 16),
          precacheUrls,
        }),
      });
    },
  };
}
