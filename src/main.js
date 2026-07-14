import { createApp } from "vue";

import "@fontsource-variable/cormorant-garamond/wght.css";

import App from "./App.vue";
import { installBuildFlag } from "./buildFlag.js";
import { vuetify } from "./plugins/vuetify";
import { registerPwaServiceWorker } from "./pwa/registerServiceWorker.js";
import { router } from "./router/index.js";
import "./styles.css";

installBuildFlag(globalThis, __COMMIT_HASH__);

const app = createApp(App);

app.use(vuetify);
app.use(router);

router.isReady().then(() => {
  app.mount("#app");
  if (import.meta.env.PROD) registerPwaServiceWorker();
});
