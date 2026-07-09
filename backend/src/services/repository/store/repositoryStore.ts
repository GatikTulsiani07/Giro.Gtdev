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
  counts?: Partial<RepositoryStoreCounts>;
}

export interface MarkIndexedInput {
  counts: RepositoryStoreCounts;
  indexMode?: RepositoryStoreIndexMode;
  changedFileCount?: number;
}

export interface MarkFailedInput {
  reason?: string | null;
  failedFileCount?: number;
  lastSuccessfulFile?: string | null;
}

export interface RepositoryStore {
  connectRepository(input: ConnectRepositoryInput): RepositoryRecord;
  getRepository(repositoryId: string): RepositoryRecord | null;
  listRepositories(): RepositoryRecord[];
  updateRepository(repositoryId: string, input: UpdateRepositoryInput): RepositoryRecord | null;
  deleteRepository(repositoryId: string): boolean;
  markIndexing(repositoryId: string): RepositoryRecord | null;
  markIndexed(repositoryId: string, input: MarkIndexedInput): RepositoryRecord | null;
  markFailed(repositoryId: string, input?: MarkFailedInput): RepositoryRecord | null;
  touchAccess(repositoryId: string): RepositoryRecord | null;
  repositoryExists(repositoryId: string): boolean;
  clear(): void;
}
