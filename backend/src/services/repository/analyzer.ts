// Aggregates all detectors into a single repository analysis result.

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Framework } from "./frameworks.js";
import type { PackageManager } from "./packageManagers.js";
import {
  detectFramework,
  detectPackageManager,
  detectPrimaryLanguage,
  detectMonorepo,
  detectFrontend,
  detectBackend,
  detectImportantFiles,
  detectEntrypoints,
} from "./detectors.js";

export interface AnalysisResult {
  framework: Framework;
  packageManager: PackageManager;
  primaryLanguage: string;
  monorepo: boolean;
  hasFrontend: boolean;
  hasBackend: boolean;
  importantFiles: string[];
  entrypoints: string[];
}

async function collectDirs(clonePath: string): Promise<string[]> {
  try {
    const entries = await readdir(clonePath, {
      withFileTypes: true,
      recursive: true,
    });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const abs = path.join(e.parentPath ?? clonePath, e.name);
        return path.relative(clonePath, abs);
      });
  } catch {
    return [];
  }
}

export async function analyzeRepository(
  clonePath: string,
  scanResult: { languages: Record<string, number>; tree: string[] },
): Promise<AnalysisResult> {
  const topLevelFiles = scanResult.tree.filter((e) => !e.includes("/"));
  const topLevelDirs = scanResult.tree
    .filter((e) => e.endsWith("/"))
    .map((e) => e.slice(0, -1));

  const allDirs = await collectDirs(clonePath);

  const [framework, importantFiles, entrypoints] = await Promise.all([
    detectFramework(clonePath, topLevelFiles),
    detectImportantFiles(clonePath),
    detectEntrypoints(clonePath),
  ]);

  return {
    framework,
    packageManager: detectPackageManager(topLevelFiles),
    primaryLanguage: detectPrimaryLanguage(scanResult.languages),
    monorepo: detectMonorepo(topLevelFiles, topLevelDirs),
    hasFrontend: detectFrontend(allDirs),
    hasBackend: detectBackend(allDirs),
    importantFiles,
    entrypoints,
  };
}
