import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase.js";
import {
  CHANGE_INTELLIGENCE_ENGINE_VERSION,
  CHANGE_INTELLIGENCE_SCHEMA_VERSION,
  ChangeIntelligenceError,
  type ChangeAnalysis,
  type ChangeAnalysisMetrics,
  type ChangeRiskLevel,
} from "./types.js";
import { cloneChangeAnalysis as clone, validateChangeAnalysis } from "./validation.js";

export interface ChangeIntelligenceStore {
  save(analysis: ChangeAnalysis, expectedVersion?: number | null): Promise<ChangeAnalysis>;
  get(
    tenantId: string, ownerId: string, changeId: string,
  ): Promise<ChangeAnalysis | null>;
  recordReuse(tenantId: string, ownerId: string, changeId: string): Promise<void>;
  recover(): Promise<number>;
  metrics(tenantId?: string): Promise<ChangeAnalysisMetrics>;
  collect(tenantId: string, retainedAnalyses: number): Promise<number>;
  verify(): Promise<void>;
}

function emptyDistribution(): Record<ChangeRiskLevel, number> {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

function emptyMetrics(): ChangeAnalysisMetrics {
  return {
    analyses: 0, averageImpactSize: 0, averageDependencyDepth: 0,
    riskDistribution: emptyDistribution(), reuseRate: 0, recoveryCount: 0,
  };
}

export class MemoryChangeIntelligenceStore implements ChangeIntelligenceStore {
  private readonly analyses = new Map<string, ChangeAnalysis>();
  private reuseEvents = 0;
  private analysisRequests = 0;

  private key(tenantId: string, changeId: string): string {
    return `${tenantId}\0${changeId}`;
  }

  hydrate(analysis: ChangeAnalysis): void {
    this.analyses.set(this.key(analysis.request.tenantId,
      analysis.request.changeId), clone(analysis));
  }

  async save(analysis: ChangeAnalysis, expectedVersion: number | null = null) {
    validateChangeAnalysis(analysis);
    const key = this.key(analysis.request.tenantId, analysis.request.changeId);
    const existing = this.analyses.get(key);
    if ((expectedVersion !== null && !existing) ||
        (existing && expectedVersion !== null &&
          existing.persistenceVersion !== expectedVersion)) {
      throw new ChangeIntelligenceError(
        "change_analysis_version_conflict",
        "Change analysis was modified concurrently.",
      );
    }
    if (existing && existing.request.ownerId !== analysis.request.ownerId) {
      throw new ChangeIntelligenceError(
        "change_analysis_access_denied",
        "Change analysis ownership cannot change.",
      );
    }
    const saved = clone({
      ...analysis,
      persistenceVersion: existing ? existing.persistenceVersion + 1 : 1,
    });
    this.analyses.set(key, saved);
    this.analysisRequests += 1;
    return clone(saved);
  }

  async get(tenantId: string, ownerId: string, changeId: string) {
    const analysis = this.analyses.get(this.key(tenantId, changeId));
    return analysis?.request.ownerId === ownerId &&
      analysis.lifecycle === "published" ? clone(analysis) : null;
  }

  async recordReuse(tenantId: string, ownerId: string, changeId: string) {
    const analysis = await this.get(tenantId, ownerId, changeId);
    if (!analysis) throw new ChangeIntelligenceError(
      "change_analysis_not_found", "Reusable change analysis was not found.");
    this.reuseEvents += 1;
    this.analysisRequests += 1;
  }

  async recover(): Promise<number> {
    let count = 0;
    for (const [key, analysis] of this.analyses) {
      const interrupted = ["building", "validating"].includes(analysis.lifecycle);
      const orphan = !analysis.request.changeId ||
        analysis.impact.changeId !== analysis.request.changeId ||
        analysis.risk.changeId !== analysis.request.changeId ||
        analysis.implementationPlan.changeId !== analysis.request.changeId;
      const stale = analysis.impact.dependencyChains.some((chain) =>
        chain.steps.length < 2 ||
        chain.steps.some((item, position) => item.position !== position));
      if (!interrupted && !orphan && !stale) continue;
      count += 1;
      const timestamp = new Date().toISOString();
      this.analyses.set(key, clone({
        ...analysis,
        lifecycle: "failed",
        persistenceVersion: analysis.persistenceVersion + 1,
        diagnostics: [...analysis.diagnostics, {
          code: interrupted ? "change_analysis_interrupted_recovered"
            : orphan ? "change_analysis_orphan_recovered"
            : "change_analysis_stale_graph_recovered",
          message: "Invalid or partial change analysis was fenced from publication.",
          severity: "warning",
        }],
        updatedAt: timestamp, publishedAt: null,
      }));
    }
    return count;
  }

  async metrics(tenantId?: string): Promise<ChangeAnalysisMetrics> {
    const analyses = [...this.analyses.values()].filter((item) =>
      tenantId === undefined || item.request.tenantId === tenantId);
    if (analyses.length === 0) return emptyMetrics();
    const distribution = emptyDistribution();
    for (const item of analyses) distribution[item.risk.level] += 1;
    return {
      analyses: analyses.length,
      averageImpactSize: Number((analyses.reduce((sum, item) => sum +
        item.impact.directlyAffectedFiles.length +
        item.impact.indirectlyAffectedFiles.length +
        item.impact.affectedSymbolIds.length +
        item.impact.affectedFeatureIds.length, 0) / analyses.length).toFixed(3)),
      averageDependencyDepth: Number((analyses.reduce((sum, item) =>
        sum + item.impact.maximumDependencyDepth, 0) / analyses.length).toFixed(3)),
      riskDistribution: distribution,
      reuseRate: this.analysisRequests === 0 ? 0
        : Number((this.reuseEvents / this.analysisRequests).toFixed(3)),
      recoveryCount: analyses.reduce((sum, item) => sum +
        item.diagnostics.filter((diagnostic) =>
          diagnostic.code.endsWith("_recovered")).length, 0),
    };
  }

  async collect(tenantId: string, retainedAnalyses: number): Promise<number> {
    const candidates = [...this.analyses.entries()].filter(([, item]) =>
      item.request.tenantId === tenantId && item.lifecycle !== "published")
      .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt) ||
        b.analysisId.localeCompare(a.analysisId));
    let removed = 0;
    for (const [key] of candidates.slice(Math.max(1, retainedAnalyses))) {
      this.analyses.delete(key);
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

export class PostgresChangeIntelligenceStore implements ChangeIntelligenceStore {
  constructor(private readonly database: Database) {}

  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) {
      throw new ChangeIntelligenceError(
        String(error.message ?? "").includes("version_conflict")
          ? "change_analysis_version_conflict"
          : "change_analysis_persistence_failed",
        error.message ?? "Change intelligence persistence failed.",
      );
    }
    return data;
  }

  async save(analysis: ChangeAnalysis, expectedVersion: number | null = null) {
    validateChangeAnalysis(analysis);
    const data = await this.call("save_change_intelligence_analysis", {
      input_analysis: analysis,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    return clone((first(data)?.analysis ?? data) as ChangeAnalysis);
  }

  async get(tenantId: string, ownerId: string, changeId: string) {
    const data = await this.call("get_change_intelligence_analysis", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_change_id: changeId,
    });
    const analysis = first(data)?.analysis ?? data;
    return analysis ? clone(analysis as ChangeAnalysis) : null;
  }

  async recordReuse(tenantId: string, ownerId: string, changeId: string) {
    await this.call("record_change_intelligence_reuse", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_change_id: changeId,
    });
  }

  async recover() {
    const data = await this.call("recover_change_intelligence_analyses");
    return Number(first(data)?.recovered_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("change_intelligence_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return structuredClone((first(data)?.metrics ?? data) as ChangeAnalysisMetrics);
  }

  async collect(tenantId: string, retainedAnalyses: number) {
    const data = await this.call("collect_change_intelligence_analyses", {
      input_tenant_id: tenantId,
      input_retained_analyses: retainedAnalyses,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async verify() {
    const data = await this.call("verify_change_intelligence_contract", {
      input_engine_version: CHANGE_INTELLIGENCE_ENGINE_VERSION,
      input_schema_version: CHANGE_INTELLIGENCE_SCHEMA_VERSION,
    });
    const result = first(data) ?? {};
    if (result.valid !== true && data !== true) {
      throw new ChangeIntelligenceError(
        "change_startup_validation_failed",
        "Change intelligence database contract is invalid.",
        { problems: result.problems ?? [] },
      );
    }
  }
}

export const runtimeChangeIntelligenceStore: ChangeIntelligenceStore =
  new PostgresChangeIntelligenceStore(supabase as unknown as SupabaseClient);
