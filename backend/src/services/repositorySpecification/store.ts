import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
  RepositorySpecificationError,
  type RepositoryEngineeringSpecification,
  type RepositorySpecificationMetrics,
} from "./types.js";
import {
  cloneSpecification as clone,
  validateRepositoryEngineeringSpecification,
} from "./validation.js";

export interface RepositorySpecificationStore {
  save(value: RepositoryEngineeringSpecification,
    expectedVersion?: number | null): Promise<RepositoryEngineeringSpecification>;
  get(tenantId: string, ownerId: string, specificationId: string):
    Promise<RepositoryEngineeringSpecification | null>;
  recordCacheHit(tenantId: string, ownerId: string, specificationId: string):
    Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<RepositorySpecificationMetrics>;
  collect(tenantId: string, retainedSpecifications: number): Promise<number>;
  verify(): Promise<void>;
}

export class MemoryRepositorySpecificationStore
implements RepositorySpecificationStore {
  private readonly values = new Map<string, RepositoryEngineeringSpecification>();
  private readonly hits = new Map<string, number>();
  private recovered = 0;
  private key(tenantId: string, specificationId: string) {
    return `${tenantId}\0${specificationId}`;
  }
  hydrate(value: RepositoryEngineeringSpecification) {
    this.values.set(this.key(value.specification.tenantId,
      value.specification.specificationId), clone(value));
  }
  async save(value: RepositoryEngineeringSpecification,
    expectedVersion: number | null = null) {
    validateRepositoryEngineeringSpecification(value);
    const key = this.key(value.specification.tenantId,
      value.specification.specificationId);
    const current = this.values.get(key);
    if ((expectedVersion !== null && !current) ||
        (current && expectedVersion !== null &&
          current.specification.persistenceVersion !== expectedVersion)) {
      throw new RepositorySpecificationError(
        "repository_specification_version_conflict",
        "Specification was modified concurrently.");
    }
    if (current && current.specification.ownerId !==
        value.specification.ownerId) {
      throw new RepositorySpecificationError(
        "repository_specification_access_denied",
        "Specification ownership cannot change.");
    }
    const saved = clone({
      ...value,
      specification: {
        ...value.specification,
        persistenceVersion: current
          ? current.specification.persistenceVersion + 1 : 1,
      },
    });
    this.values.set(key, saved);
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, specificationId: string) {
    const value = this.values.get(this.key(tenantId, specificationId));
    return value && value.specification.ownerId === ownerId &&
      ["published", "partial"].includes(value.specification.lifecycle)
      ? clone(value) : null;
  }
  async recordCacheHit(
    tenantId: string, ownerId: string, specificationId: string,
  ) {
    const key = this.key(tenantId, specificationId);
    const value = this.values.get(key);
    if (!value || value.specification.ownerId !== ownerId ||
        !["published", "partial"].includes(value.specification.lifecycle)) {
      throw new RepositorySpecificationError(
        "repository_specification_not_found",
        "Reusable specification was not found.");
    }
    this.hits.set(key, (this.hits.get(key) ?? 0) + 1);
  }
  async recover() {
    let recovered = 0;
    for (const [key, value] of this.values) {
      const interrupted = value.specification.lifecycle === "generating";
      const partial = ["published", "partial"].includes(
        value.specification.lifecycle) &&
        value.implementationPhases.length !== 7;
      const stale = value.implementationPhases.some(
        (phase) => phase.evidenceReferences.length === 0);
      if (!interrupted && !partial && !stale) continue;
      recovered += 1;
      this.values.set(key, clone({
        ...value,
        specification: {
          ...value.specification,
          lifecycle: "failed",
          persistenceVersion: value.specification.persistenceVersion + 1,
          updatedAt: new Date().toISOString(),
          completedAt: null,
        },
        recoveryCount: value.recoveryCount + 1,
        diagnostics: [...value.diagnostics, {
          code: interrupted
            ? "specification_generation_interrupted_recovered"
            : stale ? "stale_specification_recovered"
              : "partial_specification_recovered",
          message: "Invalid specification state was fenced from reuse.",
          severity: "warning" as const,
        }],
      }));
    }
    this.recovered += recovered;
    return recovered;
  }
  async metrics(tenantId?: string): Promise<RepositorySpecificationMetrics> {
    const values = [...this.values.values()].filter((value) =>
      ["published", "partial"].includes(value.specification.lifecycle) &&
      (tenantId === undefined || value.specification.tenantId === tenantId));
    const cacheHits = values.reduce((sum, value) => sum +
      (this.hits.get(this.key(value.specification.tenantId,
        value.specification.specificationId)) ?? 0), 0);
    return {
      specificationsCreated: values.length,
      cacheHits,
      averageOrchestrationLatencyMs: values.length === 0 ? 0 :
        Number((values.reduce((sum, value) =>
          sum + value.orchestrationLatencyMs, 0) / values.length).toFixed(3)),
      reuseRate: values.length + cacheHits === 0 ? 0 :
        Number((cacheHits / (values.length + cacheHits)).toFixed(6)),
      recoveryCount: this.recovered +
        values.reduce((sum, value) => sum + value.recoveryCount, 0),
    };
  }
  async collect(tenantId: string, retainedSpecifications: number) {
    const victims = [...this.values.entries()].filter(([, value]) =>
      value.specification.tenantId === tenantId &&
      value.specification.lifecycle !== "published")
      .sort(([, left], [, right]) =>
        right.specification.updatedAt.localeCompare(
          left.specification.updatedAt) ||
        right.specification.specificationId.localeCompare(
          left.specification.specificationId))
      .slice(Math.max(1, retainedSpecifications));
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

export class PostgresRepositorySpecificationStore
implements RepositorySpecificationStore {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositorySpecificationError(
      error.message?.includes("version_conflict")
        ? "repository_specification_version_conflict"
        : "repository_specification_persistence_failed",
      error.message ?? "Repository specification persistence failed.");
    return first(data);
  }
  async save(value: RepositoryEngineeringSpecification,
    expectedVersion: number | null = null) {
    validateRepositoryEngineeringSpecification(value);
    const result = await this.call("save_repository_engineering_specification", {
      input_specification: value,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    const saved = typeof result === "object" && result !== null &&
      "specification" in result
      ? (result as { specification: RepositoryEngineeringSpecification })
        .specification
      : result as RepositoryEngineeringSpecification;
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, specificationId: string) {
    const result = await this.call("get_repository_engineering_specification", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_specification_id: specificationId,
    });
    if (!result) return null;
    const value = typeof result === "object" && result !== null &&
      "specification" in result
      ? (result as { specification?: RepositoryEngineeringSpecification })
        .specification
      : result as RepositoryEngineeringSpecification;
    return value ? clone(value) : null;
  }
  async recordCacheHit(
    tenantId: string, ownerId: string, specificationId: string,
  ) {
    await this.call("record_repository_specification_cache_hit", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_specification_id: specificationId,
    });
  }
  async recover() {
    return Number(await this.call(
      "recover_repository_engineering_specifications") ?? 0);
  }
  async metrics(tenantId?: string) {
    return await this.call("repository_specification_engine_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as RepositorySpecificationMetrics;
  }
  async collect(tenantId: string, retainedSpecifications: number) {
    return Number(await this.call(
      "collect_repository_engineering_specifications", {
        input_tenant_id: tenantId,
        input_retained_specifications: retainedSpecifications,
      }) ?? 0);
  }
  async verify() {
    const result = await this.call(
      "verify_repository_specification_engine_contract") as {
        valid?: boolean; schemaVersion?: string; failures?: unknown[];
      };
    if (!result?.valid ||
        result.schemaVersion !== REPOSITORY_SPECIFICATION_SCHEMA_VERSION) {
      throw new RepositorySpecificationError(
        "repository_specification_startup_invalid",
        "Repository specification schema contract is invalid.",
        { failures: result?.failures ?? [] });
    }
  }
}

export const runtimeRepositorySpecificationStore:
RepositorySpecificationStore = env.NODE_ENV === "test"
  ? new MemoryRepositorySpecificationStore()
  : new PostgresRepositorySpecificationStore(
    supabase as unknown as SupabaseClient);
