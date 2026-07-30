import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  QUERY_ENGINES, QUERY_INTENTS, REPOSITORY_QUERY_ENGINE_VERSION,
  REPOSITORY_QUERY_SCHEMA_VERSION, RepositoryQueryError,
  type QueryEngineName, type QueryIntent, type RepositoryQueryExecution,
  type RepositoryQueryMetrics,
} from "./types.js";
import {
  cloneRepositoryQueryExecution as clone, validateRepositoryQuery,
  validateRepositoryQueryPlan, validateRepositoryQueryResponse,
} from "./validation.js";

export interface RepositoryQueryStore {
  save(execution: RepositoryQueryExecution, expectedVersion?: number | null):
    Promise<RepositoryQueryExecution>;
  get(tenantId: string, userId: string, queryId: string):
    Promise<RepositoryQueryExecution | null>;
  recordCacheHit(tenantId: string, userId: string, queryId: string): Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<RepositoryQueryMetrics>;
  collect(tenantId: string, retainedQueries: number): Promise<number>;
  verify(): Promise<void>;
}

const emptyCount = <T extends string>(values: readonly T[]) =>
  Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
const confidenceBucket = (confidence: number) =>
  confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";

export class MemoryRepositoryQueryStore implements RepositoryQueryStore {
  private readonly records = new Map<string, RepositoryQueryExecution>();
  private readonly cacheHits = new Map<string, number>();
  private recoveryCount = 0;
  private key(tenantId: string, queryId: string) { return `${tenantId}\0${queryId}`; }

  hydrate(execution: RepositoryQueryExecution): void {
    this.records.set(this.key(execution.query.tenantId, execution.query.queryId), clone(execution));
  }

  async save(execution: RepositoryQueryExecution, expectedVersion: number | null = null) {
    validateRepositoryQuery(execution.query);
    validateRepositoryQueryPlan(execution.plan);
    if (execution.response) validateRepositoryQueryResponse(execution.query, execution.response);
    const key = this.key(execution.query.tenantId, execution.query.queryId);
    const existing = this.records.get(key);
    if ((expectedVersion !== null && !existing) ||
        (existing && expectedVersion !== null &&
          existing.query.persistenceVersion !== expectedVersion)) {
      throw new RepositoryQueryError(
        "repository_query_version_conflict", "Repository query was modified concurrently.");
    }
    if (existing && existing.query.userId !== execution.query.userId) {
      throw new RepositoryQueryError(
        "repository_query_access_denied", "Repository query ownership cannot change.");
    }
    const saved = clone({
      ...execution,
      query: {
        ...execution.query,
        persistenceVersion: existing ? existing.query.persistenceVersion + 1 : 1,
      },
    });
    this.records.set(key, saved);
    return clone(saved);
  }

  async get(tenantId: string, userId: string, queryId: string) {
    const found = this.records.get(this.key(tenantId, queryId));
    return found?.query.userId === userId ? clone(found) : null;
  }

  async recordCacheHit(tenantId: string, userId: string, queryId: string) {
    if (!await this.get(tenantId, userId, queryId)) {
      throw new RepositoryQueryError("repository_query_not_found", "Cached query was not found.");
    }
    const key = this.key(tenantId, queryId);
    this.cacheHits.set(key, (this.cacheHits.get(key) ?? 0) + 1);
  }

  async recover() {
    let recovered = 0;
    for (const [key, execution] of this.records) {
      const interrupted = ["planning", "running"].includes(execution.query.lifecycle);
      const stale = execution.response !== null && (
        execution.response.repositoryRevision !== execution.query.repositoryRevision ||
        execution.response.queryId !== execution.query.queryId);
      if (!interrupted && !stale) continue;
      recovered += 1;
      const now = new Date().toISOString();
      this.records.set(key, clone({
        ...execution,
        query: {
          ...execution.query, lifecycle: "failed" as const,
          persistenceVersion: execution.query.persistenceVersion + 1,
          updatedAt: now, completedAt: now,
        },
        response: null,
        diagnostics: [...execution.diagnostics, {
          code: interrupted
            ? "repository_query_interrupted_recovered"
            : "repository_query_stale_cache_recovered",
          message: "Incomplete or revision-stale query output was fenced from reuse.",
          severity: "warning" as const,
        }],
      }));
    }
    this.recoveryCount += recovered;
    return recovered;
  }

  async metrics(tenantId?: string): Promise<RepositoryQueryMetrics> {
    const executions = [...this.records.values()].filter((item) =>
      tenantId === undefined || item.query.tenantId === tenantId);
    const engineUsage = emptyCount(QUERY_ENGINES);
    const intentDistribution = emptyCount(QUERY_INTENTS);
    const confidenceDistribution = { low: 0, medium: 0, high: 0 };
    for (const item of executions) {
      item.engineUsage.forEach((engine) => engineUsage[engine] += 1);
      item.query.intents.forEach((intent) => intentDistribution[intent] += 1);
      confidenceDistribution[confidenceBucket(item.query.confidence)] += 1;
    }
    return {
      queries: executions.length,
      cacheHits: executions.reduce((sum, item) =>
        sum + (this.cacheHits.get(this.key(item.query.tenantId, item.query.queryId)) ?? 0), 0),
      averageLatencyMs: executions.length === 0 ? 0 : Number((
        executions.reduce((sum, item) => sum + item.latencyMs, 0) /
        executions.length).toFixed(3)),
      engineUsage, intentDistribution, confidenceDistribution,
      recoveryCount: this.recoveryCount,
    };
  }

  async collect(tenantId: string, retainedQueries: number) {
    const victims = [...this.records.entries()].filter(([, item]) =>
      item.query.tenantId === tenantId && item.query.lifecycle !== "running")
      .sort(([, a], [, b]) => b.query.updatedAt.localeCompare(a.query.updatedAt))
      .slice(Math.max(1, retainedQueries));
    victims.forEach(([key]) => {
      this.records.delete(key);
      this.cacheHits.delete(key);
    });
    return victims.length;
  }

  async verify(): Promise<void> {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (data: unknown) => Array.isArray(data) ? data[0] : data;

export class PostgresRepositoryQueryStore implements RepositoryQueryStore {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryQueryError(
      error.message?.includes("version_conflict")
        ? "repository_query_version_conflict" : "repository_query_persistence_failed",
      error.message ?? "Repository query persistence failed.");
    return first(data);
  }
  async save(execution: RepositoryQueryExecution, expectedVersion: number | null = null) {
    validateRepositoryQuery(execution.query);
    validateRepositoryQueryPlan(execution.plan);
    if (execution.response) validateRepositoryQueryResponse(execution.query, execution.response);
    const data = await this.call("save_repository_query", {
      input_execution: execution,
      input_expected_version: expectedVersion === null ? null : String(expectedVersion),
    }) as { execution?: RepositoryQueryExecution } | RepositoryQueryExecution;
    return clone(("execution" in data ? data.execution : data) as RepositoryQueryExecution);
  }
  async get(tenantId: string, userId: string, queryId: string) {
    const data = await this.call("get_repository_query", {
      input_tenant_id: tenantId, input_user_id: userId, input_query_id: queryId,
    }) as unknown;
    if (!data) return null;
    const execution = typeof data === "object" && "execution" in data
      ? (data as { execution?: RepositoryQueryExecution | null }).execution
      : data as RepositoryQueryExecution;
    return execution ? clone(execution) : null;
  }
  async recordCacheHit(tenantId: string, userId: string, queryId: string) {
    await this.call("record_repository_query_cache_hit", {
      input_tenant_id: tenantId, input_user_id: userId, input_query_id: queryId,
    });
  }
  async recover() {
    const data = await this.call("recover_repository_queries") as { recovered_count?: number } | number;
    return Number(typeof data === "object" ? data.recovered_count : data);
  }
  async metrics(tenantId?: string) {
    const data = await this.call("repository_query_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as unknown;
    const metrics = typeof data === "object" && data !== null && "metrics" in data
      ? (data as { metrics: RepositoryQueryMetrics }).metrics
      : data as RepositoryQueryMetrics;
    return clone(metrics);
  }
  async collect(tenantId: string, retainedQueries: number) {
    const data = await this.call("collect_repository_queries", {
      input_tenant_id: tenantId, input_retained_queries: retainedQueries,
    }) as { deleted_count?: number } | number;
    return Number(typeof data === "object" ? data.deleted_count : data);
  }
  async verify() {
    const data = await this.call("verify_repository_query_contract", {
      input_engine_version: REPOSITORY_QUERY_ENGINE_VERSION,
      input_schema_version: REPOSITORY_QUERY_SCHEMA_VERSION,
    }) as { valid?: boolean; problems?: unknown };
    if (!data.valid) throw new RepositoryQueryError(
      "repository_query_startup_validation_failed",
      "Repository query database contract is invalid.", { problems: data.problems });
  }
}

export const runtimeRepositoryQueryStore: RepositoryQueryStore =
  env.NODE_ENV === "test"
    ? new MemoryRepositoryQueryStore()
    : new PostgresRepositoryQueryStore(supabase as unknown as SupabaseClient);
