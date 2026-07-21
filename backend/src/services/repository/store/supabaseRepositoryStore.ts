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
export interface RepositoryDatabaseClient { from(table: string): Query }

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
      connectedAt: timestamp, updatedAt: timestamp, indexedAt: null,
      firstIndexedAt: null, lastIndexedAt: null, lastAccessedAt: null,
      chunkCount: 0, fileCount: 0, symbolCount: 0, graphNodeCount: 0,
      graphEdgeCount: 0, summaryAvailable: false, totalIndexedFiles: 0,
      lastIndexMode: null, lastChangedFileCount: 0, lastFailureAt: null,
      failureReason: null, failedFileCount: 0, lastSuccessfulFile: null,
      retryCount: 0, lastRetryAt: null, indexedRevision: null,
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
  async markIndexing(id: string) {
    const existing = await this.getRepository(id);
    if (!existing) return null;
    return this.updateRepository(id, {
      status: existing.indexedRevision ? "indexed" : "indexing",
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
      ...(input.indexedRevision !== undefined ? { indexedRevision: input.indexedRevision } : {}),
      counts: input.counts }, persistenceVersion(existing));
  }
  async markFailed(id: string, input: MarkFailedInput = {}) {
    const existing = await this.getRepository(id);
    if (!existing) return null;
    return this.updateRepository(id, {
      status: existing.indexedRevision ? "indexed" : "failed",
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
  clear(): never { throw new Error("Clearing durable repository storage is not supported at runtime."); }
}
