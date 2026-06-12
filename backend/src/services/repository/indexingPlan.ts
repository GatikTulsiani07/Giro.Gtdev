// Incremental index execution planning layer.
//
// Determinism guarantees:
// - No timestamps, no randomness, no I/O
// - All array sorts produce new arrays — never mutate inputs
// - Same (previousSnapshot, currentFiles) always produces identical plan
// - mode is fully derived from detectChangedFiles + its shouldReindexFully
//   field — this function adds NO new thresholds (it only reuses the
//   exported constants to label the reason string).

import type { ScannedFile } from "./scanner.js";
import type { RepositoryFileSnapshot } from "./fileSnapshotStore.js";
import {
  detectChangedFiles,
  CHANGE_RATIO_THRESHOLD,
  REMOVED_RATIO_THRESHOLD,
} from "./changedFileDetection.js";

export type IndexingMode = "full" | "incremental";

export interface RepositoryIndexingPlan {
  mode: IndexingMode;
  addedFiles: string[]; // sorted ascending
  removedFiles: string[]; // sorted ascending
  unchangedFiles: string[]; // sorted ascending
  totalChangedFiles: number; // addedFiles.length + removedFiles.length
  reason: string; // human-readable
}

// Re-derives which full-reindex trigger fired, reusing the same exported
// thresholds (detectChangedFiles only exposes a boolean, not the cause).
function fullReindexReason(
  prevLength: number,
  currLength: number,
  added: number,
  removed: number,
): string {
  if (currLength === 0 && prevLength > 0) return "empty current scan";
  const denominator = Math.max(prevLength, 1);
  if (removed / denominator > REMOVED_RATIO_THRESHOLD) {
    return "removed ratio exceeds threshold";
  }
  if ((added + removed) / denominator > CHANGE_RATIO_THRESHOLD) {
    return "changed ratio exceeds threshold";
  }
  return "fallback rules require full reindex";
}

export function buildRepositoryIndexingPlan(input: {
  previousSnapshot: RepositoryFileSnapshot | null;
  currentFiles: ScannedFile[];
}): RepositoryIndexingPlan {
  const { previousSnapshot, currentFiles } = input;

  if (previousSnapshot === null) {
    const addedFiles = [...currentFiles.map((f) => f.filePath)].sort();
    return {
      mode: "full",
      addedFiles,
      removedFiles: [],
      unchangedFiles: [],
      totalChangedFiles: currentFiles.length,
      reason: "no previous snapshot",
    };
  }

  // detectChangedFiles takes the previous file array + current scanned files.
  const changeResult = detectChangedFiles(previousSnapshot.files, currentFiles);
  const addedFiles = [...changeResult.added].sort();
  const removedFiles = [...changeResult.removed].sort();
  const unchangedFiles = [...changeResult.unchanged].sort();
  const totalChangedFiles = addedFiles.length + removedFiles.length;
  const reindexFully = changeResult.shouldReindexFully;

  const reason = reindexFully
    ? fullReindexReason(
        previousSnapshot.files.length,
        currentFiles.length,
        addedFiles.length,
        removedFiles.length,
      )
    : `incremental: ${totalChangedFiles} file(s) changed`;

  return {
    mode: reindexFully ? "full" : "incremental",
    addedFiles,
    removedFiles,
    unchangedFiles,
    totalChangedFiles,
    reason,
  };
}
