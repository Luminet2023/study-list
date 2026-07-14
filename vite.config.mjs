import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

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
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8787",
        // 保留 localhost:4173，让 OAuth callback 与 Origin 校验使用前端地址。
        changeOrigin: false,
      },
    },
    warmup: {
      clientFiles: ["./src/main.js", "./src/App.vue", "./src/components/WorkdayView.vue"],
    },
  },
  plugins: [vue(), vuetify({ autoImport: true })],
});
