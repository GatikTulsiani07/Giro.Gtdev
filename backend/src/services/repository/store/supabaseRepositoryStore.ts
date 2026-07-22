import type { SupabaseClient } from "@supabase/supabase-js";
import {
  repositoryRecordToRow,
  repositoryRowToRecord,
  repositoryUpdateToRow,
  type RepositoryPersistenceRow,
} from "./repositoryPersistenceMapper.js";
import {
  RepositoryConcurrencyError,
  type ConnectRepositoryInput,
  type MarkFailedInput,
  type MarkIndexedInput,
  type RepositoryRecord,
  type RepositoryDeletionTombstone,
  type RepositoryStore,
  type UpdateRepositoryInput,
} from "./repositoryStore.js";
/*
 * The store intentionally uses PostgREST's conditional UPDATE rather than a
 * read/merge/write payload. PostgreSQL serializes matching row updates, and
 * repository_version makes a stale condition match zero rows.
 */
interface Result { data: unknown; error: { code?: string; message?: string } | null }
interface Query extends PromiseLike<Result> {
  select(columns?: string): Query;
  insert(values: unknown): Query;
  update(values: unknown): Query;
  delete(): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  maybeSingle(): PromiseLike<Result>;
}
export interface RepositoryDatabaseClient {
  from(table: string): Query;
  rpc?(name: string, parameters: Record<string, unknown>): PromiseLike<Result>;
}

function row(data: unknown): RepositoryPersistenceRow | null {
  if (Array.isArray(data)) return (data[0] as RepositoryPersistenceRow | undefined) ?? null;
  return data && typeof data === "object" ? data as RepositoryPersistenceRow : null;
}
function rows(data: unknown): RepositoryPersistenceRow[] {
  return Array.isArray(data) ? data as RepositoryPersistenceRow[] : [];
}
function assertResult(error: Result["error"]): void {
  if (error) throw new Error(`Repository persistence failed: ${error.message ?? error.code ?? "database error"}`);
}

function persistenceVersion(record: RepositoryRecord): number {
  return record.persistenceVersion ?? 1;
}

export class SupabaseRepositoryStore implements RepositoryStore {
  private readonly client: RepositoryDatabaseClient;

  constructor(client: RepositoryDatabaseClient | SupabaseClient) {
    this.client = client as unknown as RepositoryDatabaseClient;
  }

  async connectRepository(input: ConnectRepositoryInput): Promise<RepositoryRecord> {
    const id = `${input.owner}/${input.repo}`;
    const existing = await this.getRepository(id);
    const timestamp = new Date().toISOString();
    if (existing) {
      if (!input.ownerUserId || input.ownerUserId === existing.ownerUserId) return existing;
      const updated = await this.updateRepository(id, {
        ownerUserId: input.ownerUserId,
      }, persistenceVersion(existing));
      if (!updated) throw new Error("Repository disappeared during persistence update.");
      return updated;
    }
    const record: RepositoryRecord = {
      persistenceVersion: 1,
      repositoryId: id, owner: input.owner, repo: input.repo,
      ownerUserId: input.ownerUserId ?? null, status: "connected",
      deletionState: "active",
      connectedAt: timestamp, updatedAt: timestamp, indexedAt: null,
      firstIndexedAt: null, lastIndexedAt: null, lastAccessedAt: null,
      chunkCount: 0, fileCount: 0, symbolCount: 0, graphNodeCount: 0,
      graphEdgeCount: 0, summaryAvailable: false, totalIndexedFiles: 0,
      lastIndexMode: null, lastChangedFileCount: 0, lastFailureAt: null,
      failureReason: null, failedFileCount: 0, lastSuccessfulFile: null,
      retryCount: 0, lastRetryAt: null, indexedRevision: null,
      currentRevision: null, publishingRevision: null, previousRevision: null,
      lastLifecycleSeverity: null, lastReindexMode: null, lastReindexReason: null,
    };
    const { data, error } = await this.client.from("repositories")
      .insert(repositoryRecordToRow(record)).select("*").maybeSingle();
    if (error?.code === "23505") {
      const raced = await this.getRepository(id);
      if (
        raced &&
        (!input.ownerUserId || raced.ownerUserId === input.ownerUserId)
      ) return raced;
      throw new RepositoryConcurrencyError(id, 0);
    }
    assertResult(error);
    const persisted = row(data);
    if (!persisted) throw new Error("Repository persistence returned no record.");
    return repositoryRowToRecord(persisted);
  }

  async getRepository(repositoryId: string): Promise<RepositoryRecord | null> {
    const { data, error } = await this.client.from("repositories").select("*")
      .eq("repository_id", repositoryId).maybeSingle();
    if (error?.code === "PGRST116") return null;
    assertResult(error);
    const persisted = row(data);
    return persisted ? repositoryRowToRecord(persisted) : null;
  }

  async listRepositories(): Promise<RepositoryRecord[]> {
    const { data, error } = await this.client.from("repositories").select("*")
      .order("repository_owner", { ascending: true })
      .order("repository_name", { ascending: true });
    assertResult(error);
    return rows(data).map(repositoryRowToRecord);
  }

  async updateRepository(
    repositoryId: string,
    input: UpdateRepositoryInput,
    expectedVersion?: number,
  ): Promise<RepositoryRecord | null> {
    const existing = await this.getRepository(repositoryId);
    if (!existing) return null;
    const requiredVersion = expectedVersion ?? persistenceVersion(existing);
    const patch = repositoryUpdateToRow(input);
    patch.updated_at = new Date().toISOString();
    patch.repository_version = requiredVersion + 1;
    const { data, error } = await this.client.from("repositories")
      .update(patch).eq("repository_id", repositoryId)
      .eq("repository_version", requiredVersion)
      .select("*").maybeSingle();
    if (error && error.code !== "PGRST116") assertResult(error);
    const persisted = row(data);
    if (persisted) return repositoryRowToRecord(persisted);
    const current = await this.getRepository(repositoryId);
    if (!current) return null;
    throw new RepositoryConcurrencyError(repositoryId, requiredVersion);
  }

  async deleteRepository(repositoryId: string): Promise<boolean> {
    const existing = await this.getRepository(repositoryId);
    if (!existing) return false;
    const requiredVersion = persistenceVersion(existing);
    const { data, error } = await this.client.from("repositories").delete()
      .eq("repository_id", repositoryId)
      .eq("repository_version", requiredVersion)
      .select("*");
    assertResult(error);
    if (row(data)) return true;
    const current = await this.getRepository(repositoryId);
    if (!current) return false;
    throw new RepositoryConcurrencyError(repositoryId, requiredVersion);
  }
  async deleteRepositoryDurably(input: {
    repositoryId: string;
    ownerUserId: string;
    expectedVersion: number;
    responseReport: unknown;
  }): Promise<RepositoryDeletionTombstone> {
    if (!this.client.rpc) throw new Error("Repository deletion is unavailable.");
    const { data, error } = await this.client.rpc("delete_repository_transactionally", {
      input_repository_id: input.repositoryId,
      input_owner_user_id: input.ownerUserId,
      input_expected_version: input.expectedVersion,
      input_response_report: input.responseReport,
    });
    assertResult(error);
    const value = Array.isArray(data) ? data[0] : data;
    if (!value || typeof value !== "object") throw new Error("Repository deletion returned no tombstone.");
    return deletionTombstone(value as Record<string, unknown>);
  }
  async getDeletionTombstone(repositoryId: string): Promise<RepositoryDeletionTombstone | null> {
    const { data, error } = await this.client.from("repository_deletion_tombstones").select("*")
      .eq("repository_id", repositoryId).maybeSingle();
    if (error?.code === "PGRST116") return null;
    assertResult(error);
    const value = Array.isArray(data) ? data[0] : data;
    return value && typeof value === "object" ? deletionTombstone(value as Record<string, unknown>) : null;
  }
  async listPendingDeletionCleanups(): Promise<RepositoryDeletionTombstone[]> {
    const { data, error } = await this.client.from("repository_deletion_tombstones").select("*")
      .eq("cleanup_pending", true).order("deleted_at", { ascending: true });
    assertResult(error);
    return rows(data).map((value) => deletionTombstone(value as unknown as Record<string, unknown>));
  }
  async recordDeletionCleanupResult(input: { repositoryId: string; succeeded: boolean; error?: string | null }): Promise<RepositoryDeletionTombstone | null> {
    if (!this.client.rpc) throw new Error("Repository deletion cleanup persistence is unavailable.");
    const { data, error } = await this.client.rpc("record_repository_deletion_cleanup", {
      input_repository_id: input.repositoryId,
      input_succeeded: input.succeeded,
      input_error: input.error ?? null,
    });
    assertResult(error);
    const value = Array.isArray(data) ? data[0] : data;
    return value && typeof value === "object" ? deletionTombstone(value as Record<string, unknown>) : null;
  }
  async markIndexing(id: string) {
    const existing = await this.getRepository(id);
    if (!existing) return null;
    return this.updateRepository(id, {
      status: existing.currentRevision ? "indexed" : "indexing",
    }, persistenceVersion(existing));
  }
  async markIndexed(id: string, input: MarkIndexedInput) {
    const existing = await this.getRepository(id); if (!existing) return null;
    const timestamp = new Date().toISOString();
    return this.updateRepository(id, { status: "indexed", indexedAt: timestamp,
      firstIndexedAt: existing.firstIndexedAt ?? timestamp, lastIndexedAt: timestamp,
      totalIndexedFiles: input.counts.fileCount,
      ...(input.indexMode !== undefined ? { lastIndexMode: input.indexMode } : {}),
      ...(input.changedFileCount !== undefined ? { lastChangedFileCount: input.changedFileCount } : {}),
      ...(input.indexedRevision !== undefined ? {
        indexedRevision: input.indexedRevision,
        currentRevision: input.indexedRevision,
        previousRevision: existing.currentRevision === input.indexedRevision
          ? existing.previousRevision
          : existing.currentRevision,
        publishingRevision: null,
      } : {}),
      counts: input.counts }, persistenceVersion(existing));
  }
  async markFailed(id: string, input: MarkFailedInput = {}) {
    const existing = await this.getRepository(id);
    if (!existing) return null;
    return this.updateRepository(id, {
      status: existing.currentRevision ? "indexed" : "failed",
      publishingRevision: null,
      lastFailureAt: new Date().toISOString(),
      ...(input.reason !== undefined ? { failureReason: input.reason } : {}),
      ...(input.failedFileCount !== undefined ? { failedFileCount: input.failedFileCount } : {}),
      ...(input.lastSuccessfulFile !== undefined ? { lastSuccessfulFile: input.lastSuccessfulFile } : {}),
    }, persistenceVersion(existing));
  }
  async touchAccess(id: string) {
    const existing = await this.getRepository(id);
    if (!existing) return null;
    return this.updateRepository(
      id,
      { lastAccessedAt: new Date().toISOString() },
      persistenceVersion(existing),
    );
  }
  async repositoryExists(id: string) { return (await this.getRepository(id)) !== null; }
  async rollbackRevision(id: string): Promise<RepositoryRecord | null> {
    if (!this.client.rpc) throw new Error("Repository rollback is unavailable.");
    const { error } = await this.client.rpc("rollback_repository_revision", {
      input_repository_id: id,
    });
    assertResult(error);
    return this.getRepository(id);
  }
  clear(): never { throw new Error("Clearing durable repository storage is not supported at runtime."); }
}

function deletionTombstone(row: Record<string, unknown>): RepositoryDeletionTombstone {
  return {
    repositoryId: String(row.repository_id),
    owner: String(row.repository_owner),
    repo: String(row.repository_name),
    ownerUserId: String(row.owner_user_id),
    deletionState: "deleted",
    deletedAt: String(row.deleted_at),
    deletedRepositoryVersion: Number(row.deleted_repository_version),
    cleanupPending: Boolean(row.cleanup_pending),
    cleanupAttempts: Number(row.cleanup_attempts ?? 0),
    cleanupLastError: row.cleanup_last_error == null ? null : String(row.cleanup_last_error),
    cleanupCompletedAt: row.cleanup_completed_at == null ? null : String(row.cleanup_completed_at),
    responseReport: row.response_report,
  };
}
