import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase.js";
import {
  FEATURE_INTELLIGENCE_ENGINE_VERSION,
  FEATURE_INTELLIGENCE_SCHEMA_VERSION,
  FeatureIntelligenceError,
  type FeatureGraph,
  type FeatureMetrics,
} from "./types.js";
import { cloneFeatureGraph as clone, validateFeatureGraph } from "./validation.js";

export interface FeatureIntelligenceStore {
  save(graph: FeatureGraph, expectedVersion?: number | null): Promise<FeatureGraph>;
  get(
    tenantId: string, ownerId: string, repositoryId: string, repositoryRevision: string,
  ): Promise<FeatureGraph | null>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<FeatureMetrics>;
  collect(tenantId: string, retainedVersions: number): Promise<number>;
  verify(): Promise<void>;
}

function emptyMetrics(): FeatureMetrics {
  return {
    featuresDiscovered: 0,
    averageFeatureSize: 0,
    dependencyDensity: 0,
    rebuildDurationMs: 0,
    incrementalRebuildCount: 0,
    recoveryCount: 0,
  };
}

export class MemoryFeatureIntelligenceStore implements FeatureIntelligenceStore {
  private readonly graphs = new Map<string, FeatureGraph>();

  hydrate(graph: FeatureGraph): void {
    this.graphs.set(this.key(graph.tenantId, graph.graphVersion), clone(graph));
  }

  private key(tenantId: string, graphVersion: string) {
    return `${tenantId}\0${graphVersion}`;
  }

  async save(graph: FeatureGraph, expectedVersion: number | null = null) {
    validateFeatureGraph(graph);
    const key = this.key(graph.tenantId, graph.graphVersion);
    const existing = this.graphs.get(key);
    if ((existing && expectedVersion !== null &&
        existing.persistenceVersion !== expectedVersion) ||
        (!existing && expectedVersion !== null)) {
      throw new FeatureIntelligenceError(
        "feature_graph_version_conflict",
        "Feature graph was modified concurrently.",
      );
    }
    if (existing && existing.ownerId !== graph.ownerId) {
      throw new FeatureIntelligenceError(
        "feature_repository_access_denied",
        "Feature graph ownership cannot change.",
      );
    }
    for (const [candidateKey, candidate] of this.graphs) {
      if (candidate.tenantId === graph.tenantId &&
          candidate.repositoryId === graph.repositoryId &&
          candidate.ownerId === graph.ownerId &&
          candidate.lifecycle === "published" &&
          candidate.graphVersion !== graph.graphVersion) {
        this.graphs.set(candidateKey, clone({
          ...candidate,
          lifecycle: "superseded",
          persistenceVersion: candidate.persistenceVersion + 1,
          updatedAt: graph.updatedAt,
        }));
      }
    }
    const saved = clone({
      ...graph,
      persistenceVersion: existing ? existing.persistenceVersion + 1 : 1,
    });
    this.graphs.set(key, saved);
    return clone(saved);
  }

  async get(
    tenantId: string, ownerId: string, repositoryId: string, repositoryRevision: string,
  ) {
    const graph = [...this.graphs.values()].find((candidate) =>
      candidate.tenantId === tenantId && candidate.ownerId === ownerId &&
      candidate.repositoryId === repositoryId &&
      candidate.repositoryRevision === repositoryRevision &&
      candidate.lifecycle === "published");
    return graph ? clone(graph) : null;
  }

  async recover(): Promise<number> {
    let count = 0;
    for (const [key, graph] of this.graphs) {
      const interrupted = ["building", "validating"].includes(graph.lifecycle);
      const features = graph.features.filter((feature) =>
        feature.files.length > 0 && feature.symbolIds.length > 0 &&
        feature.owningModules.length > 0);
      const ids = new Set(features.map((item) => item.featureId));
      const relationships = graph.relationships.filter((edge) =>
        ids.has(edge.fromFeatureId) &&
        (edge.toFeatureId === null || ids.has(edge.toFeatureId)));
      const flows = graph.flows.filter((flow) => ids.has(flow.featureId) &&
        flow.steps.length >= 2);
      const stale = features.length !== graph.features.length ||
        relationships.length !== graph.relationships.length ||
        flows.length !== graph.flows.length;
      if (!interrupted && !stale) continue;
      count += 1;
      const timestamp = new Date().toISOString();
      this.graphs.set(key, clone({
        ...graph,
        persistenceVersion: graph.persistenceVersion + 1,
        lifecycle: interrupted ? "failed" : graph.lifecycle,
        features,
        relationships,
        flows,
        diagnostics: [...graph.diagnostics, {
          code: interrupted
            ? "feature_interrupted_indexing_recovered"
            : "feature_stale_graph_recovered",
          message: interrupted
            ? "Interrupted feature indexing was fenced from publication."
            : "Orphan features, stale relationships, or partial flows were removed.",
          severity: "warning",
        }],
        metrics: {
          ...graph.metrics,
          featuresDiscovered: features.length,
          recoveryCount: graph.metrics.recoveryCount + 1,
        },
        updatedAt: timestamp,
        publishedAt: interrupted ? null : graph.publishedAt,
      }));
    }
    return count;
  }

  async metrics(tenantId?: string): Promise<FeatureMetrics> {
    const graphs = [...this.graphs.values()].filter((graph) =>
      tenantId === undefined || graph.tenantId === tenantId);
    if (graphs.length === 0) return emptyMetrics();
    const totalFeatures = graphs.reduce((sum, graph) =>
      sum + graph.metrics.featuresDiscovered, 0);
    return {
      featuresDiscovered: totalFeatures,
      averageFeatureSize: totalFeatures === 0 ? 0 : Number((
        graphs.reduce((sum, graph) =>
          sum + graph.metrics.averageFeatureSize *
            graph.metrics.featuresDiscovered, 0) / totalFeatures
      ).toFixed(3)),
      dependencyDensity: Number((
        graphs.reduce((sum, graph) =>
          sum + graph.metrics.dependencyDensity, 0) / graphs.length
      ).toFixed(3)),
      rebuildDurationMs: graphs.reduce((sum, graph) =>
        sum + graph.metrics.rebuildDurationMs, 0),
      incrementalRebuildCount: graphs.reduce((sum, graph) =>
        sum + graph.metrics.incrementalRebuildCount, 0),
      recoveryCount: graphs.reduce((sum, graph) =>
        sum + graph.metrics.recoveryCount, 0),
    };
  }

  async collect(tenantId: string, retainedVersions: number): Promise<number> {
    const candidates = [...this.graphs.entries()]
      .filter(([, graph]) =>
        graph.tenantId === tenantId && graph.lifecycle !== "published")
      .sort(([, a], [, b]) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.graphVersion.localeCompare(a.graphVersion));
    let removed = 0;
    for (const [key] of candidates.slice(Math.max(1, retainedVersions))) {
      this.graphs.delete(key);
      removed += 1;
    }
    return removed;
  }

  async verify(): Promise<void> {}
}

type Database = Pick<SupabaseClient, "rpc">;
function first(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value)
    ? value[0] as Record<string, unknown> | undefined
    : value as Record<string, unknown> | undefined;
}

export class PostgresFeatureIntelligenceStore implements FeatureIntelligenceStore {
  constructor(private readonly database: Database) {}

  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) {
      throw new FeatureIntelligenceError(
        String(error.message ?? "").includes("version_conflict")
          ? "feature_graph_version_conflict"
          : "feature_graph_persistence_failed",
        error.message ?? "Feature graph persistence failed.",
      );
    }
    return data;
  }

  async save(graph: FeatureGraph, expectedVersion: number | null = null) {
    validateFeatureGraph(graph);
    const data = await this.call("save_feature_intelligence_graph", {
      input_graph: graph,
      input_expected_version:
        expectedVersion === null ? null : String(expectedVersion),
    });
    return clone((first(data)?.graph ?? data) as FeatureGraph);
  }

  async get(
    tenantId: string, ownerId: string, repositoryId: string, repositoryRevision: string,
  ) {
    const data = await this.call("get_feature_intelligence_graph", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    });
    const graph = first(data)?.graph ?? data;
    return graph ? clone(graph as FeatureGraph) : null;
  }

  async recover() {
    const data = await this.call("recover_feature_intelligence_graphs");
    return Number(first(data)?.recovered_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("feature_intelligence_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return structuredClone((first(data)?.metrics ?? data) as FeatureMetrics);
  }

  async collect(tenantId: string, retainedVersions: number) {
    const data = await this.call("collect_feature_intelligence_graphs", {
      input_tenant_id: tenantId,
      input_retained_versions: retainedVersions,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async verify() {
    const data = await this.call("verify_feature_intelligence_contract", {
      input_engine_version: FEATURE_INTELLIGENCE_ENGINE_VERSION,
      input_schema_version: FEATURE_INTELLIGENCE_SCHEMA_VERSION,
    });
    const result = first(data) ?? {};
    if (result.valid !== true && data !== true) {
      throw new FeatureIntelligenceError(
        "feature_startup_validation_failed",
        "Feature intelligence database contract is invalid.",
        { problems: result.problems ?? [] },
      );
    }
  }
}

export const runtimeFeatureIntelligenceStore: FeatureIntelligenceStore =
  new PostgresFeatureIntelligenceStore(supabase as unknown as SupabaseClient);
