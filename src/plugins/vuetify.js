import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

import { createVuetify } from "vuetify";
import { md3 } from "vuetify/blueprints";
import { VSnackbarQueue } from "vuetify/components/VSnackbarQueue";
import {
  VStepperVertical,
  VStepperVerticalActions,
  VStepperVerticalItem,
} from "vuetify/components/VStepperVertical";
import { Touch } from "vuetify/directives";

export const vuetify = createVuetify({
  blueprint: md3,
  components: {
    VSnackbarQueue,
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
          "on-primary": "#FFFFFF",
          "on-secondary": "#FFFFFF",
          "on-tertiary": "#FFFFFF",
          "on-error": "#FFFFFF",
          "on-warning": "#312432",
          outline: "#847C7F",
          "outline-variant": "#CFCFCF",
        },
      },
      poeticNight: {
        dark: true,
        colors: {
          primary: "#D5B9C7",
          secondary: "#E59A94",
          tertiary: "#D7AF83",
          error: "#FFB4A8",
          warning: "#E8B86A",
          background: "#1C181B",
          surface: "#241F23",
          "surface-variant": "#3A3338",
          "on-background": "#EDE5E9",
          "on-surface": "#EDE5E9",
          "on-primary": "#2B2026",
          "on-secondary": "#351A1C",
          "on-tertiary": "#2E2012",
          "on-error": "#42130B",
          "on-warning": "#302005",
          outline: "#A99DA3",
          "outline-variant": "#51484D",
        },
      },
    },
  },
  defaults: {
    // VBtn: {
    //   elevation: 0,
    //   rounded: "sm",
    // },
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
