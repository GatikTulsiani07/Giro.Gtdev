import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  REPOSITORY_EVOLUTION_ENGINE_VERSION,
  REPOSITORY_EVOLUTION_SCHEMA_VERSION,
  RepositoryEvolutionError,
  type RepositoryEvolutionMetrics, type RepositoryEvolutionRecord,
} from "./types.js";
import {
  cloneEvolution as clone, validateEvolutionRecord,
} from "./validation.js";

export interface RepositoryEvolutionStore {
  save(record: RepositoryEvolutionRecord, expectedVersion?: number | null):
    Promise<RepositoryEvolutionRecord>;
  get(
    tenantId: string, ownerId: string, repositoryId: string,
    baseRevision: string, targetRevision: string,
  ): Promise<RepositoryEvolutionRecord | null>;
  list(
    tenantId: string, ownerId: string, repositoryId: string,
  ): Promise<readonly RepositoryEvolutionRecord[]>;
  recordReuse(
    tenantId: string, ownerId: string, evolutionId: string,
  ): Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<RepositoryEvolutionMetrics>;
  collect(tenantId: string, retainedRecords: number): Promise<number>;
  verify(): Promise<void>;
}

function hasChanges(record: RepositoryEvolutionRecord) {
  const comparison = record.comparison;
  return comparison.features.added.length +
    comparison.features.removed.length +
    comparison.features.modified.length +
    comparison.architecture.newModules.length +
    comparison.architecture.removedModules.length +
    comparison.architecture.couplingChanges.length +
    comparison.architecture.hotspotChanges.length +
    comparison.dependencies.added.length +
    comparison.dependencies.removed.length +
    comparison.semantic.symbolAdditions.length +
    comparison.semantic.symbolRemovals.length +
    comparison.semantic.interfaceChanges.length +
    comparison.semantic.inheritanceChanges.length +
    comparison.semantic.implementationChanges.length +
    comparison.semantic.apiEvolution.length > 0;
}

export class MemoryRepositoryEvolutionStore
implements RepositoryEvolutionStore {
  private readonly records = new Map<string, RepositoryEvolutionRecord>();
  private readonly reuse = new Map<string, number>();
  private recovered = 0;
  private key(tenantId: string, evolutionId: string) {
    return `${tenantId}\0${evolutionId}`;
  }
  hydrate(record: RepositoryEvolutionRecord) {
    this.records.set(this.key(record.tenantId, record.evolutionId),
      clone(record));
  }
  async save(record: RepositoryEvolutionRecord, expectedVersion: number | null = null) {
    validateEvolutionRecord(record);
    const key = this.key(record.tenantId, record.evolutionId);
    const current = this.records.get(key);
    if ((expectedVersion !== null && !current) ||
        (current && expectedVersion !== null &&
          current.persistenceVersion !== expectedVersion)) {
      throw new RepositoryEvolutionError(
        "repository_evolution_version_conflict",
        "Evolution record was modified concurrently.");
    }
    if (current && current.ownerId !== record.ownerId) {
      throw new RepositoryEvolutionError(
        "repository_evolution_access_denied",
        "Evolution record ownership cannot change.");
    }
    const saved = clone({
      ...record,
      persistenceVersion: current ? current.persistenceVersion + 1 : 1,
    });
    this.records.set(key, saved);
    return clone(saved);
  }
  async get(
    tenantId: string, ownerId: string, repositoryId: string,
    baseRevision: string, targetRevision: string,
  ) {
    const record = [...this.records.values()].find((item) =>
      item.tenantId === tenantId && item.ownerId === ownerId &&
      item.repositoryId === repositoryId &&
      item.baseRevision === baseRevision &&
      item.targetRevision === targetRevision &&
      item.lifecycle === "published");
    return record ? clone(record) : null;
  }
  async list(tenantId: string, ownerId: string, repositoryId: string) {
    return [...this.records.values()].filter((item) =>
      item.tenantId === tenantId && item.ownerId === ownerId &&
      item.repositoryId === repositoryId &&
      item.lifecycle === "published")
      .sort((a, b) =>
        b.comparisonTimestamp.localeCompare(a.comparisonTimestamp) ||
        a.evolutionId.localeCompare(b.evolutionId))
      .map(clone);
  }
  async recordReuse(
    tenantId: string, ownerId: string, evolutionId: string,
  ) {
    const key = this.key(tenantId, evolutionId);
    const record = this.records.get(key);
    if (!record || record.ownerId !== ownerId ||
        record.lifecycle !== "published") {
      throw new RepositoryEvolutionError(
        "repository_evolution_not_found",
        "Reusable evolution comparison was not found.");
    }
    this.reuse.set(key, (this.reuse.get(key) ?? 0) + 1);
  }
  async recover() {
    let recovered = 0;
    for (const [key, record] of this.records) {
      const interrupted = record.lifecycle === "comparing";
      const stale = record.timelines.some((item) =>
        item.baseRevision !== record.baseRevision ||
        item.targetRevision !== record.targetRevision);
      const orphan = hasChanges(record) && record.timelines.length === 0;
      if (!interrupted && !stale && !orphan) continue;
      recovered += 1;
      this.records.set(key, clone({
        ...record, lifecycle: "failed",
        persistenceVersion: record.persistenceVersion + 1,
        recoveryCount: record.recoveryCount + 1,
        publishedAt: null, updatedAt: new Date().toISOString(),
        diagnostics: [...record.diagnostics, {
          code: interrupted ? "evolution_interrupted_recovered" :
            stale ? "evolution_stale_recovered" :
              "evolution_orphan_history_recovered",
          message: "Invalid evolution comparison was fenced from publication.",
          severity: "warning" as const,
        }],
      }));
    }
    this.recovered += recovered;
    return recovered;
  }
  async metrics(tenantId?: string): Promise<RepositoryEvolutionMetrics> {
    const records = [...this.records.values()].filter((item) =>
      item.lifecycle === "published" &&
      (tenantId === undefined || item.tenantId === tenantId));
    const reuse = records.reduce((sum, item) =>
      sum + item.reusedCount +
      (this.reuse.get(this.key(item.tenantId, item.evolutionId)) ?? 0), 0);
    return {
      comparisons: records.length,
      timelines: records.reduce((sum, item) =>
        sum + item.timelines.length, 0),
      trends: records.reduce((sum, item) => sum + item.trends.length, 0),
      reuseRate: records.length + reuse === 0 ? 0 :
        Number((reuse / (records.length + reuse)).toFixed(3)),
      recoveryCount: this.recovered +
        records.reduce((sum, item) => sum + item.recoveryCount, 0),
      averageComparisonLatencyMs: records.length === 0 ? 0 : Number((
        records.reduce((sum, item) => sum + item.comparisonLatencyMs, 0) /
          records.length).toFixed(3)),
    };
  }
  async collect(tenantId: string, retainedRecords: number) {
    const victims = [...this.records.entries()].filter(([, item]) =>
      item.tenantId === tenantId && item.lifecycle !== "published")
      .sort(([, a], [, b]) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.evolutionId.localeCompare(a.evolutionId))
      .slice(Math.max(1, retainedRecords));
    for (const [key] of victims) {
      this.records.delete(key);
      this.reuse.delete(key);
    }
    return victims.length;
  }
  async verify() {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryEvolutionStore
implements RepositoryEvolutionStore {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryEvolutionError(
      error.message?.includes("version_conflict")
        ? "repository_evolution_version_conflict"
        : "repository_evolution_persistence_failed",
      error.message ?? "Repository evolution persistence failed.");
    return first(data);
  }
  async save(record: RepositoryEvolutionRecord, expectedVersion: number | null = null) {
    validateEvolutionRecord(record);
    const data = await this.call("save_repository_evolution_record", {
      input_record: record,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    }) as unknown;
    const saved = typeof data === "object" && data !== null && "record" in data
      ? (data as { record: RepositoryEvolutionRecord }).record
      : data as RepositoryEvolutionRecord;
    return clone(saved);
  }
  async get(
    tenantId: string, ownerId: string, repositoryId: string,
    baseRevision: string, targetRevision: string,
  ) {
    const data = await this.call("get_repository_evolution_record", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_base_revision: baseRevision,
      input_target_revision: targetRevision,
    }) as unknown;
    if (!data) return null;
    const record = typeof data === "object" && "record" in data
      ? (data as { record?: RepositoryEvolutionRecord | null }).record
      : data as RepositoryEvolutionRecord;
    return record ? clone(record) : null;
  }
  async list(tenantId: string, ownerId: string, repositoryId: string) {
    const { data, error } = await this.database.rpc(
      "list_repository_evolution_records", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_repository_id: repositoryId,
    });
    if (error) throw new RepositoryEvolutionError(
      "repository_evolution_persistence_failed",
      error.message ?? "Repository evolution history is unavailable.");
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map((row) => clone(
      typeof row === "object" && row !== null && "record" in row
        ? (row as { record: RepositoryEvolutionRecord }).record
        : row as RepositoryEvolutionRecord));
  }
  async recordReuse(
    tenantId: string, ownerId: string, evolutionId: string,
  ) {
    await this.call("record_repository_evolution_reuse", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_evolution_id: evolutionId,
    });
  }
  async recover() {
    const data = await this.call("recover_repository_evolution_records") as
      { recovered_count?: number } | number;
    return Number(typeof data === "object" ? data.recovered_count : data);
  }
  async metrics(tenantId?: string) {
    const data = await this.call("repository_evolution_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as unknown;
    return clone(typeof data === "object" && data !== null && "metrics" in data
      ? (data as { metrics: RepositoryEvolutionMetrics }).metrics
      : data as RepositoryEvolutionMetrics);
  }
  async collect(tenantId: string, retainedRecords: number) {
    const data = await this.call("collect_repository_evolution_records", {
      input_tenant_id: tenantId,
      input_retained_records: retainedRecords,
    }) as { deleted_count?: number } | number;
    return Number(typeof data === "object" ? data.deleted_count : data);
  }
  async verify() {
    const data = await this.call("verify_repository_evolution_contract", {
      input_engine_version: REPOSITORY_EVOLUTION_ENGINE_VERSION,
      input_schema_version: REPOSITORY_EVOLUTION_SCHEMA_VERSION,
    }) as { valid?: boolean; problems?: unknown };
    if (data.valid !== true) throw new RepositoryEvolutionError(
      "repository_evolution_startup_validation_failed",
      "Repository evolution database contract is invalid.",
      { problems: data.problems });
  }
}

export const runtimeRepositoryEvolutionStore: RepositoryEvolutionStore =
  env.NODE_ENV === "test"
    ? new MemoryRepositoryEvolutionStore()
    : new PostgresRepositoryEvolutionStore(
      supabase as unknown as SupabaseClient);
