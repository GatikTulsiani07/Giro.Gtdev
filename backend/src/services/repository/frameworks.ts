// Framework detection signals. File signals take priority over package.json signals.

export type Framework =
  | "next"
  | "vite"
  | "astro"
  | "remix"
  | "hono"
  | "express"
  | "python"
  | "rust"
  | "go"
  | "unknown";

export const FRAMEWORK_FILE_SIGNALS: Array<{ file: string; framework: Framework }> = [
  { file: "next.config.js", framework: "next" },
  { file: "next.config.ts", framework: "next" },
  { file: "astro.config.mjs", framework: "astro" },
  { file: "astro.config.ts", framework: "astro" },
  { file: "remix.config.js", framework: "remix" },
  { file: "vite.config.ts", framework: "vite" },
  { file: "vite.config.js", framework: "vite" },
  { file: "requirements.txt", framework: "python" },
  { file: "Cargo.toml", framework: "rust" },
  { file: "go.mod", framework: "go" },
];

export const FRAMEWORK_PACKAGE_SIGNALS: Array<{ dep: string; framework: Framework }> = [
  { dep: "next", framework: "next" },
  { dep: "hono", framework: "hono" },
  { dep: "express", framework: "express" },
  { dep: "fastify", framework: "express" },
  { dep: "@remix-run/node", framework: "remix" },
  { dep: "astro", framework: "astro" },
];
