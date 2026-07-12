import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

import { createVuetify } from "vuetify";
import { md3 } from "vuetify/blueprints";
import { Touch } from "vuetify/directives";
import {
  VStepperVertical,
  VStepperVerticalActions,
  VStepperVerticalItem,
} from "vuetify/labs/VStepperVertical";

export const vuetify = createVuetify({
  blueprint: md3,
  components: {
    VStepperVertical,
    VStepperVerticalActions,
    VStepperVerticalItem,
  },
  directives: { Touch },
  theme: {
    defaultTheme: "poeticPaper",
    themes: {
      poeticPaper: {
        dark: false,
        colors: {
          primary: "#74626B",
          secondary: "#B6605C",
          tertiary: "#B38B62",
          error: "#9B3A2E",
          warning: "#C98B2A",
          background: "#FDFBF8",
          surface: "#FBF9F5",
          "surface-variant": "#F1F0EE",
          "on-background": "#312432",
          "on-surface": "#312432",
          outline: "#847C7F",
          "outline-variant": "#CFCFCF",
        },
      },
    },
  },
  defaults: {
    VBtn: {
      elevation: 0,
      rounded: "sm",
    },
    VCard: {
      elevation: 0,
      rounded: "lg",
    },
    VTextField: {
      color: "primary",
      density: "compact",
      hideDetails: "auto",
      variant: "underlined",
    },
    VTextarea: {
      color: "primary",
      hideDetails: "auto",
      variant: "underlined",
    },
  },
});
