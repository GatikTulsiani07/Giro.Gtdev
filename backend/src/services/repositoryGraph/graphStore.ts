import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import type { RepositorySnapshotIdentity } from "../indexing/snapshots/repositorySnapshotStore.js";
import { repositoryQuotaErrorFromMessage } from "../repository/quotas/repositoryQuota.js";
import type {
  RepositoryGraphQuotas,
  RepositoryGraphValidation,
  RepositorySymbolGraph,
} from "./graphTypes.js";
import { validateRepositoryGraph } from "./graphValidation.js";

export interface BeginRepositoryGraphResult {
  alreadyPublished: boolean;
  graphVersion: string;
}

export interface RepositoryGraphStore {
  begin(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    parserVersion: string,
    signal?: AbortSignal,
  ): Promise<BeginRepositoryGraphResult>;
  stage(
    identity: RepositorySnapshotIdentity,
    graph: RepositorySymbolGraph,
    signal?: AbortSignal,
  ): Promise<void>;
  validate(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    quotas?: RepositoryGraphQuotas,
    signal?: AbortSignal,
  ): Promise<RepositoryGraphValidation>;
  publish(identity: RepositorySnapshotIdentity, graphVersion: string, signal?: AbortSignal): Promise<void>;
  discard(identity: RepositorySnapshotIdentity, graphVersion: string, diagnostics?: unknown): Promise<void>;
  loadPublished(
    repositoryId: string,
    repositoryRevision: string,
    signal?: AbortSignal,
  ): Promise<RepositorySymbolGraph | null>;
  collect(repositoryId: string, retentionCount?: number): Promise<number>;
  recover(signal?: AbortSignal): Promise<number>;
  verify(signal?: AbortSignal): Promise<void>;
}

interface MemoryGraphVersion {
  identity: RepositorySnapshotIdentity;
  graphVersion: string;
  parserVersion: string;
  graph: RepositorySymbolGraph | null;
  validation: RepositoryGraphValidation | null;
  status: RepositorySymbolGraph["status"];
  publicationOrder: number | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryRepositoryGraphStore implements RepositoryGraphStore {
  private readonly versions = new Map<string, MemoryGraphVersion>();
  private readonly publications = new Map<string, string>();
  private order = 0;

  async begin(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    parserVersion: string,
  ): Promise<BeginRepositoryGraphResult> {
    const publishedVersion = this.publications.get(identity.repositoryId);
    const published = publishedVersion ? this.versions.get(publishedVersion) : null;
    if (
      published?.status === "published" &&
      published.identity.revision === identity.revision &&
      published.graphVersion === graphVersion
    ) {
      return { alreadyPublished: true, graphVersion };
    }
    const existing = this.versions.get(graphVersion);
    if (
      existing &&
      !["failed", "superseded"].includes(existing.status) &&
      existing.identity.jobId !== identity.jobId
    ) {
      throw new Error("Repository graph version is already being built.");
    }
    this.versions.set(graphVersion, {
      identity: clone(identity),
      graphVersion,
      parserVersion,
      graph: existing?.graph ?? null,
      validation: null,
      status: "building",
      publicationOrder: null,
    });
    return { alreadyPublished: false, graphVersion };
  }

  async stage(
    identity: RepositorySnapshotIdentity,
    graph: RepositorySymbolGraph,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const version = this.versions.get(graph.graphVersion);
    if (
      !version ||
      version.status !== "building" ||
      version.identity.jobId !== identity.jobId ||
      version.identity.workerId !== identity.workerId ||
      version.identity.claimToken !== identity.claimToken
    ) {
      throw new Error("indexing_job_lease_conflict");
    }
    version.graph = clone(graph);
  }

  async validate(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    quotas?: RepositoryGraphQuotas,
    signal?: AbortSignal,
  ): Promise<RepositoryGraphValidation> {
    signal?.throwIfAborted();
    const version = this.versions.get(graphVersion);
    if (!version || !version.graph || version.status !== "building" || version.identity.jobId !== identity.jobId) {
      throw new Error("Repository graph is not ready for validation.");
    }
    version.status = "validating";
    let validation: RepositoryGraphValidation;
    try {
      validation = validateRepositoryGraph(version.graph, {
        expectedRepositoryId: identity.repositoryId,
        expectedRepositoryRevision: identity.revision,
        quotas,
      });
    } catch (error) {
      version.status = "failed";
      version.graph.status = "failed";
      throw error;
    }
    version.validation = clone(validation);
    if (!validation.valid) {
      version.status = "failed";
      throw new Error(`Repository graph validation failed: ${validation.failures.map((item) => item.code).join(",")}`);
    }
    return validation;
  }

  async publish(identity: RepositorySnapshotIdentity, graphVersion: string): Promise<void> {
    const version = this.versions.get(graphVersion);
    if (
      !version ||
      !version.graph ||
      !version.validation?.valid ||
      (version.status !== "validating" && version.status !== "published") ||
      version.identity.revision !== identity.revision
    ) {
      throw new Error("Validated repository graph is required for publication.");
    }
    const previousVersion = this.publications.get(identity.repositoryId);
    if (previousVersion && previousVersion !== graphVersion) {
      const previous = this.versions.get(previousVersion);
      if (previous) previous.status = "superseded";
    }
    version.status = "published";
    version.graph.status = "published";
    version.graph.publishedAt ??= new Date().toISOString();
    version.publicationOrder = ++this.order;
    this.publications.set(identity.repositoryId, graphVersion);
  }

  async discard(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    _diagnostics?: unknown,
  ): Promise<void> {
    const version = this.versions.get(graphVersion);
    if (version?.identity.jobId === identity.jobId && ["building", "validating"].includes(version.status)) {
      version.status = "failed";
      if (version.graph) version.graph.status = "failed";
    }
  }

  async loadPublished(
    repositoryId: string,
    repositoryRevision: string,
    signal?: AbortSignal,
  ): Promise<RepositorySymbolGraph | null> {
    signal?.throwIfAborted();
    const graphVersion = this.publications.get(repositoryId);
    const version = graphVersion ? this.versions.get(graphVersion) : null;
    if (
      !version?.graph ||
      version.status !== "published" ||
      version.identity.revision !== repositoryRevision
    ) return null;
    return clone(version.graph);
  }

  async collect(repositoryId: string, retentionCount = env.REPOSITORY_GRAPH_RETENTION_COUNT): Promise<number> {
    const current = this.publications.get(repositoryId);
    const retained = new Set([...this.versions.values()]
      .filter((version) =>
        version.identity.repositoryId === repositoryId &&
        ["published", "superseded"].includes(version.status))
      .sort((left, right) => (right.publicationOrder ?? 0) - (left.publicationOrder ?? 0))
      .slice(0, Math.max(1, retentionCount))
      .map((version) => version.graphVersion));
    if (current) retained.add(current);
    let removed = 0;
    for (const [graphVersion, version] of this.versions) {
      if (
        version.identity.repositoryId !== repositoryId ||
        ["building", "validating"].includes(version.status) ||
        retained.has(graphVersion)
      ) continue;
      this.versions.delete(graphVersion);
      removed += 1;
    }
    return removed;
  }

  async recover(): Promise<number> {
    let recovered = 0;
    for (const version of this.versions.values()) {
      if (["building", "validating"].includes(version.status)) {
        version.status = "failed";
        recovered += 1;
      }
    }
    return recovered;
  }

  async verify(): Promise<void> {
    for (const [repositoryId, graphVersion] of this.publications) {
      const version = this.versions.get(graphVersion);
      if (!version?.graph || version.status !== "published" || version.identity.repositoryId !== repositoryId) {
        throw new Error("Repository graph publication contract is invalid.");
      }
    }
  }
}

interface RpcQuery extends PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}> {
  abortSignal?(signal: AbortSignal): RpcQuery;
}

interface DatabaseClient {
  rpc(name: string, parameters: Record<string, unknown>): RpcQuery;
}

async function rpc(
  client: DatabaseClient,
  name: string,
  parameters: Record<string, unknown>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let query = client.rpc(name, parameters);
  if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
  return query;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function assertNoError(error: { message?: string } | null, fallback: string): void {
  if (!error) return;
  const quota = repositoryQuotaErrorFromMessage(error.message);
  if (quota) throw quota;
  throw new Error(`${fallback}${error.message ? `: ${error.message}` : ""}`);
}

function graphFromRow(row: Record<string, unknown>): RepositorySymbolGraph {
  return {
    graphVersion: String(row.graph_version),
    repositoryId: String(row.repository_id),
    repositoryRevision: String(row.repository_revision),
    repositoryVersion: String(row.repository_revision),
    parserVersion: String(row.parser_version),
    status: "published",
    createdAt: String(row.created_at),
    publishedAt: String(row.published_at),
    nodes: clone(row.nodes as RepositorySymbolGraph["nodes"]),
    edges: clone(row.edges as RepositorySymbolGraph["edges"]),
    diagnostics: clone(row.diagnostics as RepositorySymbolGraph["diagnostics"]),
  };
}

export class SupabaseRepositoryGraphStore implements RepositoryGraphStore {
  private readonly client: DatabaseClient;

  constructor(client: DatabaseClient | SupabaseClient) {
    this.client = client as DatabaseClient;
  }

  async begin(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    parserVersion: string,
    signal?: AbortSignal,
  ): Promise<BeginRepositoryGraphResult> {
    const { data, error } = await rpc(this.client, "begin_repository_graph_version", {
      input_repository_id: identity.repositoryId,
      input_repository_revision: identity.revision,
      input_graph_version: graphVersion,
      input_parser_version: parserVersion,
      input_job_id: identity.jobId,
      input_worker_id: identity.workerId,
      input_claim_token: identity.claimToken,
    }, signal);
    assertNoError(error, "Repository graph staging failed");
    const row = firstRow(data);
    if (!row) throw new Error("Repository graph staging returned no state.");
    return {
      alreadyPublished: row.already_published === true,
      graphVersion: String(row.graph_version),
    };
  }

  async stage(
    identity: RepositorySnapshotIdentity,
    graph: RepositorySymbolGraph,
    signal?: AbortSignal,
  ): Promise<void> {
    const { error } = await rpc(this.client, "stage_repository_graph_version", {
      input_repository_id: identity.repositoryId,
      input_repository_revision: identity.revision,
      input_graph_version: graph.graphVersion,
      input_job_id: identity.jobId,
      input_worker_id: identity.workerId,
      input_claim_token: identity.claimToken,
      input_nodes: graph.nodes,
      input_edges: graph.edges,
      input_diagnostics: graph.diagnostics,
    }, signal);
    assertNoError(error, "Repository graph persistence failed");
  }

  async validate(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    quotas?: RepositoryGraphQuotas,
    signal?: AbortSignal,
  ): Promise<RepositoryGraphValidation> {
    const effective = quotas ?? {
      maxNodes: env.REPOSITORY_GRAPH_MAX_NODES,
      maxEdges: env.REPOSITORY_GRAPH_MAX_EDGES,
      maxDurationMs: env.REPOSITORY_GRAPH_MAX_DURATION_MS,
      maxBytes: env.REPOSITORY_GRAPH_MAX_BYTES,
      maxUnresolvedFileRatio: env.REPOSITORY_GRAPH_MAX_UNRESOLVED_RATIO,
      maxParserFailureRatio: env.REPOSITORY_GRAPH_MAX_PARSER_FAILURE_RATIO,
    };
    const { data, error } = await rpc(this.client, "validate_repository_graph_version", {
      input_repository_id: identity.repositoryId,
      input_repository_revision: identity.revision,
      input_graph_version: graphVersion,
      input_job_id: identity.jobId,
      input_worker_id: identity.workerId,
      input_claim_token: identity.claimToken,
      input_max_nodes: effective.maxNodes,
      input_max_edges: effective.maxEdges,
      input_max_duration_ms: effective.maxDurationMs,
      input_max_graph_bytes: effective.maxBytes,
      input_max_unresolved_ratio: effective.maxUnresolvedFileRatio,
      input_max_parser_failure_ratio: effective.maxParserFailureRatio,
    }, signal);
    assertNoError(error, "Repository graph validation failed");
    const row = firstRow(data);
    if (!row?.valid) throw new Error("Repository graph validation failed.");
    return clone(row as unknown as RepositoryGraphValidation);
  }

  async publish(): Promise<void> {
    // PostgreSQL publishes the validated graph inside publish_repository_snapshot.
  }

  async discard(
    identity: RepositorySnapshotIdentity,
    graphVersion: string,
    diagnostics?: unknown,
  ): Promise<void> {
    const { error } = await rpc(this.client, "discard_repository_graph_version", {
      input_repository_id: identity.repositoryId,
      input_repository_revision: identity.revision,
      input_graph_version: graphVersion,
      input_job_id: identity.jobId,
      input_worker_id: identity.workerId,
      input_claim_token: identity.claimToken,
      input_diagnostics: diagnostics ?? {},
    });
    assertNoError(error, "Repository graph cleanup failed");
  }

  async loadPublished(
    repositoryId: string,
    repositoryRevision: string,
    signal?: AbortSignal,
  ): Promise<RepositorySymbolGraph | null> {
    const { data, error } = await rpc(this.client, "get_published_repository_graph", {
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    }, signal);
    assertNoError(error, "Repository graph retrieval failed");
    const row = firstRow(data);
    return row ? graphFromRow(row) : null;
  }

  async collect(repositoryId: string, retentionCount = env.REPOSITORY_GRAPH_RETENTION_COUNT): Promise<number> {
    const { data, error } = await rpc(this.client, "collect_repository_graph_versions", {
      input_repository_id: repositoryId,
      input_retention_count: retentionCount,
    });
    assertNoError(error, "Repository graph retention failed");
    return Number(firstRow(data)?.deleted_version_count ?? data ?? 0);
  }

  async recover(signal?: AbortSignal): Promise<number> {
    const { data, error } = await rpc(this.client, "recover_repository_graph_versions", {}, signal);
    assertNoError(error, "Repository graph recovery failed");
    return Number(firstRow(data)?.cleaned_version_count ?? data ?? 0);
  }

  async verify(signal?: AbortSignal): Promise<void> {
    const { data, error } = await rpc(this.client, "verify_repository_graph_contract", {}, signal);
    assertNoError(error, "Repository graph startup validation failed");
    if (firstRow(data)?.valid !== true) throw new Error("Repository graph startup validation failed.");
  }
}

export const runtimeRepositoryGraphStore = new SupabaseRepositoryGraphStore(supabase);
