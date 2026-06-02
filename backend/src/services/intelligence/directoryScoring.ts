// Ranks directories by architectural importance using deterministic heuristics.

import type { DirectoryScore } from "./types.js";

// Each rule: a regex over the (forward-slash) relative dir path + weight + reason.
const RULES: Array<{ pattern: RegExp; score: number; reason: string }> = [
  { pattern: /(^|\/)src\/routes$/, score: 95, reason: "HTTP route definitions" },
  { pattern: /(^|\/)src\/services$/, score: 90, reason: "Core business logic" },
  { pattern: /(^|\/)src\/db$/, score: 88, reason: "Database layer" },
  { pattern: /(^|\/)prisma$/, score: 88, reason: "ORM schema + migrations" },
  { pattern: /(^|\/)src\/controllers$/, score: 85, reason: "Request controllers" },
  { pattern: /(^|\/)src\/models$/, score: 82, reason: "Data models" },
  { pattern: /(^|\/)src\/middleware$/, score: 80, reason: "Request middleware" },
  { pattern: /(^|\/)app$/, score: 80, reason: "Application/router root" },
  { pattern: /(^|\/)pages$/, score: 78, reason: "Page-based routing" },
  { pattern: /(^|\/)src\/lib$/, score: 70, reason: "Shared libraries" },
  { pattern: /(^|\/)src\/components$/, score: 68, reason: "UI components" },
  { pattern: /(^|\/)src$/, score: 60, reason: "Primary source root" },
  { pattern: /(^|\/)packages$/, score: 75, reason: "Monorepo packages" },
  { pattern: /(^|\/)apps$/, score: 75, reason: "Monorepo apps" },
  { pattern: /(^|\/)tests?$/, score: 40, reason: "Test suite" },
  { pattern: /(^|\/)config$/, score: 45, reason: "Configuration" },
];

export function scoreDirectories(allDirs: string[]): DirectoryScore[] {
  const scored: DirectoryScore[] = [];

  for (const dir of allDirs) {
    const normalized = dir.split("\\").join("/");
    for (const rule of RULES) {
      if (rule.pattern.test(normalized)) {
        scored.push({ path: normalized, score: rule.score, reason: rule.reason });
        break; // first (highest-priority) rule wins
      }
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 15);
}
