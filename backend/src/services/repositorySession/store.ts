import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  REPOSITORY_SESSION_SCHEMA_VERSION,
  RepositorySessionError,
  type RepositorySessionContext,
  type RepositorySessionDiagnostic,
  type RepositorySessionMetrics,
  type RepositorySessionRecord,
} from "./types.js";

export interface RepositorySessionStore {
  save(record: RepositorySessionRecord, expectedVersion?: number | null):
    Promise<RepositorySessionRecord>;
  get(tenantId: string, ownerId: string, sessionId: string):
    Promise<RepositorySessionRecord | null>;
  recordReuse(tenantId: string, ownerId: string, sessionId: string):
    Promise<void>;
  archive(tenantId: string, ownerId: string, sessionId: string, at: string):
    Promise<RepositorySessionRecord | null>;
  recover(at: string): Promise<number>;
  collect(tenantId: string, retainedSessions: number): Promise<number>;
  metrics(tenantId?: string): Promise<RepositorySessionMetrics>;
  verify(): Promise<void>;
}

const clone = <T>(value: T): T => structuredClone(value);
const contextSize = (context: RepositorySessionContext) =>
  context.previousQuestions.length + context.previousAnswers.length +
  context.recentFiles.length + context.recentSymbols.length +
  context.recentFeatures.length + context.viewedInsights.length +
  context.viewedPlans.length + context.viewedSpecifications.length +
  context.viewedExecutionSummaries.length +
  Number(Boolean(context.activeFeature)) +
  Number(Boolean(context.activeModule)) +
  Number(Boolean(context.activeWorkflow)) +
  Number(Boolean(context.activeArchitecture)) +
  Number(Boolean(context.activeChangeAnalysis));

export class MemoryRepositorySessionStore implements RepositorySessionStore {
  private readonly values = new Map<string, RepositorySessionRecord>();
  private key(tenantId: string, sessionId: string) {
    return `${tenantId}\0${sessionId}`;
  }
  hydrate(value: RepositorySessionRecord) {
    this.values.set(this.key(
      value.session.tenantId, value.session.sessionId), clone(value));
  }
  async save(record: RepositorySessionRecord,
    expectedVersion: number | null = null) {
    const key = this.key(record.session.tenantId, record.session.sessionId);
    const current = this.values.get(key);
    if ((expectedVersion !== null && !current) ||
        (current && expectedVersion !== null &&
          current.session.persistenceVersion !== expectedVersion)) {
      throw new RepositorySessionError(
        "repository_session_version_conflict",
        "Repository session was modified concurrently.");
    }
    if (current && (current.session.ownerId !== record.session.ownerId ||
        current.session.userId !== record.session.userId ||
        current.session.repositoryId !== record.session.repositoryId ||
        current.session.repositoryRevision !==
          record.session.repositoryRevision)) {
      throw new RepositorySessionError(
        "repository_session_identity_conflict",
        "Repository session identity cannot change.");
    }
    const saved = clone({
      ...record,
      session: {
        ...record.session,
        persistenceVersion: current
          ? current.session.persistenceVersion + 1 : 1,
      },
    });
    this.values.set(key, saved);
    return clone(saved);
  }
  async get(tenantId: string, ownerId: string, sessionId: string) {
    const value = this.values.get(this.key(tenantId, sessionId));
    return value && value.session.ownerId === ownerId ? clone(value) : null;
  }
  async recordReuse(tenantId: string, ownerId: string, sessionId: string) {
    const key = this.key(tenantId, sessionId);
    const value = this.values.get(key);
    if (!value || value.session.ownerId !== ownerId) {
      throw new RepositorySessionError(
        "repository_session_not_found", "Repository session was not found.");
    }
    this.values.set(key, clone({
      ...value, reuseCount: value.reuseCount + 1,
    }));
  }
  async archive(
    tenantId: string, ownerId: string, sessionId: string, at: string,
  ) {
    const key = this.key(tenantId, sessionId);
    const value = this.values.get(key);
    if (!value || value.session.ownerId !== ownerId) return null;
    const archived = clone({
      ...value,
      session: {
        ...value.session,
        lifecycle: "archived" as const,
        persistenceVersion: value.session.persistenceVersion + 1,
        updatedAt: at,
        archivedAt: at,
      },
    });
    this.values.set(key, archived);
    return clone(archived);
  }
  async recover(at: string) {
    let recovered = 0;
    for (const [key, value] of this.values) {
      const expired = Date.parse(value.session.expiresAt) <= Date.parse(at);
      const partial = !value.context ||
        value.context.sessionId !== value.session.sessionId;
      const interrupted = value.session.lifecycle === "interrupted";
      const stale = value.session.lifecycle === "stale" || expired;
      if (!partial && !interrupted && !stale) continue;
      recovered += 1;
      const context = partial ? emptyContext(value.session.sessionId, at) :
        value.context;
      const code = partial
        ? "repository_session_partial_persistence_recovered"
        : interrupted
          ? "repository_session_interruption_recovered"
          : "repository_session_stale_archived";
      const diagnostic: RepositorySessionDiagnostic = {
        diagnosticId: `${value.session.sessionId}:${code}:${recovered}`,
        sessionId: value.session.sessionId,
        code,
        message: stale
          ? "Expired or stale session was archived."
          : "Repository session persistence was recovered.",
        severity: "warning",
        createdAt: at,
      };
      this.values.set(key, clone({
        ...value,
        session: {
          ...value.session,
          persistenceVersion: value.session.persistenceVersion + 1,
          lifecycle: stale ? "archived" : "recovered",
          updatedAt: at,
          archivedAt: stale ? at : null,
        },
        context,
        diagnostics: [...value.diagnostics, diagnostic],
        recoveryCount: value.recoveryCount + 1,
      }));
    }
    return recovered;
  }
  async collect(tenantId: string, retainedSessions: number) {
    const victims = [...this.values.entries()].filter(([, value]) =>
      value.session.tenantId === tenantId &&
      value.session.lifecycle === "archived")
      .sort(([, left], [, right]) =>
        right.session.updatedAt.localeCompare(left.session.updatedAt) ||
        right.session.sessionId.localeCompare(left.session.sessionId))
      .slice(Math.max(0, retainedSessions));
    for (const [key] of victims) this.values.delete(key);
    return victims.length;
  }
  async metrics(tenantId?: string) {
    const values = [...this.values.values()].filter((value) =>
      tenantId === undefined || value.session.tenantId === tenantId);
    const active = values.filter((value) =>
      ["active", "recovered"].includes(value.session.lifecycle));
    return {
      activeSessions: active.length,
      averageSessionDurationMs: values.length === 0 ? 0 : Number((
        values.reduce((sum, value) => sum + Math.max(0,
          Date.parse(value.session.updatedAt) -
          Date.parse(value.session.createdAt)), 0) / values.length).toFixed(3)),
      averageContextSize: values.length === 0 ? 0 : Number((
        values.reduce((sum, value) =>
          sum + contextSize(value.context), 0) / values.length).toFixed(3)),
      recoveryCount: values.reduce(
        (sum, value) => sum + value.recoveryCount, 0),
      sessionReuse: values.reduce(
        (sum, value) => sum + value.reuseCount, 0),
    };
  }
  async verify() {}
}

function emptyContext(sessionId: string, at: string):
RepositorySessionContext {
  return {
    sessionId, contextVersion: 1,
    activeFeature: null, activeModule: null, activeWorkflow: null,
    activeArchitecture: null, activeChangeAnalysis: null,
    previousQuestions: [], previousAnswers: [], recentFiles: [],
    recentSymbols: [], recentFeatures: [], viewedInsights: [],
    viewedPlans: [], viewedSpecifications: [],
    viewedExecutionSummaries: [], updatedAt: at,
  };
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositorySessionStore implements RepositorySessionStore {
  constructor(private readonly database: Database =
    supabase as unknown as SupabaseClient) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositorySessionError(
      error.message?.includes("version_conflict")
        ? "repository_session_version_conflict"
        : "repository_session_persistence_failed",
      error.message ?? "Repository session persistence failed.");
    return first(data);
  }
  async save(record: RepositorySessionRecord,
    expectedVersion: number | null = null) {
    return clone(await this.call("save_repository_engineering_session", {
      input_record: record,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    }) as RepositorySessionRecord);
  }
  async get(tenantId: string, ownerId: string, sessionId: string) {
    const value = await this.call("get_repository_engineering_session", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_session_id: sessionId,
    });
    return value ? clone(value as RepositorySessionRecord) : null;
  }
  async recordReuse(tenantId: string, ownerId: string, sessionId: string) {
    await this.call("record_repository_session_reuse", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_session_id: sessionId,
    });
  }
  async archive(
    tenantId: string, ownerId: string, sessionId: string, at: string,
  ) {
    const value = await this.call("archive_repository_engineering_session", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_session_id: sessionId,
      input_archived_at: at,
    });
    return value ? clone(value as RepositorySessionRecord) : null;
  }
  async recover(at: string) {
    return Number(await this.call("recover_repository_engineering_sessions", {
      input_recovered_at: at,
    }) ?? 0);
  }
  async collect(tenantId: string, retainedSessions: number) {
    return Number(await this.call("collect_repository_engineering_sessions", {
      input_tenant_id: tenantId,
      input_retained_sessions: retainedSessions,
    }) ?? 0);
  }
  async metrics(tenantId?: string) {
    return clone(await this.call("repository_session_engine_metrics", {
      input_tenant_id: tenantId ?? null,
    }) as RepositorySessionMetrics);
  }
  async verify() {
    const result = await this.call(
      "verify_repository_session_engine_contract") as {
        valid?: boolean;
        schemaVersion?: string;
      };
    if (!result?.valid ||
        result.schemaVersion !== REPOSITORY_SESSION_SCHEMA_VERSION) {
      throw new RepositorySessionError(
        "repository_session_startup_invalid",
        "Repository Session Engine schema contract is invalid.");
    }
  }
}

export const runtimeRepositorySessionStore: RepositorySessionStore =
  env.NODE_ENV === "test"
    ? new MemoryRepositorySessionStore()
    : new PostgresRepositorySessionStore();
