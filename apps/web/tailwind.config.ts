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
        "surface-elevated": "var(--color-surface-elevated)",
        "surface-hover": "var(--color-surface-hover)",
        border: "var(--color-border)",
        "border-active": "var(--color-border-active)",
        text: "var(--color-text)",
        "text-secondary": "var(--color-text-secondary)",
        muted: "var(--color-muted)",
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        "primary-soft": "var(--color-primary-soft)",
        "primary-foreground": "var(--color-primary-foreground)",
        info: "var(--color-info)",
        success: "var(--color-success)",
        "success-soft": "var(--color-success-soft)",
        warning: "var(--color-warning)",
        "warning-soft": "var(--color-warning-soft)",
        danger: "var(--color-danger)",
        "destructive-surface": "var(--color-destructive-surface)",
        "destructive-border": "var(--color-destructive-border)",
        "destructive-border-hover": "var(--color-destructive-border-hover)",
        "destructive-text": "var(--color-destructive-text)",
        "destructive-text-hover": "var(--color-destructive-text-hover)",
        "danger-soft": "var(--color-danger-soft)",
        sidebar: "var(--color-sidebar)",
        "sidebar-elevated": "var(--color-sidebar-elevated)",
        "sidebar-active": "var(--color-sidebar-active)",
        "sidebar-border": "var(--color-sidebar-border)",
        "sidebar-text": "var(--color-sidebar-text)",
        "sidebar-muted": "var(--color-sidebar-muted)",
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
      borderRadius: {
        panel: "var(--radius-panel)",
        control: "var(--radius-control)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        panel: "var(--shadow-panel)",
      },
    },
  },
  plugins: [],
};

export default config;
