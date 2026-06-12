// Incremental index execution layer. Turns a RepositoryIndexingPlan from
// planning into execution by running per-file analysis over exactly the files
// the plan selects:
//   - full        -> every current file is analyzed
//   - incremental -> only the plan's added (changed) files are analyzed;
//                    unchanged files are skipped, removed files are absent.
//
// Determinism guarantees:
// - No timestamps, no randomness
// - Selected files are sorted ascending by filePath
// - Inputs (plan, currentFiles) are never mutated
// - Same inputs + same analyzeFile produce identical analyzedFiles/skippedFiles

import type { ScannedFile } from "./scanner.js";
import type { RepositoryIndexingPlan, IndexingMode } from "./indexingPlan.js";

export interface IndexingExecutionResult<T> {
  mode: IndexingMode;
  analyzedFiles: string[]; // sorted ascending — paths actually analyzed
  skippedFiles: string[]; // sorted ascending — current files intentionally skipped
  results: T[]; // analyzeFile output, in analyzedFiles order
}

function byPath(a: ScannedFile, b: ScannedFile): number {
  return a.filePath.localeCompare(b.filePath);
}

// Pure: resolves which current files the plan wants analyzed.
export function selectFilesForIndexing(
  plan: RepositoryIndexingPlan,
  currentFiles: ScannedFile[],
): ScannedFile[] {
  if (plan.mode === "full") {
    return [...currentFiles].sort(byPath);
  }
  // incremental: analyze only files whose path the plan marked as added.
  const added = new Set(plan.addedFiles);
  return currentFiles.filter((f) => added.has(f.filePath)).sort(byPath);
}

export async function executeIndexingPlan<T>(input: {
  plan: RepositoryIndexingPlan;
  currentFiles: ScannedFile[];
  analyzeFile: (file: ScannedFile) => T | Promise<T>;
}): Promise<IndexingExecutionResult<T>> {
  const { plan, currentFiles, analyzeFile } = input;

  const selected = selectFilesForIndexing(plan, currentFiles);
  const analyzedFiles = selected.map((f) => f.filePath);
  const analyzedSet = new Set(analyzedFiles);
  const skippedFiles = currentFiles
    .map((f) => f.filePath)
    .filter((p) => !analyzedSet.has(p))
    .sort((a, b) => a.localeCompare(b));

  const results: T[] = [];
  for (const file of selected) {
    results.push(await analyzeFile(file));
  }

  return { mode: plan.mode, analyzedFiles, skippedFiles, results };
}
