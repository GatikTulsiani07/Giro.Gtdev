import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  EXECUTION_COORDINATOR_STAGES,
  REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION,
  RepositoryExecutionCoordinatorError,
  type ExecutionCoordinatorStage,
  type ExecutionReadinessStatus,
  type RepositoryCoordinatedExecution,
  type RepositoryExecutionCoordinatorMetrics,
} from "./types.js";
import {
  cloneCoordinatedExecution as clone,
  validateRepositoryCoordinatedExecution,
} from "./validation.js";

export interface RepositoryExecutionCoordinatorStore {
  save(value: RepositoryCoordinatedExecution,
    expectedVersion?: number | null): Promise<RepositoryCoordinatedExecution>;
  get(tenantId: string, ownerId: string, executionId: string):
    Promise<RepositoryCoordinatedExecution | null>;
  recordCacheHit(tenantId: string, ownerId: string, executionId: string):
    Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<RepositoryExecutionCoordinatorMetrics>;
  collect(tenantId: string, retainedExecutions: number): Promise<number>;
  verify(): Promise<void>;
}

function emptyStageDurations(): Record<ExecutionCoordinatorStage, number> {
  return Object.fromEntries(EXECUTION_COORDINATOR_STAGES.map(
    (stage) => [stage, 0])) as Record<ExecutionCoordinatorStage, number>;
}

function emptyReadinessOutcomes(): Record<ExecutionReadinessStatus, number> {
  return { ready: 0, partial: 0, not_ready: 0 };
}

export class MemoryRepositoryExecutionCoordinatorStore
implements RepositoryExecutionCoordinatorStore {
  private readonly values = new Map<string, RepositoryCoordinatedExecution>();
  private readonly hits = new Map<string, number>();
  private key(tenantId: string, executionId: string) {
    return `${tenantId}\0${executionId}`;
  }
  hydrate(value: RepositoryCoordinatedExecution) {
    this.values.set(this.key(
      value.execution.tenantId, value.execution.executionId), clone(value));
  }
  async save(value: RepositoryCoordinatedExecution,
    expectedVersion: number | null = null) {
    validateRepositoryCoordinatedExecution(value);
    const key = this.key(
      value.execution.tenantId, value.execution.executionId);
    const current = this.values.get(key);
    if ((expectedVersion !== null && !current) ||
        (current && expectedVersion !== null &&
          current.execution.persistenceVersion !== expectedVersion)) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordination_version_conflict",
        "Coordinated execution was modified concurrently.");
    }
    if (current && (current.execution.ownerId !== value.execution.ownerId ||
        current.execution.repositoryId !== value.execution.repositoryId ||
        current.execution.taskId !== value.execution.taskId ||
        current.execution.specificationId !==
          value.execution.specificationId)) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordination_identity_conflict",
        "Coordinated execution identity cannot change.");
    }
    const saved = clone({
      ...value,
      execution: {
        ...value.execution,
        persistenceVersion: current
          ? current.execution.persistenceVersion + 1 : 1,
      },
    });
    this.values.set(key, saved);
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, executionId: string) {
    const value = this.values.get(this.key(tenantId, executionId));
    return value && value.execution.ownerId === ownerId &&
      value.execution.status === "completed" ? clone(value) : null;
  }
  async recordCacheHit(
    tenantId: string, ownerId: string, executionId: string,
  ) {
    const key = this.key(tenantId, executionId);
    const value = this.values.get(key);
    if (!value || value.execution.ownerId !== ownerId ||
        value.execution.status !== "completed") {
      throw new RepositoryExecutionCoordinatorError(
        "repository_coordinated_execution_not_found",
        "Reusable coordinated execution was not found.");
    }
    this.hits.set(key, (this.hits.get(key) ?? 0) + 1);
  }
  async recover() {
    let recovered = 0;
    for (const [key, value] of this.values) {
      const interrupted = value.execution.status === "coordinating";
      const partial = value.execution.status === "partial";
      const malformed = value.execution.status === "completed" &&
        (value.stageHistory.length !== EXECUTION_COORDINATOR_STAGES.length ||
          value.readiness?.status !== "ready");
      if (!interrupted && !partial && !malformed) continue;
      recovered += 1;
      const now = new Date().toISOString();
      this.values.set(key, clone({
        ...value,
        execution: {
          ...value.execution,
          status: malformed ? "stale" : "failed",
          persistenceVersion: value.execution.persistenceVersion + 1,
          updatedAt: now,
          completedAt: null,
        },
        diagnostics: [...value.diagnostics, {
          code: interrupted
            ? "execution_coordination_interrupted_recovered"
            : partial
              ? "execution_coordination_partial_failure_recovered"
              : "execution_coordination_stale_recovered",
          message: "Invalid execution coordination state was fenced from reuse.",
          severity: "warning" as const,
        }],
        recoveryCount: value.recoveryCount + 1,
      }));
    }
    return recovered;
  }
  async metrics(tenantId?: string):
  Promise<RepositoryExecutionCoordinatorMetrics> {
    const values = [...this.values.values()].filter((value) =>
      tenantId === undefined || value.execution.tenantId === tenantId);
    const stageDurations = emptyStageDurations();
    for (const stage of EXECUTION_COORDINATOR_STAGES) {
      const transitions = values.flatMap((value) =>
        value.stageHistory.filter((item) => item.stage === stage));
      stageDurations[stage] = transitions.length === 0 ? 0 : Number((
        transitions.reduce((sum, item) => sum + item.durationMs, 0) /
          transitions.length).toFixed(3));
    }
    const readinessOutcomes = emptyReadinessOutcomes();
    for (const value of values) {
      if (value.readiness) readinessOutcomes[value.readiness.status] += 1;
    }
    const cacheHits = values.reduce((sum, value) => sum +
      (this.hits.get(this.key(value.execution.tenantId,
        value.execution.executionId)) ?? 0), 0);
    return {
      executions: values.length,
      stageDurations,
      cacheHits,
      averageOrchestrationLatencyMs: values.length === 0 ? 0 : Number((
        values.reduce((sum, value) =>
          sum + value.orchestrationLatencyMs, 0) / values.length).toFixed(3)),
      recoveryCount: values.reduce(
        (sum, value) => sum + value.recoveryCount, 0),
      readinessOutcomes,
    };
  }
  async collect(tenantId: string, retainedExecutions: number) {
    const victims = [...this.values.entries()].filter(([, value]) =>
      value.execution.tenantId === tenantId &&
      value.execution.status !== "completed")
      .sort(([, left], [, right]) =>
        right.execution.updatedAt.localeCompare(left.execution.updatedAt) ||
        right.execution.executionId.localeCompare(
          left.execution.executionId))
      .slice(Math.max(1, retainedExecutions));
    for (const [key] of victims) {
      this.values.delete(key);
      this.hits.delete(key);
    }
    return victims.length;
  }
  async verify() {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryExecutionCoordinatorStore
implements RepositoryExecutionCoordinatorStore {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryExecutionCoordinatorError(
      error.message?.includes("version_conflict")
        ? "repository_execution_coordination_version_conflict"
        : "repository_execution_coordination_persistence_failed",
      error.message ??
        "Repository execution coordination persistence failed.");
    return first(data);
  }
  async save(value: RepositoryCoordinatedExecution,
    expectedVersion: number | null = null) {
    validateRepositoryCoordinatedExecution(value);
    const result = await this.call("save_repository_coordinated_execution", {
      input_execution: value,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    const saved = typeof result === "object" && result !== null &&
      "execution" in result
      ? (result as { execution: RepositoryCoordinatedExecution }).execution
      : result as RepositoryCoordinatedExecution;
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, executionId: string) {
    const result = await this.call("get_repository_coordinated_execution", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_execution_id: executionId,
    });
    if (!result) return null;
    const value = typeof result === "object" && result !== null &&
      "execution" in result
      ? (result as { execution?: RepositoryCoordinatedExecution }).execution
      : result as RepositoryCoordinatedExecution;
    return value ? clone(value) : null;
  }
  async recordCacheHit(
    tenantId: string, ownerId: string, executionId: string,
  ) {
    await this.call("record_repository_execution_coordination_cache_hit", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_execution_id: executionId,
    });
  }
  async recover() {
    return Number(await this.call(
      "recover_repository_coordinated_executions") ?? 0);
  }
  async metrics(tenantId?: string) {
    return await this.call("repository_execution_coordinator_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as RepositoryExecutionCoordinatorMetrics;
  }
  async collect(tenantId: string, retainedExecutions: number) {
    return Number(await this.call(
      "collect_repository_coordinated_executions", {
        input_tenant_id: tenantId,
        input_retained_executions: retainedExecutions,
      }) ?? 0);
  }
  async verify() {
    const result = await this.call(
      "verify_repository_execution_coordinator_contract") as {
        valid?: boolean; schemaVersion?: string; failures?: unknown[];
      };
    if (!result?.valid ||
        result.schemaVersion !==
          REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordinator_startup_invalid",
        "Repository execution coordinator schema contract is invalid.",
        { failures: result?.failures ?? [] });
    }
  }
}

export const runtimeRepositoryExecutionCoordinatorStore:
RepositoryExecutionCoordinatorStore = env.NODE_ENV === "test"
  ? new MemoryRepositoryExecutionCoordinatorStore()
  : new PostgresRepositoryExecutionCoordinatorStore(
    supabase as unknown as SupabaseClient);
