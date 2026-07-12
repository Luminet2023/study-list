import { createApp } from "vue";

import "@fontsource-variable/cormorant-garamond/wght.css";

import App from "./App.vue";
import { vuetify } from "./plugins/vuetify";
import { router } from "./router/index.js";
import "./styles.css";

const app = createApp(App);

app.use(vuetify);
app.use(router);

router.isReady().then(() => app.mount("#app"));
