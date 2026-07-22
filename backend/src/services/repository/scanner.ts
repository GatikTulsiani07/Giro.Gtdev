// Walks a cloned repository and produces aggregate stats + a top-level tree.

import { readdir } from "node:fs/promises";
import type { TrustedRepositoryCheckoutPath } from "../security/repositoryPaths.js";
import { scanRepositoryQuota } from "./quotas/repositoryQuotaScanner.js";
import { runtimeRepositoryQuotas, type RepositoryQuotas } from "./quotas/repositoryQuota.js";

export interface ScannedFile {
  filePath: string;
  size: number;
  language: string;
}

export interface ScanStats {
  totalFiles: number;
  totalDirectories: number;
  languages: Record<string, number>;
  tree: string[];
  files: ScannedFile[];
  repositoryBytes?: number;
  indexedTextBytes?: number;
  symlinkCount?: number;
  binaryFileCount?: number;
}

export async function scanRepo(
  clonePath: TrustedRepositoryCheckoutPath,
  quotas: RepositoryQuotas = runtimeRepositoryQuotas,
  signal?: AbortSignal,
): Promise<ScanStats> {
  const quotaScan = await scanRepositoryQuota(clonePath, quotas, signal);
  const tree = await buildTree(clonePath);
  return {
    totalFiles: quotaScan.files.length,
    totalDirectories: quotaScan.directoryCount,
    languages: quotaScan.languages,
    tree,
    files: quotaScan.files,
    repositoryBytes: quotaScan.repositoryBytes,
    indexedTextBytes: quotaScan.indexedTextBytes,
    symlinkCount: quotaScan.symlinkCount,
    binaryFileCount: quotaScan.binaryFileCount,
  };
}

async function buildTree(clonePath: string): Promise<string[]> {
  const entries = await readdir(clonePath, { withFileTypes: true });
  return entries
    .filter((e) => e.name !== ".git" && !e.isSymbolicLink())
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort((a, b) => a.localeCompare(b));
}
