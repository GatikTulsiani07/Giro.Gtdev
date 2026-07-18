import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border-default))",
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
        "border-focus": "hsl(var(--border-focus))",
        "border-danger": "hsl(var(--border-danger))",
        background: "hsl(var(--surface-canvas))",
        foreground: "hsl(var(--text-primary))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--text-muted))",
        "text-secondary": "hsl(var(--text-secondary))",
        "text-disabled": "hsl(var(--text-disabled))",
        card: "hsl(var(--surface-panel))",
        panel: "hsl(var(--surface-panel))",
        elevated: "hsl(var(--surface-elevated))",
        sidebar: "hsl(var(--surface-sidebar))",
        inset: "hsl(var(--surface-inset))",
        interactive: "hsl(var(--surface-interactive))",
        hover: "hsl(var(--surface-hover))",
        selection: "hsl(var(--surface-selection))",
        overlay: "hsl(var(--surface-overlay))",
        accent: "hsl(var(--accent))",
        "accent-hover": "hsl(var(--accent-hover))",
        primary: "hsl(var(--accent))",
        "primary-foreground": "hsl(var(--accent-foreground))",
        success: "hsl(var(--status-success))",
        warning: "hsl(var(--status-warning))",
        danger: "hsl(var(--status-danger))",
        info: "hsl(var(--status-info))",
        code: "hsl(var(--code-background))",
        "code-foreground": "hsl(var(--code-text))",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "DM Sans", "ui-sans-serif", "system-ui"],
        display: ["var(--font-instrument-serif)", "Instrument Serif", "Georgia", "serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { control: "8px", panel: "14px", dialog: "14px", overlay: "10px", badge: "9999px" },
      boxShadow: {
        raised: "var(--shadow-elevation-1)",
        overlay: "var(--shadow-elevation-2)",
        dialog: "var(--shadow-elevation-3)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        caret: { "0%, 45%": { opacity: "1" }, "46%, 100%": { opacity: "0" } },
      },
      animation: { shimmer: "shimmer 1.2s linear infinite", caret: "caret 1.2s step-end infinite" },
      screens: {
        mobile: "821px",
        laptop: "1081px",
        desktop: "1280px",
      },
    },
  },
  plugins: [],
};

export default config;
