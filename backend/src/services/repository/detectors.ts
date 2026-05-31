// Pure-Node detectors for repository intelligence signals.

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  FRAMEWORK_FILE_SIGNALS,
  FRAMEWORK_PACKAGE_SIGNALS,
  type Framework,
} from "./frameworks.js";
import { LOCK_FILE_MAP, type PackageManager } from "./packageManagers.js";

async function exists(p: string): Promise<boolean> {
  return access(p, constants.F_OK).then(
    () => true,
    () => false,
  );
}

export async function detectFramework(
  clonePath: string,
  topLevelFiles: string[],
): Promise<Framework> {
  const fileSet = new Set(topLevelFiles);
  for (const signal of FRAMEWORK_FILE_SIGNALS) {
    if (fileSet.has(signal.file)) return signal.framework;
  }

  const deps = await readFile(path.join(clonePath, "package.json"), "utf8")
    .then((raw) => {
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
    })
    .catch(() => new Set<string>());

  for (const signal of FRAMEWORK_PACKAGE_SIGNALS) {
    if (deps.has(signal.dep)) return signal.framework;
  }
  return "unknown";
}

export function detectPackageManager(topLevelFiles: string[]): PackageManager {
  const fileSet = new Set(topLevelFiles);
  for (const entry of LOCK_FILE_MAP) {
    if (fileSet.has(entry.file)) return entry.pm;
  }
  return "unknown";
}

const EXCLUDED_LANG_EXT = new Set([
  ".json", ".md", ".txt", ".yml", ".yaml", ".lock", ".toml", ".env", "none",
]);

export function detectPrimaryLanguage(languages: Record<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [ext, count] of Object.entries(languages)) {
    if (EXCLUDED_LANG_EXT.has(ext)) continue;
    if (count > bestCount) {
      best = ext;
      bestCount = count;
    }
  }
  if (best === "") return "unknown";
  return best.startsWith(".") ? best.slice(1) : best;
}

export function detectMonorepo(topLevelFiles: string[], topLevelDirs: string[]): boolean {
  const files = new Set(topLevelFiles);
  const dirs = new Set(topLevelDirs);
  if (files.has("pnpm-workspace.yaml")) return true;
  if (files.has("turbo.json")) return true;
  if (files.has("lerna.json")) return true;
  return dirs.has("apps") && dirs.has("packages");
}

function segmentMatch(allDirs: string[], targets: Set<string>): boolean {
  return allDirs.some((dir) =>
    dir.split("/").some((seg) => targets.has(seg.toLowerCase())),
  );
}

export function detectFrontend(allDirs: string[]): boolean {
  return segmentMatch(
    allDirs,
    new Set(["app", "pages", "components", "public", "views", "ui"]),
  );
}

export function detectBackend(allDirs: string[]): boolean {
  return segmentMatch(
    allDirs,
    new Set(["api", "server", "routes", "controllers", "handlers", "middleware"]),
  );
}

async function filterExisting(clonePath: string, candidates: string[]): Promise<string[]> {
  const checks = await Promise.all(
    candidates.map((rel) => exists(path.join(clonePath, rel))),
  );
  return candidates.filter((_, i) => checks[i]);
}

export function detectImportantFiles(clonePath: string): Promise<string[]> {
  return filterExisting(clonePath, [
    "package.json", "tsconfig.json", "Dockerfile", "docker-compose.yml",
    "docker-compose.yaml", "turbo.json", "pnpm-workspace.yaml",
    "prisma/schema.prisma", "next.config.js", "next.config.ts",
    ".env.example", ".github/workflows",
  ]);
}

export function detectEntrypoints(clonePath: string): Promise<string[]> {
  return filterExisting(clonePath, [
    "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
    "src/app.ts", "src/server.ts", "app/page.tsx", "app/layout.tsx",
    "main.py", "cmd/main.go", "main.go", "index.js",
  ]);
}
