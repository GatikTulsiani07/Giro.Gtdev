// Heuristic repository intelligence summary from top-level + shallow signals.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { IGNORED_DIRS } from "../repository/ignore.js";
import type { RepoSummary } from "./types.js";

export async function buildSummary(repoPath: string): Promise<RepoSummary> {
  const root = await readdir(repoPath, { withFileTypes: true });
  const rootFiles = new Set(root.filter((e) => e.isFile()).map((e) => e.name));
  const rootDirs = root
    .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && e.name !== ".git")
    .map((e) => e.name);

  const has = (name: string) => rootFiles.has(name);

  const packageManagers: string[] = [];
  if (has("pnpm-lock.yaml")) packageManagers.push("pnpm");
  if (has("yarn.lock")) packageManagers.push("yarn");
  if (has("package-lock.json")) packageManagers.push("npm");
  if (has("requirements.txt") || has("poetry.lock")) packageManagers.push("pip");
  if (has("go.mod")) packageManagers.push("go modules");
  if (has("Cargo.toml")) packageManagers.push("cargo");

  const frameworks: string[] = [];
  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts"))
    frameworks.push("next.js");
  if (has("nuxt.config.ts")) frameworks.push("nuxt");
  if (has("vite.config.ts") || has("vite.config.js")) frameworks.push("vite");
  if (has("angular.json")) frameworks.push("angular");

  const buildSystems: string[] = [];
  if (has("tsconfig.json")) buildSystems.push("typescript");
  if (has("turbo.json")) buildSystems.push("turborepo");
  if (has("nx.json")) buildSystems.push("nx");
  if (has("Makefile")) buildSystems.push("make");

  const testFrameworks: string[] = [];
  if (has("jest.config.js") || has("jest.config.ts")) testFrameworks.push("jest");
  if (has("vitest.config.ts")) testFrameworks.push("vitest");
  if (has("playwright.config.ts")) testFrameworks.push("playwright");

  const configFiles = [...rootFiles].filter(
    (f) => f.includes("config") || f.endsWith(".json") || f.endsWith(".yaml"),
  );
  const envFiles = [...rootFiles].filter((f) => f.startsWith(".env"));
  const ciFiles = rootDirs.includes(".github") ? [".github/workflows"] : [];

  const usesDocker = has("Dockerfile") || has("docker-compose.yml");
  const lower = rootDirs.map((d) => d.toLowerCase());
  const backendDirs = rootDirs.filter((d) =>
    ["backend", "api", "server"].includes(d.toLowerCase()),
  );
  const frontendDirs = rootDirs.filter((d) =>
    ["frontend", "web", "client", "app"].includes(d.toLowerCase()),
  );
  const isMonorepo =
    rootDirs.includes("packages") || lower.includes("apps") || has("turbo.json");

  return {
    packageManagers,
    frameworks,
    buildSystems,
    testFrameworks,
    configFiles,
    envFiles,
    ciFiles,
    usesDocker,
    isMonorepo,
    backendDirs,
    frontendDirs,
  };
}
