// In-memory indexing OPERATION store. This operation-state model is SEPARATE
// from RepositoryIndexStatus ("indexing"|"indexed"|"failed"|"stale") — it
// tracks per-repo step progress for retry-safe (resumable) execution.
//
// Deterministic: step lists are kept sorted + de-duplicated; reads return
// copies; inputs are never mutated; no timestamps, no randomness, no UUIDs.

export type IndexingOperationStatus = "pending" | "running" | "completed" | "failed";

export interface IndexingOperation {
  repoId: string;
  status: IndexingOperationStatus;
  totalSteps: string[];
  completedSteps: string[];
}

const store = new Map<string, IndexingOperation>();

function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function copy(op: IndexingOperation): IndexingOperation {
  return {
    repoId: op.repoId,
    status: op.status,
    totalSteps: [...op.totalSteps],
    completedSteps: [...op.completedSteps],
  };
}

export function beginIndexingOperation(repoId: string, steps: string[]): void {
  store.set(repoId, {
    repoId,
    status: "running",
    totalSteps: sortUnique(steps),
    completedSteps: [],
  });
}

export function markStepCompleted(repoId: string, step: string): void {
  const op = store.get(repoId);
  if (!op) return;
  if (!op.totalSteps.includes(step)) return; // only known steps
  if (op.completedSteps.includes(step)) return; // idempotent
  store.set(repoId, {
    ...op,
    completedSteps: sortUnique([...op.completedSteps, step]),
  });
}

export function markOperationFailed(repoId: string): void {
  const op = store.get(repoId);
  if (!op) return;
  store.set(repoId, { ...op, status: "failed" });
}

export function markOperationCompleted(repoId: string): void {
  const op = store.get(repoId);
  if (!op) return;
  store.set(repoId, { ...op, status: "completed" });
}

export function getIndexingOperation(repoId: string): IndexingOperation | null {
  const op = store.get(repoId);
  return op ? copy(op) : null;
}

// test-only helper — resets the in-memory operation store
export function clearIndexingOperations(): void {
  store.clear();
}
