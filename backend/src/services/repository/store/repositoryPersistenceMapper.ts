import type {
  RepositoryRecord,
  RepositoryStoreIndexMode,
  RepositoryStoreStatus,
  UpdateRepositoryInput,
} from "./repositoryStore.js";

export interface RepositoryPersistenceRow {
  repository_version?: number;
  repository_id: string;
  owner_user_id: string | null;
  repository_owner: string;
  repository_name: string;
  status: RepositoryStoreStatus;
  indexing_mode: RepositoryStoreIndexMode | null;
  file_count: number;
  symbol_count: number;
  chunk_count: number;
  graph_node_count: number;
  graph_edge_count: number;
  graph_available?: boolean;
  metadata_available: boolean;
  total_indexed_files: number;
  last_changed_file_count: number;
  failed_file_count: number;
  last_successful_file: string | null;
  retry_count: number;
  failure_message: string | null;
  connected_at: string;
  indexed_at: string | null;
  first_indexed_at: string | null;
  last_indexed_at: string | null;
  failed_at: string | null;
  last_retry_at: string | null;
  last_accessed_at: string | null;
  created_at?: string;
  updated_at: string;
  indexed_revision: string | null;
  last_lifecycle_severity: "none" | "low" | "medium" | "high" | null;
  last_reindex_mode: RepositoryStoreIndexMode | "none" | null;
  last_reindex_reason: string | null;
}

export type RepositoryPersistencePatch = Partial<Pick<
  RepositoryPersistenceRow,
  | "owner_user_id"
  | "status"
  | "indexing_mode"
  | "file_count"
  | "symbol_count"
  | "chunk_count"
  | "graph_node_count"
  | "graph_edge_count"
  | "metadata_available"
  | "total_indexed_files"
  | "last_changed_file_count"
  | "failed_file_count"
  | "last_successful_file"
  | "retry_count"
  | "failure_message"
  | "indexed_at"
  | "first_indexed_at"
  | "last_indexed_at"
  | "failed_at"
  | "last_retry_at"
  | "last_accessed_at"
  | "updated_at"
  | "indexed_revision"
  | "last_lifecycle_severity"
  | "last_reindex_mode"
  | "last_reindex_reason"
  | "repository_version"
>>;

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Maps only explicitly requested mutable fields; identity columns are impossible to patch. */
export function repositoryUpdateToRow(
  input: UpdateRepositoryInput,
): RepositoryPersistencePatch {
  const counts = input.counts ?? {};
  return {
    ...(hasOwn(input, "ownerUserId") ? { owner_user_id: input.ownerUserId ?? null } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(hasOwn(input, "indexedAt") ? { indexed_at: input.indexedAt ?? null } : {}),
    ...(hasOwn(input, "firstIndexedAt") ? { first_indexed_at: input.firstIndexedAt ?? null } : {}),
    ...(hasOwn(input, "lastIndexedAt") ? { last_indexed_at: input.lastIndexedAt ?? null } : {}),
    ...(hasOwn(input, "lastAccessedAt") ? { last_accessed_at: input.lastAccessedAt ?? null } : {}),
    ...(input.totalIndexedFiles !== undefined ? { total_indexed_files: input.totalIndexedFiles } : {}),
    ...(hasOwn(input, "lastIndexMode") ? { indexing_mode: input.lastIndexMode ?? null } : {}),
    ...(input.lastChangedFileCount !== undefined ? { last_changed_file_count: input.lastChangedFileCount } : {}),
    ...(hasOwn(input, "lastFailureAt") ? { failed_at: input.lastFailureAt ?? null } : {}),
    ...(hasOwn(input, "failureReason") ? { failure_message: input.failureReason ?? null } : {}),
    ...(input.failedFileCount !== undefined ? { failed_file_count: input.failedFileCount } : {}),
    ...(hasOwn(input, "lastSuccessfulFile") ? { last_successful_file: input.lastSuccessfulFile ?? null } : {}),
    ...(input.retryCount !== undefined ? { retry_count: input.retryCount } : {}),
    ...(hasOwn(input, "lastRetryAt") ? { last_retry_at: input.lastRetryAt ?? null } : {}),
    ...(hasOwn(input, "indexedRevision") ? { indexed_revision: input.indexedRevision ?? null } : {}),
    ...(hasOwn(input, "lastLifecycleSeverity") ? { last_lifecycle_severity: input.lastLifecycleSeverity ?? null } : {}),
    ...(hasOwn(input, "lastReindexMode") ? { last_reindex_mode: input.lastReindexMode ?? null } : {}),
    ...(hasOwn(input, "lastReindexReason") ? { last_reindex_reason: input.lastReindexReason ?? null } : {}),
    ...(counts.chunkCount !== undefined ? { chunk_count: counts.chunkCount } : {}),
    ...(counts.fileCount !== undefined ? { file_count: counts.fileCount } : {}),
    ...(counts.symbolCount !== undefined ? { symbol_count: counts.symbolCount } : {}),
    ...(counts.graphNodeCount !== undefined ? { graph_node_count: counts.graphNodeCount } : {}),
    ...(counts.graphEdgeCount !== undefined ? { graph_edge_count: counts.graphEdgeCount } : {}),
    ...(counts.summaryAvailable !== undefined ? { metadata_available: counts.summaryAvailable } : {}),
  };
}

export function repositoryRecordToRow(
  record: RepositoryRecord,
): RepositoryPersistenceRow {
  return {
    ...(record.persistenceVersion !== undefined
      ? { repository_version: record.persistenceVersion }
      : {}),
    repository_id: record.repositoryId,
    owner_user_id: record.ownerUserId ?? null,
    repository_owner: record.owner,
    repository_name: record.repo,
    status: record.status,
    indexing_mode: record.lastIndexMode ?? null,
    file_count: record.fileCount,
    symbol_count: record.symbolCount,
    chunk_count: record.chunkCount,
    graph_node_count: record.graphNodeCount,
    graph_edge_count: record.graphEdgeCount,
    metadata_available: record.summaryAvailable,
    total_indexed_files: record.totalIndexedFiles,
    last_changed_file_count: record.lastChangedFileCount,
    failed_file_count: record.failedFileCount,
    last_successful_file: record.lastSuccessfulFile ?? null,
    retry_count: record.retryCount,
    failure_message: record.failureReason ?? null,
    connected_at: record.connectedAt,
    indexed_at: record.indexedAt ?? null,
    first_indexed_at: record.firstIndexedAt ?? null,
    last_indexed_at: record.lastIndexedAt ?? null,
    failed_at: record.lastFailureAt ?? null,
    last_retry_at: record.lastRetryAt ?? null,
    last_accessed_at: record.lastAccessedAt ?? null,
    updated_at: record.updatedAt,
    indexed_revision: record.indexedRevision,
    last_lifecycle_severity: record.lastLifecycleSeverity,
    last_reindex_mode: record.lastReindexMode,
    last_reindex_reason: record.lastReindexReason,
  };
}

export function repositoryRowToRecord(
  row: RepositoryPersistenceRow,
): RepositoryRecord {
  return {
    ...(row.repository_version !== undefined
      ? { persistenceVersion: row.repository_version }
      : {}),
    repositoryId: row.repository_id,
    owner: row.repository_owner,
    repo: row.repository_name,
    ownerUserId: row.owner_user_id ?? null,
    status: row.status,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at ?? null,
    firstIndexedAt: row.first_indexed_at ?? null,
    lastIndexedAt: row.last_indexed_at ?? null,
    lastAccessedAt: row.last_accessed_at ?? null,
    chunkCount: row.chunk_count,
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    graphNodeCount: row.graph_node_count,
    graphEdgeCount: row.graph_edge_count,
    summaryAvailable: row.metadata_available,
    totalIndexedFiles: row.total_indexed_files,
    lastIndexMode: row.indexing_mode ?? null,
    lastChangedFileCount: row.last_changed_file_count,
    lastFailureAt: row.failed_at ?? null,
    failureReason: row.failure_message ?? null,
    failedFileCount: row.failed_file_count,
    lastSuccessfulFile: row.last_successful_file ?? null,
    retryCount: row.retry_count,
    lastRetryAt: row.last_retry_at ?? null,
    indexedRevision: row.indexed_revision ?? null,
    lastLifecycleSeverity: row.last_lifecycle_severity ?? null,
    lastReindexMode: row.last_reindex_mode ?? null,
    lastReindexReason: row.last_reindex_reason ?? null,
  };
}
