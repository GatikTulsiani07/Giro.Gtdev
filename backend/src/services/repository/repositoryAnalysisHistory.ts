import type {
  DeepReadonly,
  RepositorySnapshot,
} from "./repositorySnapshotStore.js";
import {
  clearSnapshotStore,
  getLatestSnapshot as getLatestStoredSnapshot,
  listSnapshots,
  registerSnapshot,
} from "./repositorySnapshotStore.js";
import type { RepositoryAnalysisReport } from "./repositoryAnalysisReport.js";

export interface RepositoryHistorySummary {
  totalSnapshots: number;
  firstSnapshotId: string | null;
  latestSnapshotId: string | null;
  repositoryId: string;
  latestSequence: number | null;
  hasHistory: boolean;
}

function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

function freezeSummary(
  summary: RepositoryHistorySummary,
): DeepReadonly<RepositoryHistorySummary> {
  return Object.freeze(summary);
}

export function getRepositoryHistory<Report = unknown>(
  repositoryId: string,
): readonly DeepReadonly<RepositorySnapshot<Report>>[] {
  return freezeArray(listSnapshots<Report>(repositoryId));
}

export function getHistoryWindow<Report = unknown>(
  repositoryId: string,
  limit: number,
): readonly DeepReadonly<RepositorySnapshot<Report>>[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return freezeArray([]);
  }

  const history = getRepositoryHistory<Report>(repositoryId);
  return freezeArray(history.slice(Math.max(0, history.length - Math.floor(limit))));
}

export function getFirstSnapshot<Report = unknown>(
  repositoryId: string,
): DeepReadonly<RepositorySnapshot<Report>> | null {
  return getRepositoryHistory<Report>(repositoryId)[0] ?? null;
}

export function getLatestSnapshot<Report = unknown>(
  repositoryId: string,
): DeepReadonly<RepositorySnapshot<Report>> | null {
  return getLatestStoredSnapshot<Report>(repositoryId);
}

export function getHistorySummary(
  repositoryId: string,
): DeepReadonly<RepositoryHistorySummary> {
  const history = getRepositoryHistory(repositoryId);
  const first = history[0] ?? null;
  const latest = history.at(-1) ?? null;

  return freezeSummary({
    totalSnapshots: history.length,
    firstSnapshotId: first?.snapshotId ?? null,
    latestSnapshotId: latest?.snapshotId ?? null,
    repositoryId,
    latestSequence: latest?.sequence ?? null,
    hasHistory: history.length > 0,
  });
}

// Compatibility wrappers for older analysis modules. They still use the shared
// snapshot store, so this module does not own a second history store.
export interface RepositoryAnalysisHistoryEntry {
  repositoryName: string;
  report: RepositoryAnalysisReport;
}

export function saveRepositoryAnalysisReport(
  repositoryName: string,
  report: RepositoryAnalysisReport,
): DeepReadonly<RepositorySnapshot<RepositoryAnalysisReport>> {
  return registerSnapshot(repositoryName, report);
}

export function getRepositoryAnalysisHistory(
  repositoryName: string,
): RepositoryAnalysisReport[] {
  return getRepositoryHistory<RepositoryAnalysisReport>(repositoryName).map(
    (snapshot) => snapshot.report as RepositoryAnalysisReport,
  );
}

export function clearRepositoryAnalysisHistory(): void {
  clearSnapshotStore();
}
