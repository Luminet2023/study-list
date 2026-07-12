import { createApp } from "vue";

import "@fontsource-variable/cormorant-garamond/wght.css";

import App from "./App.vue";
import { vuetify } from "./plugins/vuetify";
import "./styles.css";

createApp(App).use(vuetify).mount("#app");
