// Pure in-memory repository snapshot store.
//
// Contract:
// - deterministic ids, per-repository sequence numbers, and createdOrder values
// - no timestamps, randomness, async work, filesystem access, or database access
// - returned snapshots are defensive deep copies and recursively frozen
// - listAllSnapshots is stable-sorted by repositoryId, then sequence

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface RepositorySnapshot<Report = unknown> {
  snapshotId: string;
  repositoryId: string;
  sequence: number;
  report: Report;
  createdOrder: number;
}

export interface RepositorySnapshotComparison<Report = unknown> {
  previous: DeepReadonly<RepositorySnapshot<Report>>;
  current: DeepReadonly<RepositorySnapshot<Report>>;
}

const snapshotsById = new Map<string, RepositorySnapshot>();
const snapshotIdsByRepository = new Map<string, string[]>();

let nextCreatedOrder = 1;

function buildSnapshotId(repositoryId: string, sequence: number): string {
  return `${repositoryId}#${sequence}`;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value) as T;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): DeepReadonly<T> {
  if (typeof value !== "object" || value === null) {
    return value as DeepReadonly<T>;
  }

  if (seen.has(value)) {
    return value as DeepReadonly<T>;
  }

  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    deepFreeze(child, seen);
  }

  return Object.freeze(value) as DeepReadonly<T>;
}

function cloneSnapshot<Report>(
  snapshot: RepositorySnapshot<Report>,
): DeepReadonly<RepositorySnapshot<Report>> {
  return deepFreeze(cloneValue(snapshot));
}

function sortedSnapshots(
  snapshots: readonly RepositorySnapshot[],
): RepositorySnapshot[] {
  return [...snapshots].sort(
    (a, b) =>
      a.repositoryId.localeCompare(b.repositoryId) || a.sequence - b.sequence,
  );
}

export function registerSnapshot<Report>(
  repositoryId: string,
  report: Report,
): DeepReadonly<RepositorySnapshot<Report>> {
  const existingIds = snapshotIdsByRepository.get(repositoryId) ?? [];
  const sequence = existingIds.length + 1;
  const snapshot: RepositorySnapshot<Report> = {
    snapshotId: buildSnapshotId(repositoryId, sequence),
    repositoryId,
    sequence,
    report: cloneValue(report),
    createdOrder: nextCreatedOrder,
  };

  nextCreatedOrder += 1;
  snapshotsById.set(snapshot.snapshotId, snapshot as RepositorySnapshot);
  snapshotIdsByRepository.set(repositoryId, [...existingIds, snapshot.snapshotId]);

  return cloneSnapshot(snapshot);
}

export function getSnapshot<Report = unknown>(
  snapshotId: string,
): DeepReadonly<RepositorySnapshot<Report>> | null {
  const snapshot = snapshotsById.get(snapshotId);
  return snapshot ? cloneSnapshot(snapshot as RepositorySnapshot<Report>) : null;
}

export function listSnapshots<Report = unknown>(
  repositoryId: string,
): readonly DeepReadonly<RepositorySnapshot<Report>>[] {
  const ids = snapshotIdsByRepository.get(repositoryId) ?? [];
  return ids
    .map((id) => snapshotsById.get(id))
    .filter((snapshot): snapshot is RepositorySnapshot => snapshot !== undefined)
    .sort((a, b) => a.sequence - b.sequence)
    .map((snapshot) => cloneSnapshot(snapshot as RepositorySnapshot<Report>));
}

export function listAllSnapshots<Report = unknown>(): readonly DeepReadonly<
  RepositorySnapshot<Report>
>[] {
  return sortedSnapshots([...snapshotsById.values()]).map((snapshot) =>
    cloneSnapshot(snapshot as RepositorySnapshot<Report>),
  );
}

export function getLatestSnapshot<Report = unknown>(
  repositoryId: string,
): DeepReadonly<RepositorySnapshot<Report>> | null {
  const snapshots = listSnapshots<Report>(repositoryId);
  return snapshots.at(-1) ?? null;
}

export function compareLatestSnapshots<Report = unknown>(
  repositoryId: string,
): RepositorySnapshotComparison<Report> | null {
  const snapshots = listSnapshots<Report>(repositoryId);
  if (snapshots.length < 2) {
    return null;
  }

  return {
    previous: snapshots[snapshots.length - 2]!,
    current: snapshots[snapshots.length - 1]!,
  };
}

export function removeSnapshots(repositoryId: string): void {
  const ids = snapshotIdsByRepository.get(repositoryId) ?? [];
  for (const id of ids) {
    snapshotsById.delete(id);
  }
  snapshotIdsByRepository.delete(repositoryId);
}

export function clearSnapshotStore(): void {
  snapshotsById.clear();
  snapshotIdsByRepository.clear();
  nextCreatedOrder = 1;
}
