import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  INSIGHT_TYPES, REPOSITORY_INSIGHT_ENGINE_VERSION,
  REPOSITORY_INSIGHT_SCHEMA_VERSION, RepositoryInsightError,
  type InsightSeverity, type RepositoryInsightGeneration,
  type RepositoryInsightMetrics,
} from "./types.js";
import { cloneInsight as clone, validateInsightGeneration } from "./validation.js";

export interface RepositoryInsightStore {
  save(generation: RepositoryInsightGeneration, expectedVersion?: number | null):
    Promise<RepositoryInsightGeneration>;
  getCurrent(
    tenantId: string, ownerId: string, repositoryId: string,
    repositoryRevision: string,
  ): Promise<RepositoryInsightGeneration | null>;
  recordReuse(
    tenantId: string, ownerId: string, generationId: string, count: number,
  ): Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<RepositoryInsightMetrics>;
  collect(tenantId: string, retainedGenerations: number): Promise<number>;
  verify(): Promise<void>;
}

const counts = <T extends string>(keys: readonly T[]) =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
const severities: readonly InsightSeverity[] =
  ["info", "low", "medium", "high", "critical"];

export class MemoryRepositoryInsightStore implements RepositoryInsightStore {
  private readonly generations = new Map<string, RepositoryInsightGeneration>();
  private readonly reuse = new Map<string, number>();
  private recoveryCount = 0;
  private key(tenantId: string, generationId: string) {
    return `${tenantId}\0${generationId}`;
  }
  hydrate(generation: RepositoryInsightGeneration) {
    this.generations.set(
      this.key(generation.tenantId, generation.generationId), clone(generation));
  }
  async save(generation: RepositoryInsightGeneration, expectedVersion: number | null = null) {
    validateInsightGeneration(generation);
    const key = this.key(generation.tenantId, generation.generationId);
    const existing = this.generations.get(key);
    if ((expectedVersion !== null && !existing) ||
        (existing && expectedVersion !== null &&
          existing.persistenceVersion !== expectedVersion)) {
      throw new RepositoryInsightError(
        "repository_insight_version_conflict",
        "Repository insight generation was modified concurrently.");
    }
    if (existing && existing.ownerId !== generation.ownerId) {
      throw new RepositoryInsightError(
        "repository_insight_access_denied",
        "Repository insight ownership cannot change.");
    }
    for (const [candidateKey, candidate] of this.generations) {
      if (candidate.tenantId === generation.tenantId &&
          candidate.ownerId === generation.ownerId &&
          candidate.repositoryId === generation.repositoryId &&
          generation.lifecycle === "published" &&
          candidate.lifecycle === "published" &&
          candidate.generationId !== generation.generationId) {
        this.generations.set(candidateKey, clone({
          ...candidate, lifecycle: "superseded",
          persistenceVersion: candidate.persistenceVersion + 1,
          updatedAt: generation.updatedAt,
        }));
      }
    }
    const saved = clone({
      ...generation,
      persistenceVersion: existing ? existing.persistenceVersion + 1 : 1,
    });
    this.generations.set(key, saved);
    return clone(saved);
  }
  async getCurrent(
    tenantId: string, ownerId: string, repositoryId: string,
    repositoryRevision: string,
  ) {
    const generation = [...this.generations.values()].find((item) =>
      item.tenantId === tenantId && item.ownerId === ownerId &&
      item.repositoryId === repositoryId &&
      item.repositoryRevision === repositoryRevision &&
      item.lifecycle === "published");
    return generation ? clone(generation) : null;
  }
  async recordReuse(
    tenantId: string, ownerId: string, generationId: string, count: number,
  ) {
    const key = this.key(tenantId, generationId);
    const generation = this.generations.get(key);
    if (!generation || generation.ownerId !== ownerId ||
        generation.lifecycle !== "published") {
      throw new RepositoryInsightError(
        "repository_insight_not_found", "Reusable insight generation was not found.");
    }
    this.reuse.set(key, (this.reuse.get(key) ?? 0) + Math.max(0, count));
  }
  async recover() {
    let count = 0;
    for (const [key, generation] of this.generations) {
      const interrupted = generation.lifecycle === "generating";
      const orphan = generation.insights.some((insight) =>
        insight.supportingEvidence.length === 0);
      const stale = generation.insights.some((insight) =>
        insight.repositoryRevision !== generation.repositoryRevision);
      if (!interrupted && !orphan && !stale) continue;
      count += 1;
      const updatedAt = new Date().toISOString();
      this.generations.set(key, clone({
        ...generation, lifecycle: "failed",
        persistenceVersion: generation.persistenceVersion + 1,
        publishedAt: null, updatedAt,
        recoveryCount: generation.recoveryCount + 1,
        diagnostics: [...generation.diagnostics, {
          code: interrupted ? "repository_insight_interrupted_recovered"
            : orphan ? "repository_insight_orphan_recovered"
            : "repository_insight_stale_recovered",
          message: "Invalid or incomplete insight generation was fenced from publication.",
          severity: "warning",
        }],
      }));
    }
    this.recoveryCount += count;
    return count;
  }
  async metrics(tenantId?: string): Promise<RepositoryInsightMetrics> {
    const current = [...this.generations.values()].filter((item) =>
      item.lifecycle === "published" &&
      (tenantId === undefined || item.tenantId === tenantId));
    const insightCategories = counts(INSIGHT_TYPES);
    const severityDistribution = counts(severities);
    for (const generation of current) for (const insight of generation.insights) {
      insightCategories[insight.type] += 1;
      severityDistribution[insight.severity] += 1;
    }
    return {
      insightsGenerated: current.reduce((sum, item) =>
        sum + item.insights.length, 0),
      insightCategories, severityDistribution,
      averageGenerationLatencyMs: current.length === 0 ? 0 : Number((
        current.reduce((sum, item) => sum + item.generationLatencyMs, 0) /
        current.length).toFixed(3)),
      incrementalReuse: current.reduce((sum, item) =>
        sum + item.reusedCount +
        (this.reuse.get(this.key(item.tenantId, item.generationId)) ?? 0), 0),
      recoveryCount: this.recoveryCount +
        current.reduce((sum, item) => sum + item.recoveryCount, 0),
    };
  }
  async collect(tenantId: string, retainedGenerations: number) {
    const victims = [...this.generations.entries()].filter(([, item]) =>
      item.tenantId === tenantId && item.lifecycle !== "published")
      .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt) ||
        b.generationId.localeCompare(a.generationId))
      .slice(Math.max(1, retainedGenerations));
    victims.forEach(([key]) => {
      this.generations.delete(key);
      this.reuse.delete(key);
    });
    return victims.length;
  }
  async verify(): Promise<void> {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryInsightStore implements RepositoryInsightStore {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryInsightError(
      error.message?.includes("version_conflict")
        ? "repository_insight_version_conflict"
        : "repository_insight_persistence_failed",
      error.message ?? "Repository insight persistence failed.");
    return first(data);
  }
  async save(generation: RepositoryInsightGeneration, expectedVersion: number | null = null) {
    validateInsightGeneration(generation);
    const data = await this.call("save_repository_insight_generation", {
      input_generation: generation,
      input_expected_version: expectedVersion === null ? null : String(expectedVersion),
    }) as unknown;
    const saved = typeof data === "object" && data !== null && "generation" in data
      ? (data as { generation: RepositoryInsightGeneration }).generation
      : data as RepositoryInsightGeneration;
    return clone(saved);
  }
  async getCurrent(
    tenantId: string, ownerId: string, repositoryId: string,
    repositoryRevision: string,
  ) {
    const data = await this.call("get_repository_insight_generation", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    }) as unknown;
    if (!data) return null;
    const generation = typeof data === "object" && "generation" in data
      ? (data as { generation?: RepositoryInsightGeneration | null }).generation
      : data as RepositoryInsightGeneration;
    return generation ? clone(generation) : null;
  }
  async recordReuse(
    tenantId: string, ownerId: string, generationId: string, count: number,
  ) {
    await this.call("record_repository_insight_reuse", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_generation_id: generationId, input_reused_count: count,
    });
  }
  async recover() {
    const data = await this.call("recover_repository_insight_generations") as
      { recovered_count?: number } | number;
    return Number(typeof data === "object" ? data.recovered_count : data);
  }
  async metrics(tenantId?: string) {
    const data = await this.call("repository_insight_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as unknown;
    return clone(typeof data === "object" && data !== null && "metrics" in data
      ? (data as { metrics: RepositoryInsightMetrics }).metrics
      : data as RepositoryInsightMetrics);
  }
  async collect(tenantId: string, retainedGenerations: number) {
    const data = await this.call("collect_repository_insight_generations", {
      input_tenant_id: tenantId,
      input_retained_generations: retainedGenerations,
    }) as { deleted_count?: number } | number;
    return Number(typeof data === "object" ? data.deleted_count : data);
  }
  async verify() {
    const data = await this.call("verify_repository_insight_contract", {
      input_engine_version: REPOSITORY_INSIGHT_ENGINE_VERSION,
      input_schema_version: REPOSITORY_INSIGHT_SCHEMA_VERSION,
    }) as { valid?: boolean; problems?: unknown };
    if (!data.valid) throw new RepositoryInsightError(
      "repository_insight_startup_validation_failed",
      "Repository insight database contract is invalid.",
      { problems: data.problems });
  }
}

export const runtimeRepositoryInsightStore: RepositoryInsightStore =
  env.NODE_ENV === "test"
    ? new MemoryRepositoryInsightStore()
    : new PostgresRepositoryInsightStore(
      supabase as unknown as SupabaseClient);
