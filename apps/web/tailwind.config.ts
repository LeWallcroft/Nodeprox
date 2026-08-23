import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        text: "var(--color-text)",
        muted: "var(--color-muted)",
        primary: "var(--color-primary)",
        "primary-soft": "var(--color-primary-soft)",
      },
      spacing: {
        page: "var(--page-padding)",
        "page-mobile": "var(--page-padding-mobile)",
        section: "var(--section-gap)",
        card: "var(--card-gap)",
      },
      width: {
        sidebar: "var(--sidebar-width)",
        "sidebar-collapsed": "var(--sidebar-collapsed)",
        content: "var(--content-max)",
      },
      minHeight: {
        control: "var(--control-height)",
        "control-lg": "var(--control-height-lg)",
      },
      height: {
        control: "var(--control-height)",
        "control-lg": "var(--control-height-lg)",
      },
      maxWidth: {
        content: "var(--content-max)",
      },
    },
  },
  plugins: [],
};

export default config;
