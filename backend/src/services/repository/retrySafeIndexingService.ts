// Pure orchestration over the indexing operation store for retry-safe,
// resumable execution. Completed steps are never reprocessed (idempotent side
// effects). Deterministic: steps run in sorted order; no timestamps/randomness.

import {
  getIndexingOperation,
  markStepCompleted,
  markOperationFailed,
  markOperationCompleted,
} from "./indexingOperationStore.js";

export function planRetrySafeExecution(repoId: string): {
  resumable: boolean;
  remainingSteps: string[];
  completedSteps: string[];
} {
  const op = getIndexingOperation(repoId);
  const resumable = op !== null && (op.status === "running" || op.status === "failed");
  if (!op || !resumable) {
    return { resumable: false, remainingSteps: [], completedSteps: [] };
  }
  const completed = new Set(op.completedSteps);
  const remainingSteps = op.totalSteps.filter((s) => !completed.has(s));
  return { resumable: true, remainingSteps, completedSteps: [...op.completedSteps] };
}

export function executeRetrySafeIndexing(
  repoId: string,
  runStep: (step: string) => void,
): void {
  const op = getIndexingOperation(repoId);
  if (!op) return;

  const completed = new Set(op.completedSteps);
  // totalSteps is already sorted; remaining preserves that deterministic order.
  const remaining = op.totalSteps.filter((s) => !completed.has(s));

  for (const step of remaining) {
    try {
      runStep(step);
    } catch {
      markOperationFailed(repoId);
      return; // already-completed steps remain recorded for a later resume
    }
    markStepCompleted(repoId, step);
  }

  markOperationCompleted(repoId);
}
