import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase.js";
import {
  SEMANTIC_ENGINE_VERSION,
  SEMANTIC_SCHEMA_VERSION,
  SemanticCodeIntelligenceError,
  type SemanticGraph,
  type SemanticStoreMetrics,
} from "./types.js";
import { cloneSemanticGraph as clone, validateSemanticGraph } from "./validation.js";

export interface SemanticCodeIntelligenceStore {
  save(graph: SemanticGraph, expectedVersion?: number | null): Promise<SemanticGraph>;
  get(
    tenantId: string, ownerId: string, repositoryId: string, repositoryRevision: string,
  ): Promise<SemanticGraph | null>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<SemanticStoreMetrics>;
  collect(tenantId: string, retainedVersions: number): Promise<number>;
  verify(): Promise<void>;
}

function zeroMetrics(): SemanticStoreMetrics {
  return {
    indexedSymbols: 0,
    indexedRelationships: 0,
    indexingDurationMs: 0,
    graphRebuilds: 0,
    incrementalUpdates: 0,
    recoveryOperations: 0,
  };
}

export class MemorySemanticCodeIntelligenceStore
implements SemanticCodeIntelligenceStore {
  private readonly graphs = new Map<string, SemanticGraph>();

  hydrate(graph: SemanticGraph): void {
    this.graphs.set(this.key(graph.tenantId, graph.graphVersion), clone(graph));
  }

  private key(tenantId: string, graphVersion: string): string {
    return `${tenantId}\0${graphVersion}`;
  }

  async save(graph: SemanticGraph, expectedVersion: number | null = null):
  Promise<SemanticGraph> {
    validateSemanticGraph(graph);
    const key = this.key(graph.tenantId, graph.graphVersion);
    const existing = this.graphs.get(key);
    if (existing && expectedVersion !== null &&
        existing.persistenceVersion !== expectedVersion) {
      throw new SemanticCodeIntelligenceError(
        "semantic_graph_version_conflict",
        "Semantic graph was modified concurrently.",
      );
    }
    if (!existing && expectedVersion !== null) {
      throw new SemanticCodeIntelligenceError(
        "semantic_graph_version_conflict",
        "Semantic graph publication no longer exists.",
      );
    }
    if (existing && existing.ownerId !== graph.ownerId) {
      throw new SemanticCodeIntelligenceError(
        "semantic_repository_access_denied",
        "Semantic graph ownership cannot change.",
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
          persistenceVersion: candidate.persistenceVersion + 1,
          lifecycle: "superseded",
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
  ): Promise<SemanticGraph | null> {
    const match = [...this.graphs.values()].find((graph) =>
      graph.tenantId === tenantId && graph.ownerId === ownerId &&
      graph.repositoryId === repositoryId &&
      graph.repositoryRevision === repositoryRevision &&
      graph.lifecycle === "published");
    return match ? clone(match) : null;
  }

  async recover(): Promise<number> {
    let recovered = 0;
    for (const [key, graph] of this.graphs) {
      const symbolIds = new Set(graph.symbols.map((item) => item.symbolId));
      const files = new Set(graph.fileAnalyses.map((item) => item.file));
      const symbols = graph.symbols.filter((item) => files.has(item.file));
      const validIds = new Set(symbols.map((item) => item.symbolId));
      const relationships = graph.relationships.filter((edge) =>
        symbolIds.has(edge.fromSymbolId) && symbolIds.has(edge.toSymbolId) &&
        validIds.has(edge.fromSymbolId) && validIds.has(edge.toSymbolId));
      const interrupted = graph.lifecycle === "building" ||
        graph.lifecycle === "validating";
      if (interrupted || symbols.length !== graph.symbols.length ||
          relationships.length !== graph.relationships.length) {
        recovered += 1;
        const timestamp = new Date().toISOString();
        this.graphs.set(key, clone({
          ...graph,
          persistenceVersion: graph.persistenceVersion + 1,
          lifecycle: interrupted ? "failed" : graph.lifecycle,
          symbols,
          relationships,
          diagnostics: [...graph.diagnostics, {
            code: interrupted
              ? "semantic_interrupted_build_recovered"
              : "semantic_stale_graph_entries_removed",
            message: interrupted
              ? "Interrupted semantic graph was fenced from publication."
              : "Stale edges or orphan symbols were removed.",
            severity: "warning",
          }],
          metrics: {
            ...graph.metrics,
            indexedSymbols: symbols.length,
            indexedRelationships: relationships.length,
            recoveryOperations: graph.metrics.recoveryOperations + 1,
          },
          updatedAt: timestamp,
          publishedAt: interrupted ? null : graph.publishedAt,
        }));
      }
    }
    return recovered;
  }

  async metrics(tenantId?: string): Promise<SemanticStoreMetrics> {
    return [...this.graphs.values()]
      .filter((graph) => tenantId === undefined || graph.tenantId === tenantId)
      .reduce((total, graph) => ({
        indexedSymbols: total.indexedSymbols + graph.metrics.indexedSymbols,
        indexedRelationships:
          total.indexedRelationships + graph.metrics.indexedRelationships,
        indexingDurationMs:
          total.indexingDurationMs + graph.metrics.indexingDurationMs,
        graphRebuilds: total.graphRebuilds + graph.metrics.graphRebuilds,
        incrementalUpdates:
          total.incrementalUpdates + graph.metrics.incrementalUpdates,
        recoveryOperations:
          total.recoveryOperations + graph.metrics.recoveryOperations,
      }), zeroMetrics());
  }

  async collect(tenantId: string, retainedVersions: number): Promise<number> {
    const candidates = [...this.graphs.entries()]
      .filter(([, graph]) => graph.tenantId === tenantId &&
        graph.lifecycle !== "published")
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

export class PostgresSemanticCodeIntelligenceStore
implements SemanticCodeIntelligenceStore {
  constructor(private readonly database: Database) {}

  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) {
      throw new SemanticCodeIntelligenceError(
        String(error.message ?? "").includes("version_conflict")
          ? "semantic_graph_version_conflict"
          : "semantic_graph_persistence_failed",
        error.message ?? "Semantic graph persistence failed.",
      );
    }
    return data;
  }

  async save(graph: SemanticGraph, expectedVersion: number | null = null) {
    validateSemanticGraph(graph);
    const data = await this.call("save_semantic_code_graph", {
      input_graph: graph,
      input_expected_version:
        expectedVersion === null ? null : String(expectedVersion),
    });
    return clone((first(data)?.graph ?? data) as SemanticGraph);
  }

  async get(
    tenantId: string, ownerId: string, repositoryId: string, repositoryRevision: string,
  ) {
    const data = await this.call("get_semantic_code_graph", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    });
    const graph = first(data)?.graph ?? data;
    return graph ? clone(graph as SemanticGraph) : null;
  }

  async recover(): Promise<number> {
    const data = await this.call("recover_semantic_code_graphs");
    return Number(first(data)?.recovered_count ?? data ?? 0);
  }

  async metrics(tenantId?: string): Promise<SemanticStoreMetrics> {
    const data = await this.call("semantic_code_graph_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return structuredClone((first(data)?.metrics ?? data) as SemanticStoreMetrics);
  }

  async collect(tenantId: string, retainedVersions: number): Promise<number> {
    const data = await this.call("collect_semantic_code_graphs", {
      input_tenant_id: tenantId,
      input_retained_versions: retainedVersions,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async verify(): Promise<void> {
    const data = await this.call("verify_semantic_code_graph_contract", {
      input_engine_version: SEMANTIC_ENGINE_VERSION,
      input_schema_version: SEMANTIC_SCHEMA_VERSION,
    });
    const result = first(data) ?? {};
    if (result.valid !== true && data !== true) {
      throw new SemanticCodeIntelligenceError(
        "semantic_startup_validation_failed",
        "Semantic code graph database contract is invalid.",
        { problems: result.problems ?? [] },
      );
    }
  }
}

export const runtimeSemanticCodeIntelligenceStore:
SemanticCodeIntelligenceStore =
  new PostgresSemanticCodeIntelligenceStore(supabase as unknown as SupabaseClient);
