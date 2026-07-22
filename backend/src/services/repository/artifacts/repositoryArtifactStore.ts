import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../../config/env.js";
import { supabase } from "../../../lib/supabase.js";
import type { FileSymbolMap } from "../../graph/types.js";
import type { RepositoryFileSnapshot } from "../fileSnapshotStore.js";
import type { RepositorySymbolRecord } from "../symbolIndexStore.js";
import type { RepositorySymbolGraph } from "../../repositoryGraph/graphTypes.js";
import type { RepositorySummary } from "../../repositorySummary/summaryTypes.js";
import type { RepositorySnapshotIdentity } from "../../indexing/snapshots/repositorySnapshotStore.js";
import { assertRepositoryQuota, repositoryQuotaErrorFromMessage, runtimeRepositoryQuotas, serializedArtifactBytes } from "../quotas/repositoryQuota.js";

export interface RepositoryArtifacts {
  graph: RepositorySymbolGraph;
  summary: RepositorySummary;
  fileSnapshot: RepositoryFileSnapshot;
  symbolIndex: RepositorySymbolRecord[];
  graphSource: FileSymbolMap[];
}

export interface PublishedRepositoryArtifacts extends RepositoryArtifacts {
  repositoryId: string;
  repositoryRevision: string;
}

export interface RepositoryArtifactStore {
  stage(identity: RepositorySnapshotIdentity, artifacts: RepositoryArtifacts, maxArtifactBytes?: number, signal?: AbortSignal): Promise<void>;
  load(repositoryId: string, repositoryRevision: string, signal?: AbortSignal): Promise<PublishedRepositoryArtifacts | null>;
  loadCurrent(repositoryId: string, signal?: AbortSignal): Promise<PublishedRepositoryArtifacts | null>;
  collect(repositoryId: string, retentionCount?: number): Promise<number>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function published(
  repositoryId: string,
  repositoryRevision: string,
  artifacts: RepositoryArtifacts,
): PublishedRepositoryArtifacts {
  return { repositoryId, repositoryRevision, ...clone(artifacts) };
}

interface MemoryRevision {
  state: "building" | "published" | "failed";
  identity: RepositorySnapshotIdentity;
  artifacts: RepositoryArtifacts | null;
  publishedOrder: number | null;
}

/** Durable-store behavioral reference used by tests and local memory adapters. */
export class MemoryRepositoryArtifactStore implements RepositoryArtifactStore {
  private readonly revisions = new Map<string, Map<string, MemoryRevision>>();
  private readonly active = new Map<string, string>();
  private publicationOrder = 0;

  begin(identity: RepositorySnapshotIdentity): void {
    const revisions = this.revisions.get(identity.repositoryId) ?? new Map<string, MemoryRevision>();
    const existing = revisions.get(identity.revision);
    if (existing?.state === "published") return;
    revisions.set(identity.revision, {
      state: "building",
      identity: clone(identity),
      artifacts: existing?.artifacts ?? null,
      publishedOrder: null,
    });
    this.revisions.set(identity.repositoryId, revisions);
  }

  async stage(identity: RepositorySnapshotIdentity, artifacts: RepositoryArtifacts, maxArtifactBytes = runtimeRepositoryQuotas.maxArtifactBytes, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    assertRepositoryQuota("artifact_size", serializedArtifactBytes(artifacts), maxArtifactBytes);
    const revision = this.revisions.get(identity.repositoryId)?.get(identity.revision);
    if (!revision || revision.state !== "building" ||
      revision.identity.jobId !== identity.jobId ||
      revision.identity.workerId !== identity.workerId ||
      revision.identity.claimToken !== identity.claimToken) {
      throw new Error("indexing_job_lease_conflict");
    }
    revision.artifacts = clone(artifacts);
    signal?.throwIfAborted();
  }

  publish(identity: RepositorySnapshotIdentity): void {
    const revisions = this.revisions.get(identity.repositoryId);
    const revision = revisions?.get(identity.revision);
    if (!revision || revision.state !== "building" || !revision.artifacts ||
      revision.identity.jobId !== identity.jobId ||
      revision.identity.workerId !== identity.workerId ||
      revision.identity.claimToken !== identity.claimToken) {
      throw new Error("repository artifacts are not ready to publish");
    }
    const previous = this.active.get(identity.repositoryId);
    if (previous && previous !== identity.revision) {
      const previousRevision = revisions?.get(previous);
      if (previousRevision) previousRevision.state = "published";
    }
    revision.state = "published";
    revision.publishedOrder = ++this.publicationOrder;
    this.active.set(identity.repositoryId, identity.revision);
  }

  discard(identity: RepositorySnapshotIdentity): void {
    const revision = this.revisions.get(identity.repositoryId)?.get(identity.revision);
    if (revision?.state === "building" && revision.identity.jobId === identity.jobId) {
      revision.state = "failed";
    }
  }

  async load(repositoryId: string, repositoryRevision: string, signal?: AbortSignal): Promise<PublishedRepositoryArtifacts | null> {
    signal?.throwIfAborted();
    const revision = this.revisions.get(repositoryId)?.get(repositoryRevision);
    return revision?.state === "published" && revision.artifacts
      ? published(repositoryId, repositoryRevision, revision.artifacts)
      : null;
  }

  async loadCurrent(repositoryId: string, signal?: AbortSignal): Promise<PublishedRepositoryArtifacts | null> {
    signal?.throwIfAborted();
    const revision = this.active.get(repositoryId);
    return revision ? this.load(repositoryId, revision, signal) : null;
  }

  async collect(repositoryId: string, retentionCount = env.REPOSITORY_ARTIFACT_RETENTION_COUNT): Promise<number> {
    const revisions = this.revisions.get(repositoryId);
    if (!revisions) return 0;
    const active = this.active.get(repositoryId);
    const retained = new Set([...revisions.entries()]
      .filter(([, value]) => value.state === "published")
      .sort((left, right) => (right[1].publishedOrder ?? 0) - (left[1].publishedOrder ?? 0))
      .slice(0, Math.max(1, retentionCount))
      .map(([revision]) => revision));
    if (active) retained.add(active);
    let deleted = 0;
    for (const [revision, value] of revisions) {
      if (value.state === "building" || retained.has(revision)) continue;
      revisions.delete(revision);
      deleted += 1;
    }
    return deleted;
  }
}

interface RpcQuery extends PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }> { abortSignal?(signal: AbortSignal): RpcQuery }
interface DatabaseClient {
  rpc(name: string, parameters: Record<string, unknown>): RpcQuery;
}

function rowToArtifacts(row: Record<string, unknown>): PublishedRepositoryArtifacts {
  return {
    repositoryId: String(row.repository_id),
    repositoryRevision: String(row.repository_revision),
    graph: clone(row.graph as RepositorySymbolGraph),
    summary: clone(row.summary as RepositorySummary),
    fileSnapshot: clone(row.file_snapshot as RepositoryFileSnapshot),
    symbolIndex: clone(row.symbol_index as RepositorySymbolRecord[]),
    graphSource: clone(row.graph_source as FileSymbolMap[]),
  };
}

export class SupabaseRepositoryArtifactStore implements RepositoryArtifactStore {
  constructor(private readonly client: DatabaseClient | SupabaseClient) {}

  async stage(identity: RepositorySnapshotIdentity, artifacts: RepositoryArtifacts, maxArtifactBytes = runtimeRepositoryQuotas.maxArtifactBytes, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    assertRepositoryQuota("artifact_size", serializedArtifactBytes(artifacts), maxArtifactBytes);
    let query = (this.client as DatabaseClient).rpc("stage_repository_artifacts", {
      input_repository_id: identity.repositoryId,
      input_repository_revision: identity.revision,
      input_job_id: identity.jobId,
      input_worker_id: identity.workerId,
      input_claim_token: identity.claimToken,
      input_graph: artifacts.graph,
      input_summary: artifacts.summary,
      input_file_snapshot: artifacts.fileSnapshot,
      input_symbol_index: artifacts.symbolIndex,
      input_graph_source: artifacts.graphSource,
      input_max_artifact_bytes: maxArtifactBytes,
    });
    if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
    const { error } = await query;
    if (error) throw repositoryQuotaErrorFromMessage(error.message) ?? new Error(error.message ?? "Repository artifact staging failed.");
  }

  async load(repositoryId: string, repositoryRevision: string, signal?: AbortSignal): Promise<PublishedRepositoryArtifacts | null> {
    let query = (this.client as DatabaseClient).rpc("get_repository_artifacts", {
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    });
    if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(error.message ?? "Repository artifact read failed.");
    const row = Array.isArray(data) ? data[0] : data;
    return row && typeof row === "object" ? rowToArtifacts(row as Record<string, unknown>) : null;
  }

  async loadCurrent(repositoryId: string, signal?: AbortSignal): Promise<PublishedRepositoryArtifacts | null> {
    let query = (this.client as DatabaseClient).rpc("get_current_repository_artifacts", {
      input_repository_id: repositoryId,
    });
    if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(error.message ?? "Current repository artifact read failed.");
    const row = Array.isArray(data) ? data[0] : data;
    return row && typeof row === "object" ? rowToArtifacts(row as Record<string, unknown>) : null;
  }

  async collect(repositoryId: string, retentionCount = env.REPOSITORY_ARTIFACT_RETENTION_COUNT): Promise<number> {
    const { data, error } = await (this.client as DatabaseClient).rpc("collect_repository_artifacts", {
      input_repository_id: repositoryId,
      input_retention_count: retentionCount,
    });
    if (error) throw new Error(error.message ?? "Repository artifact cleanup failed.");
    return Number(data ?? 0);
  }
}

export const runtimeRepositoryArtifactStore = new SupabaseRepositoryArtifactStore(supabase);
