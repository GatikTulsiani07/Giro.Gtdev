import { getRepositoryIndexMetadata } from "./indexingService.js";
import type { buildRepositoryStatusSnapshot } from "./repositoryStatusSnapshot.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export interface RepositoryDashboardSummary {
  repository: string;
  status: ReturnType<typeof buildRepositoryStatusSnapshot>;
  metrics: {
    files: number;
    chunks: number;
    symbols: number;
    graphNodes: number;
    graphEdges: number;
  };
}

export function buildRepositoryDashboardSummary(
  owner: string,
  repo: string,
): RepositoryDashboardSummary;
export function buildRepositoryDashboardSummary(
  owner: string,
  repo: string,
): MaybePromise<RepositoryDashboardSummary> {
  return mapMaybePromise(getRepositoryIndexMetadata(owner, repo), (metadata) => ({
    repository: `${owner}/${repo}`,
    status: {
      repository: `${owner}/${repo}`,
      health: metadata ? {
        repository: `${owner}/${repo}`,
        indexed: metadata.status === "indexed",
        healthy: metadata.status === "indexed",
        stale: metadata.status === "stale",
        status: metadata.status,
        lastIndexedAt: metadata.lastIndexedAt,
        lastAccessedAt: metadata.lastAccessedAt,
      } : {
        repository: `${owner}/${repo}`, indexed: false, healthy: false, stale: false,
        status: "missing", lastIndexedAt: null, lastAccessedAt: null,
      },
      readiness: metadata ? {
        repository: `${owner}/${repo}`, ready: metadata.status === "indexed",
        status: metadata.status, indexedFiles: metadata.fileCount,
        indexedChunks: metadata.chunkCount, lastIndexedAt: metadata.lastIndexedAt,
      } : {
        repository: `${owner}/${repo}`, ready: false, status: "missing",
        indexedFiles: 0, indexedChunks: 0, lastIndexedAt: null,
      },
    },
    metrics: {
      files: metadata?.fileCount ?? 0,
      chunks: metadata?.chunkCount ?? 0,
      symbols: metadata?.symbolCount ?? 0,
      graphNodes: metadata?.graphNodeCount ?? 0,
      graphEdges: metadata?.graphEdgeCount ?? 0,
    },
  }));
}
