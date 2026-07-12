import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

export default defineConfig({
  optimizeDeps: {
    include: ["vue", "vuetify"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.js", "./src/App.vue"],
    },
  },
  plugins: [vue(), vuetify({ autoImport: true })],
});
