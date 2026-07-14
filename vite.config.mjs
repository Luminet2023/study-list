import { execFileSync } from "node:child_process";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

import { pwaServiceWorkerPlugin } from "./build/pwaPlugin.mjs";

function resolveCommitHash() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL(".", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const commitHash = resolveCommitHash();

const pageChunks = new Map([
  ["/src/components/FavoritesView.vue", "page-favorites"],
  ["/src/components/MarkdownContent.vue", "page-day"],
  ["/src/components/MarkdownEditorDialog.vue", "page-day"],
  ["/src/components/MonthOverview.vue", "page-month"],
  ["/src/components/RaffleView.vue", "page-raffle"],
  ["/src/components/SaturdayView.vue", "page-saturday"],
  ["/src/components/SettingsView.vue", "page-settings"],
  ["/src/components/TotalStatsView.vue", "page-total-stats"],
  ["/src/components/WeekOverview.vue", "page-week"],
  ["/src/components/WeekStatsView.vue", "page-week-stats"],
  ["/src/components/WorkdayView.vue", "page-day"],
  ["/src/lib/markdown.js", "page-day"],
  ["/src/lib/undoHistory.js", "page-day"],
]);

const markdownPackages = /\/node_modules\/(entities|markdown-it|linkify-it|mdurl|uc\.micro|punycode\.js)\//;

function manualChunks(id) {
  const normalizedId = id.replaceAll("\\", "/");
  for (const [file, chunk] of pageChunks) {
    if (normalizedId.includes(file)) return chunk;
  }
  if (markdownPackages.test(normalizedId)) return "vendor-markdown";
  return undefined;
}

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: "assets/chunks/[name]-[hash].js",
        manualChunks,
      },
    },
  },
  optimizeDeps: {
    include: ["vue", "vuetify"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/v1": {
        // target 自带 /hifumi 前缀，因此 /v1/* 会转发为 /hifumi/v1/*。
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080/hifumi",
        // 保留 localhost 前端 Host/Origin，便于验证 Go API 的来源策略。
        changeOrigin: false,
        ws: true,
      },
    },
    warmup: {
      clientFiles: ["./src/main.js", "./src/App.vue", "./src/components/WorkdayView.vue"],
    },
  },
  plugins: [vue(), vuetify({ autoImport: true }), pwaServiceWorkerPlugin()],
});
