import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderServiceWorker } from "../build/pwaPlugin.mjs";
import { registerPwaServiceWorker } from "../src/pwa/registerServiceWorker.js";

const ROOT = new URL("../", import.meta.url);

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("PWA manifest declares installable icons and standalone navigation", async () => {
  const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", ROOT), "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("PWA icon files have the dimensions declared by the manifest", async () => {
  const expected = new Map([
    ["public/icons/app-icon-192.png", 192],
    ["public/icons/app-icon-512.png", 512],
    ["public/icons/app-icon-maskable-512.png", 512],
    ["public/icons/apple-touch-icon-180.png", 180],
  ]);

  for (const [path, size] of expected) {
    const dimensions = pngDimensions(await readFile(new URL(path, ROOT)));
    assert.deepEqual(dimensions, { width: size, height: size });
  }
});

test("generated Service Worker bypasses APIs and provides offline navigation", () => {
  const source = renderServiceWorker({
    version: "test-version",
    precacheUrls: ["/index.html", "/assets/index-test.js"],
  });
  assert.match(source, /url\.pathname\.startsWith\("\/v1\/"\)/u);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(source, /request\.mode === "navigate"/u);
  assert.match(source, /caches\.match\("\/index\.html", \{ ignoreVary: true \}\)/u);
  assert.match(source, /ignoreSearch: true, ignoreVary: true/u);
  assert.match(source, /\/assets\/index-test\.js/u);
});

test("PWA registration requests a root scope without using the HTTP cache", async () => {
  const calls = [];
  const listeners = [];
  registerPwaServiceWorker({
    navigatorObject: {
      serviceWorker: {
        register: async (...args) => calls.push(args),
      },
    },
    windowObject: {
      addEventListener: (...args) => listeners.push(args),
    },
    documentObject: { readyState: "loading" },
  });

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], "load");
  await listeners[0][1]();
  assert.deepEqual(calls, [[
    "/service-worker.js",
    { scope: "/", updateViaCache: "none" },
  ]]);
});
