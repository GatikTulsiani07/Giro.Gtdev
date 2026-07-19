import { test } from "node:test";
import assert from "node:assert/strict";

import {
  repositoryRecordToRow,
  repositoryRowToRecord,
  type RepositoryPersistenceRow,
} from "../services/repository/store/repositoryPersistenceMapper.js";
import type { RepositoryRecord } from "../services/repository/store/repositoryStore.js";

const BASE_TIME = "2026-01-01T00:00:00.000Z";

function record(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    repositoryId: "acme/demo",
    owner: "acme",
    repo: "demo",
    ownerUserId: "user-1",
    status: "connected",
    connectedAt: BASE_TIME,
    updatedAt: "2026-01-01T00:00:01.000Z",
    indexedAt: null,
    firstIndexedAt: null,
    lastIndexedAt: null,
    lastAccessedAt: null,
    chunkCount: 0,
    fileCount: 0,
    symbolCount: 0,
    graphNodeCount: 0,
    graphEdgeCount: 0,
    summaryAvailable: false,
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
    ...overrides,
  };
}

function row(overrides: Partial<RepositoryPersistenceRow> = {}): RepositoryPersistenceRow {
  return {
    repository_id: "acme/demo",
    owner_user_id: "user-1",
    repository_owner: "acme",
    repository_name: "demo",
    status: "connected",
    indexing_mode: null,
    file_count: 0,
    symbol_count: 0,
    chunk_count: 0,
    graph_node_count: 0,
    graph_edge_count: 0,
    graph_available: false,
    metadata_available: false,
    total_indexed_files: 0,
    last_changed_file_count: 0,
    failed_file_count: 0,
    last_successful_file: null,
    retry_count: 0,
    failure_message: null,
    connected_at: BASE_TIME,
    indexed_at: null,
    first_indexed_at: null,
    last_indexed_at: null,
    failed_at: null,
    last_retry_at: null,
    last_accessed_at: null,
    created_at: BASE_TIME,
    updated_at: "2026-01-01T00:00:01.000Z",
    indexed_revision: null,
    last_lifecycle_severity: null,
    last_reindex_mode: null,
    last_reindex_reason: null,
    ...overrides,
  };
}

test("maps a complete repository record to a persistence row", () => {
  const input = record({
    status: "indexed",
    indexedAt: "2026-01-01T00:10:00.000Z",
    firstIndexedAt: "2026-01-01T00:05:00.000Z",
    lastIndexedAt: "2026-01-01T00:10:00.000Z",
    lastAccessedAt: "2026-01-01T00:11:00.000Z",
    chunkCount: 9,
    fileCount: 3,
    symbolCount: 7,
    graphNodeCount: 4,
    graphEdgeCount: 2,
    summaryAvailable: true,
    totalIndexedFiles: 3,
    lastIndexMode: "full",
    lastChangedFileCount: 3,
    lastFailureAt: "2026-01-01T00:03:00.000Z",
    failureReason: "previous failure",
    failedFileCount: 1,
    lastSuccessfulFile: "src/index.ts",
    retryCount: 2,
    lastRetryAt: "2026-01-01T00:04:00.000Z",
  });

  assert.deepEqual(repositoryRecordToRow(input), {
    repository_id: "acme/demo",
    owner_user_id: "user-1",
    repository_owner: "acme",
    repository_name: "demo",
    status: "indexed",
    indexing_mode: "full",
    file_count: 3,
    symbol_count: 7,
    chunk_count: 9,
    graph_node_count: 4,
    graph_edge_count: 2,
    metadata_available: true,
    total_indexed_files: 3,
    last_changed_file_count: 3,
    failed_file_count: 1,
    last_successful_file: "src/index.ts",
    retry_count: 2,
    failure_message: "previous failure",
    connected_at: BASE_TIME,
    indexed_at: "2026-01-01T00:10:00.000Z",
    first_indexed_at: "2026-01-01T00:05:00.000Z",
    last_indexed_at: "2026-01-01T00:10:00.000Z",
    failed_at: "2026-01-01T00:03:00.000Z",
    last_retry_at: "2026-01-01T00:04:00.000Z",
    last_accessed_at: "2026-01-01T00:11:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
    indexed_revision: null,
    last_lifecycle_severity: null,
    last_reindex_mode: null,
    last_reindex_reason: null,
  });
});

test("maps a persistence row to a repository record", () => {
  const input = row({
    status: "indexed",
    indexing_mode: "incremental",
    file_count: 5,
    symbol_count: 11,
    chunk_count: 13,
    graph_node_count: 3,
    graph_edge_count: 2,
    graph_available: true,
    metadata_available: true,
    total_indexed_files: 5,
    last_changed_file_count: 1,
    indexed_at: "2026-01-01T00:10:00.000Z",
    first_indexed_at: "2026-01-01T00:05:00.000Z",
    last_indexed_at: "2026-01-01T00:10:00.000Z",
    last_accessed_at: "2026-01-01T00:11:00.000Z",
  });

  assert.deepEqual(repositoryRowToRecord(input), record({
    status: "indexed",
    indexedAt: "2026-01-01T00:10:00.000Z",
    firstIndexedAt: "2026-01-01T00:05:00.000Z",
    lastIndexedAt: "2026-01-01T00:10:00.000Z",
    lastAccessedAt: "2026-01-01T00:11:00.000Z",
    chunkCount: 13,
    fileCount: 5,
    symbolCount: 11,
    graphNodeCount: 3,
    graphEdgeCount: 2,
    summaryAvailable: true,
    totalIndexedFiles: 5,
    lastIndexMode: "incremental",
    lastChangedFileCount: 1,
  }));
});

test("preserves indexing state with nullable lifecycle fields", () => {
  const input = record({ status: "indexing", ownerUserId: null });
  const output = repositoryRowToRecord(repositoryRecordToRow(input));

  assert.deepEqual(output, input);
  assert.equal(output.ownerUserId, null);
  assert.equal(output.indexedAt, null);
  assert.equal(output.firstIndexedAt, null);
  assert.equal(output.lastIndexedAt, null);
});

test("preserves indexed state", () => {
  const input = record({
    status: "indexed",
    indexedAt: "2026-01-01T00:10:00.000Z",
    firstIndexedAt: "2026-01-01T00:05:00.000Z",
    lastIndexedAt: "2026-01-01T00:10:00.000Z",
    chunkCount: 2,
    fileCount: 1,
    symbolCount: 4,
    graphNodeCount: 1,
    graphEdgeCount: 1,
    summaryAvailable: true,
    totalIndexedFiles: 1,
    lastIndexMode: "full",
    lastChangedFileCount: 1,
  });

  assert.deepEqual(repositoryRowToRecord(repositoryRecordToRow(input)), input);
});

test("preserves failed state", () => {
  const input = record({
    status: "failed",
    lastFailureAt: "2026-01-01T00:20:00.000Z",
    failureReason: "clone failed",
    failedFileCount: 8,
    lastSuccessfulFile: "src/a.ts",
    retryCount: 1,
    lastRetryAt: "2026-01-01T00:21:00.000Z",
  });

  assert.deepEqual(repositoryRowToRecord(repositoryRecordToRow(input)), input);
});

test("preserves zero counts", () => {
  const input = record({
    chunkCount: 0,
    fileCount: 0,
    symbolCount: 0,
    graphNodeCount: 0,
    graphEdgeCount: 0,
    totalIndexedFiles: 0,
    lastChangedFileCount: 0,
    failedFileCount: 0,
    retryCount: 0,
  });

  const mapped = repositoryRecordToRow(input);
  assert.equal(mapped.graph_available, undefined);
  assert.deepEqual(repositoryRowToRecord(mapped), input);
});

test("repeated conversion is deterministic", () => {
  const input = record({ status: "stale", lastIndexMode: "incremental" });

  assert.deepEqual(repositoryRecordToRow(input), repositoryRecordToRow(input));
  assert.deepEqual(repositoryRowToRecord(row()), repositoryRowToRecord(row()));
});

test("does not mutate mapper inputs", () => {
  const inputRecord = Object.freeze(record({ status: "indexed" }));
  const inputRow = Object.freeze(row({ status: "failed" }));

  const beforeRecord = { ...inputRecord };
  const beforeRow = { ...inputRow };

  repositoryRecordToRow(inputRecord);
  repositoryRowToRecord(inputRow);

  assert.deepEqual(inputRecord, beforeRecord);
  assert.deepEqual(inputRow, beforeRow);
});

test("round-trip preserves repository record metadata", () => {
  const input = record({
    status: "stale",
    indexedAt: "2026-01-01T00:10:00.000Z",
    firstIndexedAt: "2026-01-01T00:05:00.000Z",
    lastIndexedAt: "2026-01-01T00:10:00.000Z",
    lastAccessedAt: "2026-01-01T00:11:00.000Z",
    chunkCount: 10,
    fileCount: 6,
    symbolCount: 12,
    graphNodeCount: 0,
    graphEdgeCount: 3,
    summaryAvailable: true,
    totalIndexedFiles: 6,
    lastIndexMode: "incremental",
    lastChangedFileCount: 2,
    lastFailureAt: "2026-01-01T00:03:00.000Z",
    failureReason: "transient error",
    failedFileCount: 1,
    lastSuccessfulFile: "src/index.ts",
    retryCount: 4,
    lastRetryAt: "2026-01-01T00:04:00.000Z",
  });

  assert.deepEqual(repositoryRowToRecord(repositoryRecordToRow(input)), input);
});
