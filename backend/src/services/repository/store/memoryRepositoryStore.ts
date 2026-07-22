import {
  RepositoryConcurrencyError,
  type ConnectRepositoryInput,
  type MarkFailedInput,
  type MarkIndexedInput,
  type RepositoryRecord,
  type RepositoryDeletionTombstone,
  type RepositoryStore,
  type RepositoryStoreCounts,
  type UpdateRepositoryInput,
} from "./repositoryStore.js";

const EMPTY_COUNTS: RepositoryStoreCounts = {
  chunkCount: 0,
  fileCount: 0,
  symbolCount: 0,
  graphNodeCount: 0,
  graphEdgeCount: 0,
  summaryAvailable: false,
};

function repositoryId(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function now(): string {
  return new Date().toISOString();
}

function cloneRecord(record: RepositoryRecord): RepositoryRecord {
  return {
    ...(record.persistenceVersion !== undefined
      ? { persistenceVersion: record.persistenceVersion }
      : {}),
    repositoryId: record.repositoryId,
    owner: record.owner,
    repo: record.repo,
    ownerUserId: record.ownerUserId,
    status: record.status,
    deletionState: record.deletionState,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
    indexedAt: record.indexedAt,
    firstIndexedAt: record.firstIndexedAt,
    lastIndexedAt: record.lastIndexedAt,
    lastAccessedAt: record.lastAccessedAt,
    chunkCount: record.chunkCount,
    fileCount: record.fileCount,
    symbolCount: record.symbolCount,
    graphNodeCount: record.graphNodeCount,
    graphEdgeCount: record.graphEdgeCount,
    summaryAvailable: record.summaryAvailable,
    totalIndexedFiles: record.totalIndexedFiles,
    lastIndexMode: record.lastIndexMode,
    lastChangedFileCount: record.lastChangedFileCount,
    lastFailureAt: record.lastFailureAt,
    failureReason: record.failureReason,
    failedFileCount: record.failedFileCount,
    lastSuccessfulFile: record.lastSuccessfulFile,
    retryCount: record.retryCount,
    lastRetryAt: record.lastRetryAt,
    indexedRevision: record.indexedRevision,
    currentRevision: record.currentRevision,
    publishingRevision: record.publishingRevision,
    previousRevision: record.previousRevision,
    lastLifecycleSeverity: record.lastLifecycleSeverity,
    lastReindexMode: record.lastReindexMode,
    lastReindexReason: record.lastReindexReason,
  };
}

function freezeRecord(record: RepositoryRecord): RepositoryRecord {
  return Object.freeze(cloneRecord(record));
}

function createRecord(input: ConnectRepositoryInput, timestamp: string): RepositoryRecord {
  return {
    persistenceVersion: 1,
    repositoryId: repositoryId(input.owner, input.repo),
    owner: input.owner,
    repo: input.repo,
    ownerUserId: input.ownerUserId ?? null,
    status: "connected",
    deletionState: "active",
    connectedAt: timestamp,
    updatedAt: timestamp,
    indexedAt: null,
    firstIndexedAt: null,
    lastIndexedAt: null,
    lastAccessedAt: null,
    ...EMPTY_COUNTS,
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
    currentRevision: null,
    publishingRevision: null,
    previousRevision: null,
    lastLifecycleSeverity: null,
    lastReindexMode: null,
    lastReindexReason: null,
  };
}

function hasOwn<T extends object>(
  value: T,
  key: keyof T,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class MemoryRepositoryStore implements RepositoryStore {
  private readonly repositories = new Map<string, RepositoryRecord>();
  private readonly deletionTombstones = new Map<string, RepositoryDeletionTombstone>();

  connectRepository(input: ConnectRepositoryInput): RepositoryRecord {
    const id = repositoryId(input.owner, input.repo);
    if (this.deletionTombstones.has(id)) throw new Error("repository_deleted");
    const timestamp = now();
    const existing = this.repositories.get(id);

    if (existing) {
      if (input.ownerUserId && input.ownerUserId !== existing.ownerUserId) {
        return this.updateRepository(
          id,
          { ownerUserId: input.ownerUserId },
          existing.persistenceVersion ?? 1,
        )!;
      }
      return freezeRecord(existing);
    }

    const record = createRecord(input, timestamp);

    this.repositories.set(id, record);
    return freezeRecord(record);
  }

  getRepository(repositoryId: string): RepositoryRecord | null {
    const record = this.repositories.get(repositoryId);
    return record ? freezeRecord(record) : null;
  }

  listRepositories(): RepositoryRecord[] {
    return [...this.repositories.values()]
      .map(freezeRecord)
      .sort((a, b) => a.owner.localeCompare(b.owner) || a.repo.localeCompare(b.repo));
  }

  updateRepository(
    repositoryId: string,
    input: UpdateRepositoryInput,
    expectedVersion?: number,
  ): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;

    const currentVersion = existing.persistenceVersion ?? 1;
    const requiredVersion = expectedVersion ?? currentVersion;
    if (currentVersion !== requiredVersion) {
      throw new RepositoryConcurrencyError(repositoryId, requiredVersion);
    }

    const counts = input.counts ?? {};
    const updated: RepositoryRecord = {
      ...existing,
      persistenceVersion: currentVersion + 1,
      ownerUserId: hasOwn(input, "ownerUserId")
        ? (input.ownerUserId ?? null)
        : existing.ownerUserId,
      status: input.status ?? existing.status,
      updatedAt: now(),
      indexedAt: hasOwn(input, "indexedAt") ? (input.indexedAt ?? null) : existing.indexedAt,
      firstIndexedAt: hasOwn(input, "firstIndexedAt")
        ? (input.firstIndexedAt ?? null)
        : existing.firstIndexedAt,
      lastIndexedAt: hasOwn(input, "lastIndexedAt")
        ? (input.lastIndexedAt ?? null)
        : existing.lastIndexedAt,
      lastAccessedAt: hasOwn(input, "lastAccessedAt")
        ? (input.lastAccessedAt ?? null)
        : existing.lastAccessedAt,
      chunkCount: counts.chunkCount ?? existing.chunkCount,
      fileCount: counts.fileCount ?? existing.fileCount,
      symbolCount: counts.symbolCount ?? existing.symbolCount,
      graphNodeCount: counts.graphNodeCount ?? existing.graphNodeCount,
      graphEdgeCount: counts.graphEdgeCount ?? existing.graphEdgeCount,
      summaryAvailable: counts.summaryAvailable ?? existing.summaryAvailable,
      totalIndexedFiles: input.totalIndexedFiles ?? existing.totalIndexedFiles,
      lastIndexMode: hasOwn(input, "lastIndexMode")
        ? (input.lastIndexMode ?? null)
        : existing.lastIndexMode,
      lastChangedFileCount:
        input.lastChangedFileCount ?? existing.lastChangedFileCount,
      lastFailureAt: hasOwn(input, "lastFailureAt")
        ? (input.lastFailureAt ?? null)
        : existing.lastFailureAt,
      failureReason: hasOwn(input, "failureReason")
        ? (input.failureReason ?? null)
        : existing.failureReason,
      failedFileCount: input.failedFileCount ?? existing.failedFileCount,
      lastSuccessfulFile: hasOwn(input, "lastSuccessfulFile")
        ? (input.lastSuccessfulFile ?? null)
        : existing.lastSuccessfulFile,
      retryCount: input.retryCount ?? existing.retryCount,
      lastRetryAt: hasOwn(input, "lastRetryAt")
        ? (input.lastRetryAt ?? null)
        : existing.lastRetryAt,
      indexedRevision: hasOwn(input, "indexedRevision")
        ? (input.indexedRevision ?? null)
        : existing.indexedRevision,
      currentRevision: hasOwn(input, "currentRevision")
        ? (input.currentRevision ?? null)
        : existing.currentRevision,
      publishingRevision: hasOwn(input, "publishingRevision")
        ? (input.publishingRevision ?? null)
        : existing.publishingRevision,
      previousRevision: hasOwn(input, "previousRevision")
        ? (input.previousRevision ?? null)
        : existing.previousRevision,
      lastLifecycleSeverity: hasOwn(input, "lastLifecycleSeverity")
        ? (input.lastLifecycleSeverity ?? null)
        : existing.lastLifecycleSeverity,
      lastReindexMode: hasOwn(input, "lastReindexMode")
        ? (input.lastReindexMode ?? null)
        : existing.lastReindexMode,
      lastReindexReason: hasOwn(input, "lastReindexReason")
        ? (input.lastReindexReason ?? null)
        : existing.lastReindexReason,
    };

    this.repositories.set(repositoryId, updated);
    return freezeRecord(updated);
  }

  deleteRepository(repositoryId: string): boolean {
    return this.repositories.delete(repositoryId);
  }

  deleteRepositoryDurably(input: {
    repositoryId: string;
    ownerUserId: string;
    expectedVersion: number;
    responseReport: unknown;
  }): RepositoryDeletionTombstone {
    const existingTombstone = this.deletionTombstones.get(input.repositoryId);
    if (existingTombstone) {
      if (existingTombstone.ownerUserId !== input.ownerUserId) throw new Error("repository_not_owned");
      return structuredClone(existingTombstone);
    }
    const repository = this.repositories.get(input.repositoryId);
    if (!repository || repository.ownerUserId !== input.ownerUserId) throw new Error("repository_not_owned");
    const version = repository.persistenceVersion ?? 1;
    if (version !== input.expectedVersion) throw new RepositoryConcurrencyError(input.repositoryId, input.expectedVersion);
    const tombstone: RepositoryDeletionTombstone = {
      repositoryId: repository.repositoryId,
      owner: repository.owner,
      repo: repository.repo,
      ownerUserId: input.ownerUserId,
      deletionState: "deleted",
      deletedAt: now(),
      deletedRepositoryVersion: version + 1,
      cleanupPending: true,
      cleanupAttempts: 0,
      cleanupLastError: null,
      cleanupCompletedAt: null,
      responseReport: structuredClone(input.responseReport),
    };
    this.repositories.delete(input.repositoryId);
    this.deletionTombstones.set(input.repositoryId, structuredClone(tombstone));
    return structuredClone(tombstone);
  }

  getDeletionTombstone(repositoryId: string): RepositoryDeletionTombstone | null {
    const tombstone = this.deletionTombstones.get(repositoryId);
    return tombstone ? structuredClone(tombstone) : null;
  }

  listPendingDeletionCleanups(): RepositoryDeletionTombstone[] {
    return [...this.deletionTombstones.values()].filter((value) => value.cleanupPending).map((value) => structuredClone(value));
  }

  recordDeletionCleanupResult(input: { repositoryId: string; succeeded: boolean; error?: string | null }): RepositoryDeletionTombstone | null {
    const tombstone = this.deletionTombstones.get(input.repositoryId);
    if (!tombstone) return null;
    const updated: RepositoryDeletionTombstone = {
      ...tombstone,
      cleanupPending: !input.succeeded,
      cleanupAttempts: tombstone.cleanupAttempts + 1,
      cleanupLastError: input.succeeded ? null : (input.error ?? "filesystem cleanup failed"),
      cleanupCompletedAt: input.succeeded ? now() : null,
    };
    this.deletionTombstones.set(input.repositoryId, structuredClone(updated));
    return structuredClone(updated);
  }

  markIndexing(repositoryId: string): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;
    return this.updateRepository(repositoryId, {
      status: existing.currentRevision ? "indexed" : "indexing",
    }, existing.persistenceVersion ?? 1);
  }

  beginPublishing(repositoryId: string, revision: string): RepositoryRecord | null {
    if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Repository revision is invalid.");
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;
    if (existing.publishingRevision && existing.publishingRevision !== revision) {
      throw new RepositoryConcurrencyError(repositoryId, existing.persistenceVersion ?? 1);
    }
    return this.updateRepository(repositoryId, { publishingRevision: revision }, existing.persistenceVersion ?? 1);
  }

  rollbackRevision(repositoryId: string): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;
    if (existing.publishingRevision) {
      throw new RepositoryConcurrencyError(repositoryId, existing.persistenceVersion ?? 1);
    }
    if (!existing.previousRevision) throw new Error("Repository rollback revision is unavailable.");
    return this.updateRepository(repositoryId, {
      indexedRevision: existing.previousRevision,
      currentRevision: existing.previousRevision,
      previousRevision: existing.currentRevision,
      status: "indexed",
    }, existing.persistenceVersion ?? 1);
  }

  markIndexed(
    repositoryId: string,
    input: MarkIndexedInput,
  ): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;

    const timestamp = now();
    return this.updateRepository(repositoryId, {
      status: "indexed",
      indexedAt: timestamp,
      firstIndexedAt: existing.firstIndexedAt ?? timestamp,
      lastIndexedAt: timestamp,
      totalIndexedFiles: input.counts.fileCount,
      ...(input.indexMode !== undefined ? { lastIndexMode: input.indexMode } : {}),
      ...(input.changedFileCount !== undefined
        ? { lastChangedFileCount: input.changedFileCount }
        : {}),
      ...(input.indexedRevision !== undefined
        ? {
            indexedRevision: input.indexedRevision,
            currentRevision: input.indexedRevision,
            previousRevision: existing.currentRevision === input.indexedRevision
              ? existing.previousRevision
              : existing.currentRevision,
            publishingRevision: null,
          }
        : {}),
      counts: input.counts,
    }, existing.persistenceVersion ?? 1);
  }

  markFailed(
    repositoryId: string,
    input: MarkFailedInput = {},
  ): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;

    const timestamp = now();
    return this.updateRepository(repositoryId, {
      status: existing.currentRevision ? "indexed" : "failed",
      publishingRevision: null,
      lastFailureAt: timestamp,
      ...(input.reason !== undefined ? { failureReason: input.reason } : {}),
      ...(input.failedFileCount !== undefined
        ? { failedFileCount: input.failedFileCount }
        : {}),
      ...(input.lastSuccessfulFile !== undefined
        ? { lastSuccessfulFile: input.lastSuccessfulFile }
        : {}),
    }, existing.persistenceVersion ?? 1);
  }

  touchAccess(repositoryId: string): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;

    return this.updateRepository(
      repositoryId,
      { lastAccessedAt: now() },
      existing.persistenceVersion ?? 1,
    );
  }

  repositoryExists(repositoryId: string): boolean {
    return this.repositories.has(repositoryId);
  }

  clear(): void {
    this.repositories.clear();
    this.deletionTombstones.clear();
  }
}
