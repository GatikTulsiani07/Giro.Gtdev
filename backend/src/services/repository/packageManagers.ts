// Package manager detection via lock files, in priority order.

export type PackageManager =
  | "pnpm"
  | "yarn"
  | "npm"
  | "bun"
  | "pip"
  | "cargo"
  | "go"
  | "unknown";

export const LOCK_FILE_MAP: Array<{ file: string; pm: PackageManager }> = [
  { file: "bun.lockb", pm: "bun" },
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
  { file: "requirements.txt", pm: "pip" },
  { file: "Cargo.lock", pm: "cargo" },
  { file: "go.sum", pm: "go" },
];
