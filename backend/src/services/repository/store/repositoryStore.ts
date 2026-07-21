export type RepositoryStoreIndexMode = "full" | "incremental";

export type RepositoryStoreStatus =
  | "connected"
  | "indexing"
  | "indexed"
  | "failed"
  | "stale";

export interface RepositoryStoreCounts {
  chunkCount: number;
  fileCount: number;
  symbolCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  summaryAvailable: boolean;
}

export interface RepositoryRecord extends RepositoryStoreCounts {
  /** Internal persistence CAS version. Never exposed by API response mappers. */
  persistenceVersion?: number;
  repositoryId: string;
  owner: string;
  repo: string;
  ownerUserId: string | null;
  status: RepositoryStoreStatus;
  connectedAt: string;
  updatedAt: string;
  indexedAt: string | null;
  firstIndexedAt: string | null;
  lastIndexedAt: string | null;
  lastAccessedAt: string | null;
  totalIndexedFiles: number;
  lastIndexMode: RepositoryStoreIndexMode | null;
  lastChangedFileCount: number;
  lastFailureAt: string | null;
  failureReason: string | null;
  failedFileCount: number;
  lastSuccessfulFile: string | null;
  retryCount: number;
  lastRetryAt: string | null;
  indexedRevision: string | null;
  lastLifecycleSeverity: "none" | "low" | "medium" | "high" | null;
  lastReindexMode: RepositoryStoreIndexMode | "none" | null;
  lastReindexReason: string | null;
}

export interface ConnectRepositoryInput {
  owner: string;
  repo: string;
  ownerUserId?: string | null;
}

export interface UpdateRepositoryInput {
  ownerUserId?: string | null;
  status?: RepositoryStoreStatus;
  indexedAt?: string | null;
  firstIndexedAt?: string | null;
  lastIndexedAt?: string | null;
  lastAccessedAt?: string | null;
  totalIndexedFiles?: number;
  lastIndexMode?: RepositoryStoreIndexMode | null;
  lastChangedFileCount?: number;
  lastFailureAt?: string | null;
  failureReason?: string | null;
  failedFileCount?: number;
  lastSuccessfulFile?: string | null;
  retryCount?: number;
  lastRetryAt?: string | null;
  indexedRevision?: string | null;
  lastLifecycleSeverity?: "none" | "low" | "medium" | "high" | null;
  lastReindexMode?: RepositoryStoreIndexMode | "none" | null;
  lastReindexReason?: string | null;
  counts?: Partial<RepositoryStoreCounts>;
}

export interface MarkIndexedInput {
  counts: RepositoryStoreCounts;
  indexMode?: RepositoryStoreIndexMode;
  changedFileCount?: number;
  indexedRevision?: string | null;
}

export interface MarkFailedInput {
  reason?: string | null;
  failedFileCount?: number;
  lastSuccessfulFile?: string | null;
}

export interface RepositoryStore {
  connectRepository(input: ConnectRepositoryInput): MaybePromise<RepositoryRecord>;
  getRepository(repositoryId: string): MaybePromise<RepositoryRecord | null>;
  listRepositories(): MaybePromise<RepositoryRecord[]>;
  updateRepository(
    repositoryId: string,
    input: UpdateRepositoryInput,
    expectedVersion?: number,
  ): MaybePromise<RepositoryRecord | null>;
  deleteRepository(repositoryId: string): MaybePromise<boolean>;
  markIndexing(repositoryId: string): MaybePromise<RepositoryRecord | null>;
  markIndexed(repositoryId: string, input: MarkIndexedInput): MaybePromise<RepositoryRecord | null>;
  markFailed(repositoryId: string, input?: MarkFailedInput): MaybePromise<RepositoryRecord | null>;
  touchAccess(repositoryId: string): MaybePromise<RepositoryRecord | null>;
  repositoryExists(repositoryId: string): MaybePromise<boolean>;
  clear(): MaybePromise<void>;
}

export const REPOSITORY_CONCURRENCY_ERROR_CODE = "repository_concurrency_conflict";

export class RepositoryConcurrencyError extends Error {
  readonly code = REPOSITORY_CONCURRENCY_ERROR_CODE;
  readonly repositoryId: string;
  readonly expectedVersion: number;

  constructor(repositoryId: string, expectedVersion: number) {
    super("Repository was modified by another operation.");
    this.name = "RepositoryConcurrencyError";
    this.repositoryId = repositoryId;
    this.expectedVersion = expectedVersion;
  }
}
import type { MaybePromise } from "../../../lib/maybePromise.js";
