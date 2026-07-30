import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  REPOSITORY_TASK_PLAN_SCHEMA_VERSION, RepositoryTaskPlannerError,
  type RepositoryTaskPlan, type RepositoryTaskPlannerMetrics,
} from "./types.js";
import { cloneTaskPlan as clone, validateRepositoryTaskPlan } from "./validation.js";

export interface RepositoryTaskPlannerStore {
  save(plan: RepositoryTaskPlan, expectedVersion?: number | null):
    Promise<RepositoryTaskPlan>;
  get(tenantId: string, ownerId: string, taskId: string):
    Promise<RepositoryTaskPlan | null>;
  recordCacheHit(tenantId: string, ownerId: string, taskId: string):
    Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<RepositoryTaskPlannerMetrics>;
  collect(tenantId: string, retainedPlans: number): Promise<number>;
  verify(): Promise<void>;
}

export class MemoryRepositoryTaskPlannerStore
implements RepositoryTaskPlannerStore {
  private readonly plans = new Map<string, RepositoryTaskPlan>();
  private readonly cacheHits = new Map<string, number>();
  private recovered = 0;
  private key(tenantId: string, taskId: string) {
    return `${tenantId}\0${taskId}`;
  }
  hydrate(plan: RepositoryTaskPlan) {
    this.plans.set(this.key(plan.task.tenantId, plan.task.taskId), clone(plan));
  }
  async save(plan: RepositoryTaskPlan, expectedVersion: number | null = null) {
    validateRepositoryTaskPlan(plan);
    const key = this.key(plan.task.tenantId, plan.task.taskId);
    const current = this.plans.get(key);
    if ((expectedVersion !== null && !current) ||
        (current && expectedVersion !== null &&
          current.task.persistenceVersion !== expectedVersion)) {
      throw new RepositoryTaskPlannerError(
        "repository_task_plan_version_conflict",
        "Task plan was modified concurrently.");
    }
    if (current && current.task.ownerId !== plan.task.ownerId) {
      throw new RepositoryTaskPlannerError(
        "repository_task_planner_access_denied",
        "Task plan ownership cannot change.");
    }
    const saved = clone({
      ...plan,
      task: {
        ...plan.task,
        persistenceVersion: current
          ? current.task.persistenceVersion + 1 : 1,
      },
    });
    this.plans.set(key, saved);
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, taskId: string) {
    const plan = this.plans.get(this.key(tenantId, taskId));
    return plan && plan.task.ownerId === ownerId &&
      ["published", "partial"].includes(plan.task.lifecycle)
      ? clone(plan) : null;
  }
  async recordCacheHit(
    tenantId: string, ownerId: string, taskId: string,
  ) {
    const key = this.key(tenantId, taskId);
    const plan = this.plans.get(key);
    if (!plan || plan.task.ownerId !== ownerId ||
        !["published", "partial"].includes(plan.task.lifecycle)) {
      throw new RepositoryTaskPlannerError(
        "repository_task_plan_not_found", "Reusable task plan was not found.");
    }
    this.cacheHits.set(key, (this.cacheHits.get(key) ?? 0) + 1);
  }
  async recover() {
    let count = 0;
    for (const [key, plan] of this.plans) {
      const interrupted = plan.task.lifecycle === "planning";
      const stale = plan.phases.some((item) =>
        item.evidenceReferences.length === 0);
      const orphan = ["published", "partial"].includes(plan.task.lifecycle) &&
        plan.phases.length !== 7;
      if (!interrupted && !stale && !orphan) continue;
      count += 1;
      this.plans.set(key, clone({
        ...plan,
        task: {
          ...plan.task, lifecycle: "failed",
          persistenceVersion: plan.task.persistenceVersion + 1,
          updatedAt: new Date().toISOString(), completedAt: null,
        },
        recoveryCount: plan.recoveryCount + 1,
        diagnostics: [...plan.diagnostics, {
          code: interrupted ? "task_planning_interrupted_recovered" :
            stale ? "task_plan_stale_recovered" :
              "task_plan_orphan_recovered",
          message: "Invalid task planning state was fenced from reuse.",
          severity: "warning" as const,
        }],
      }));
    }
    this.recovered += count;
    return count;
  }
  async metrics(tenantId?: string): Promise<RepositoryTaskPlannerMetrics> {
    const plans = [...this.plans.values()].filter((item) =>
      ["published", "partial"].includes(item.task.lifecycle) &&
      (tenantId === undefined || item.task.tenantId === tenantId));
    const hits = plans.reduce((sum, item) =>
      sum + (this.cacheHits.get(this.key(
        item.task.tenantId, item.task.taskId)) ?? 0), 0);
    return {
      plansCreated: plans.length, cacheHits: hits,
      averageOrchestrationLatencyMs: plans.length === 0 ? 0 : Number((
        plans.reduce((sum, item) =>
          sum + item.orchestrationLatencyMs, 0) / plans.length).toFixed(3)),
      averageAccuracyInputs: plans.length === 0 ? 0 : Number((
        plans.reduce((sum, item) =>
          sum + item.accuracyInputCount, 0) / plans.length).toFixed(3)),
      recoveryCount: this.recovered +
        plans.reduce((sum, item) => sum + item.recoveryCount, 0),
    };
  }
  async collect(tenantId: string, retainedPlans: number) {
    const victims = [...this.plans.entries()].filter(([, item]) =>
      item.task.tenantId === tenantId &&
      item.task.lifecycle !== "published")
      .sort(([, a], [, b]) =>
        b.task.updatedAt.localeCompare(a.task.updatedAt) ||
        b.task.taskId.localeCompare(a.task.taskId))
      .slice(Math.max(1, retainedPlans));
    for (const [key] of victims) {
      this.plans.delete(key);
      this.cacheHits.delete(key);
    }
    return victims.length;
  }
  async verify() {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryTaskPlannerStore
implements RepositoryTaskPlannerStore {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryTaskPlannerError(
      error.message?.includes("version_conflict")
        ? "repository_task_plan_version_conflict"
        : "repository_task_planner_persistence_failed",
      error.message ?? "Repository task planner persistence failed.");
    return first(data);
  }
  async save(plan: RepositoryTaskPlan, expectedVersion: number | null = null) {
    validateRepositoryTaskPlan(plan);
    const value = await this.call("save_repository_task_plan", {
      input_plan: plan,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    const saved = typeof value === "object" && value !== null &&
      "plan" in value ? (value as { plan: RepositoryTaskPlan }).plan :
      value as RepositoryTaskPlan;
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, taskId: string) {
    const value = await this.call("get_repository_task_plan", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_task_id: taskId,
    });
    if (!value) return null;
    const plan = typeof value === "object" && value !== null &&
      "plan" in value
      ? (value as { plan?: RepositoryTaskPlan | null }).plan
      : value as RepositoryTaskPlan;
    return plan ? clone(plan) : null;
  }
  async recordCacheHit(
    tenantId: string, ownerId: string, taskId: string,
  ) {
    await this.call("record_repository_task_plan_cache_hit", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_task_id: taskId,
    });
  }
  async recover() {
    return Number(await this.call("recover_repository_task_plans") ?? 0);
  }
  async metrics(tenantId?: string) {
    return await this.call("repository_task_planner_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as RepositoryTaskPlannerMetrics;
  }
  async collect(tenantId: string, retainedPlans: number) {
    return Number(await this.call("collect_repository_task_plans", {
      input_tenant_id: tenantId,
      input_retained_plans: retainedPlans,
    }) ?? 0);
  }
  async verify() {
    const value = await this.call("verify_repository_task_planner_contract");
    const result = value as {
      valid?: boolean; schemaVersion?: string; failures?: unknown[];
    };
    if (!result?.valid ||
        result.schemaVersion !== REPOSITORY_TASK_PLAN_SCHEMA_VERSION) {
      throw new RepositoryTaskPlannerError(
        "repository_task_planner_startup_invalid",
        "Repository task planner schema contract is invalid.",
        { failures: result?.failures ?? [] });
    }
  }
}

export const runtimeRepositoryTaskPlannerStore: RepositoryTaskPlannerStore =
  env.NODE_ENV === "test"
    ? new MemoryRepositoryTaskPlannerStore()
    : new PostgresRepositoryTaskPlannerStore(
      supabase as unknown as SupabaseClient);
