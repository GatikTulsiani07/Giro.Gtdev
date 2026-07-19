import { flatMapMaybePromise, mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import type { RepositoryIndexMetadata, RepositoryIndexStatus } from "./indexingTypes.js";
import type { IndexingMode } from "./indexingPlan.js";
import type { RepositoryLifecycleReport } from "./repositoryLifecycleReport.js";
import { repositoryStore } from "./store/runtimeRepositoryStore.js";
import type { RepositoryRecord } from "./store/repositoryStore.js";

function key(owner: string, repo: string): string { return `${owner}/${repo}`; }
function metadata(record: RepositoryRecord): RepositoryIndexMetadata {
  return {
    owner: record.owner, repo: record.repo,
    status: record.status === "connected" ? "indexing" : record.status,
    indexedAt: record.indexedAt, lastAccessedAt: record.lastAccessedAt,
    chunkCount: record.chunkCount, fileCount: record.fileCount,
    symbolCount: record.symbolCount, graphNodeCount: record.graphNodeCount,
    graphEdgeCount: record.graphEdgeCount, summaryAvailable: record.summaryAvailable,
    firstIndexedAt: record.firstIndexedAt, lastIndexedAt: record.lastIndexedAt,
    totalIndexedFiles: record.totalIndexedFiles, lastIndexMode: record.lastIndexMode,
    lastChangedFileCount: record.lastChangedFileCount,
    lastFailureAt: record.lastFailureAt, failureReason: record.failureReason,
    failedFileCount: record.failedFileCount, lastSuccessfulFile: record.lastSuccessfulFile,
    retryCount: record.retryCount, lastRetryAt: record.lastRetryAt,
    lastLifecycleSeverity: record.lastLifecycleSeverity,
    lastReindexMode: record.lastReindexMode,
    lastReindexReason: record.lastReindexReason,
  };
}
function ensure(owner: string, repo: string) {
  return repositoryStore.connectRepository({ owner, repo });
}

export interface IndexedCounts {
  chunkCount: number; fileCount: number; symbolCount: number;
  graphNodeCount: number; graphEdgeCount: number; summaryAvailable: boolean;
}
export interface SetRepositoryIndexedOptions {
  indexMode?: IndexingMode; changedFileCount?: number; indexedRevision?: string | null;
}

export function getRepositoryIndexMetadata(owner: string, repo: string): RepositoryIndexMetadata | null;
export function getRepositoryIndexMetadata(owner: string, repo: string): MaybePromise<RepositoryIndexMetadata | null> {
  return mapMaybePromise(repositoryStore.getRepository(key(owner, repo)), (value) =>
    value && value.status !== "connected" ? metadata(value) : null);
}
export function setRepositoryIndexing(owner: string, repo: string): void;
export function setRepositoryIndexing(owner: string, repo: string): MaybePromise<void> {
  return flatMapMaybePromise(ensure(owner, repo), () => mapMaybePromise(repositoryStore.markIndexing(key(owner, repo)), () => undefined));
}
export function setRepositoryIndexed(owner: string, repo: string, counts: IndexedCounts, options?: SetRepositoryIndexedOptions): void;
export function setRepositoryIndexed(owner: string, repo: string, counts: IndexedCounts, options?: SetRepositoryIndexedOptions): MaybePromise<void> {
  return flatMapMaybePromise(ensure(owner, repo), () => mapMaybePromise(repositoryStore.markIndexed(key(owner, repo), {
    counts, indexMode: options?.indexMode, changedFileCount: options?.changedFileCount,
    indexedRevision: options?.indexedRevision,
  }), () => undefined));
}
export function setRepositoryFailed(owner: string, repo: string): void;
export function setRepositoryFailed(owner: string, repo: string): MaybePromise<void> {
  return flatMapMaybePromise(ensure(owner, repo), () => mapMaybePromise(repositoryStore.markFailed(key(owner, repo)), () => undefined));
}
export function updateRepositorySymbolCount(owner: string, repo: string, symbolCount: number): void;
export function updateRepositorySymbolCount(owner: string, repo: string, symbolCount: number): MaybePromise<void> {
  return mapMaybePromise(repositoryStore.updateRepository(key(owner, repo), { counts: { symbolCount } }), () => undefined);
}
export function updateRepositoryGraphCounts(owner: string, repo: string, graphNodeCount: number, graphEdgeCount: number): void;
export function updateRepositoryGraphCounts(owner: string, repo: string, graphNodeCount: number, graphEdgeCount: number): MaybePromise<void> {
  return mapMaybePromise(repositoryStore.updateRepository(key(owner, repo), { counts: { graphNodeCount, graphEdgeCount } }), () => undefined);
}
export function recordIndexingFailure(owner: string, repo: string, info: { reason: string; failedFileCount: number; lastSuccessfulFile: string | null }): void;
export function recordIndexingFailure(owner: string, repo: string, info: { reason: string; failedFileCount: number; lastSuccessfulFile: string | null }): MaybePromise<void> {
  return flatMapMaybePromise(ensure(owner, repo), () => mapMaybePromise(repositoryStore.markFailed(key(owner, repo), info), () => undefined));
}
export function recordIndexingRetry(owner: string, repo: string): void;
export function recordIndexingRetry(owner: string, repo: string): MaybePromise<void> {
  return flatMapMaybePromise(repositoryStore.getRepository(key(owner, repo)), (record) =>
    record ? mapMaybePromise(repositoryStore.updateRepository(record.repositoryId, {
      retryCount: record.retryCount + 1, lastRetryAt: new Date().toISOString(),
    }), () => undefined) : undefined);
}
export function clearIndexingFailure(owner: string, repo: string): void;
export function clearIndexingFailure(owner: string, repo: string): MaybePromise<void> {
  return mapMaybePromise(repositoryStore.updateRepository(key(owner, repo), {
    lastFailureAt: null, failureReason: null, failedFileCount: 0, lastSuccessfulFile: null,
  }), () => undefined);
}
export function markRepositoryStale(owner: string, repo: string): void;
export function markRepositoryStale(owner: string, repo: string): MaybePromise<void> {
  return flatMapMaybePromise(repositoryStore.getRepository(key(owner, repo)), (record) =>
    record?.status === "indexed" ? mapMaybePromise(repositoryStore.updateRepository(record.repositoryId, { status: "stale" }), () => undefined) : undefined);
}
export function clearRepositoryStale(owner: string, repo: string): void;
export function clearRepositoryStale(owner: string, repo: string): MaybePromise<void> {
  return flatMapMaybePromise(repositoryStore.getRepository(key(owner, repo)), (record) =>
    record?.status === "stale" ? mapMaybePromise(repositoryStore.updateRepository(record.repositoryId, { status: "indexed" }), () => undefined) : undefined);
}
export function touchRepositoryAccess(owner: string, repo: string): void;
export function touchRepositoryAccess(owner: string, repo: string): MaybePromise<void> {
  return mapMaybePromise(repositoryStore.touchAccess(key(owner, repo)), () => undefined);
}
export function listIndexedRepositories(): RepositoryIndexMetadata[];
export function listIndexedRepositories(): MaybePromise<RepositoryIndexMetadata[]> {
  return mapMaybePromise(repositoryStore.listRepositories(), (records) => records.filter((record) => record.status === "indexed").map(metadata));
}
export function isRepositoryHealthy(owner: string, repo: string): boolean;
export function isRepositoryHealthy(owner: string, repo: string): MaybePromise<boolean> {
  return mapMaybePromise(repositoryStore.getRepository(key(owner, repo)), (record) => record?.status === "indexed");
}
export function isRepositoryStale(owner: string, repo: string): boolean;
export function isRepositoryStale(owner: string, repo: string): MaybePromise<boolean> {
  return mapMaybePromise(repositoryStore.getRepository(key(owner, repo)), (record) => record?.status === "stale");
}
export type { RepositoryIndexStatus };
export function clearRepositoryIndexRegistry(): void;
export function clearRepositoryIndexRegistry(): MaybePromise<void> { return repositoryStore.clear(); }
export function removeRepositoryIndexMetadata(owner: string, repo: string): void;
export function removeRepositoryIndexMetadata(owner: string, repo: string): MaybePromise<void> {
  return mapMaybePromise(repositoryStore.updateRepository(key(owner, repo), {
    status: "connected",
    indexedAt: null,
    firstIndexedAt: null,
    lastIndexedAt: null,
    lastAccessedAt: null,
    totalIndexedFiles: 0,
    lastIndexMode: null,
    lastChangedFileCount: 0,
    lastFailureAt: null,
    failureReason: null,
    failedFileCount: 0,
    lastSuccessfulFile: null,
    retryCount: 0,
    lastRetryAt: null,
    indexedRevision: null,
    lastLifecycleSeverity: null,
    lastReindexMode: null,
    lastReindexReason: null,
    counts: {
      chunkCount: 0,
      fileCount: 0,
      symbolCount: 0,
      graphNodeCount: 0,
      graphEdgeCount: 0,
      summaryAvailable: false,
    },
  }), () => undefined);
}
export function recordRepositoryLifecycleReport(owner: string, repo: string, report: RepositoryLifecycleReport): void;
export function recordRepositoryLifecycleReport(owner: string, repo: string, report: RepositoryLifecycleReport): MaybePromise<void> {
  return flatMapMaybePromise(ensure(owner, repo), (record) =>
    mapMaybePromise(repositoryStore.updateRepository(key(owner, repo), {
      ...(record.status === "connected" ? { status: "indexing" as const } : {}),
      lastLifecycleSeverity: report.changes.severity,
      lastReindexMode: report.plan.mode,
      lastReindexReason: report.plan.reason,
    }), () => undefined));
}
