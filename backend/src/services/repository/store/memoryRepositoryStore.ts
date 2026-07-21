import {
  RepositoryConcurrencyError,
  type ConnectRepositoryInput,
  type MarkFailedInput,
  type MarkIndexedInput,
  type RepositoryRecord,
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

  connectRepository(input: ConnectRepositoryInput): RepositoryRecord {
    const id = repositoryId(input.owner, input.repo);
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

  markIndexing(repositoryId: string): RepositoryRecord | null {
    const existing = this.repositories.get(repositoryId);
    if (!existing) return null;
    return this.updateRepository(repositoryId, {
      status: existing.indexedRevision ? "indexed" : "indexing",
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
        ? { indexedRevision: input.indexedRevision }
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
      status: existing.indexedRevision ? "indexed" : "failed",
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
  }
}
