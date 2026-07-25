import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash } from "../repositoryExecution/determinism.js";
import type {
  PersistedToolResult,
  ToolDefinition,
  ToolFailure,
  ToolInvocation,
  ToolInvocationIdentity,
  ToolInvocationQuotas,
  ToolMetrics,
  ToolStructuredOutput,
} from "./types.js";
import {
  EMPTY_TOOL_METRICS,
  immutableToolClone,
  toolFailure,
} from "./validation.js";
import type { ToolRegistry } from "./registry.js";
import { runtimeToolRegistry } from "./registry.js";
import { TOOL_FRAMEWORK_VERSION } from "./types.js";

export type BeginInvocationResult =
  | { readonly state: "acquired"; readonly invocation: ToolInvocation }
  | { readonly state: "replay"; readonly result: PersistedToolResult };

export interface ToolInvocationStore {
  begin(identity: ToolInvocationIdentity, quotas: ToolInvocationQuotas): Promise<BeginInvocationResult>;
  complete(
    tenantId: string,
    invocationId: string,
    output: ToolStructuredOutput,
    durationMs: number,
  ): Promise<PersistedToolResult>;
  fail(
    tenantId: string,
    invocationId: string,
    failure: ToolFailure,
    diagnostics: ToolInvocation["diagnostics"],
    metrics: ToolMetrics,
    durationMs: number,
    retries: number,
  ): Promise<PersistedToolResult>;
  get(tenantId: string, invocationId: string): Promise<PersistedToolResult | null>;
  metrics(tenantId?: string): Promise<ToolMetrics>;
  recover(now?: Date): Promise<number>;
  collect(tenantId: string, retentionCount: number): Promise<number>;
  verify(registry?: ToolRegistry): Promise<void>;
}

interface StoredResult {
  invocation: ToolInvocation;
  output: ToolStructuredOutput | null;
}

const clone = <T>(value: T): T => immutableToolClone(value);

function identityFence(invocation: ToolInvocation): unknown {
  return {
    invocationId: invocation.invocationId,
    tenantId: invocation.tenantId,
    executionId: invocation.executionId,
    executionVersion: invocation.executionVersion,
    workUnitId: invocation.workUnitId,
    workUnitVersion: invocation.workUnitVersion,
    runtimeId: invocation.runtimeId,
    repositoryId: invocation.repositoryId,
    repositoryRevision: invocation.repositoryRevision,
    toolId: invocation.toolId,
    toolVersion: invocation.toolVersion,
    inputHash: invocation.inputHash,
    timeoutMs: invocation.timeoutMs,
  };
}

function identityInput(identity: ToolInvocationIdentity): unknown {
  const { timestamp: _timestamp, ...fence } = identity;
  return fence;
}

export class MemoryToolInvocationStore implements ToolInvocationStore {
  private readonly records = new Map<string, StoredResult>();

  private key(tenantId: string, invocationId: string): string {
    return `${tenantId}\0${invocationId}`;
  }

  async begin(identity: ToolInvocationIdentity, quotas: ToolInvocationQuotas): Promise<BeginInvocationResult> {
    const key = this.key(identity.tenantId, identity.invocationId);
    const existing = this.records.get(key);
    if (existing) {
      if (stableHash(identityFence(existing.invocation)) !== stableHash(identityInput(identity))) {
        throw toolFailure("validation", "tool_invocation_conflict",
          "Invocation ID conflicts with its durable identity.");
      }
      if (existing.invocation.status === "running" || existing.invocation.status === "pending") {
        throw toolFailure("tool_unavailable", "tool_invocation_in_progress",
          "An identical invocation is already in progress.", true);
      }
      existing.invocation = {
        ...existing.invocation,
        metrics: {
          ...existing.invocation.metrics,
          cacheHits: existing.invocation.metrics.cacheHits + 1,
        },
      };
      return { state: "replay", result: clone({
        invocation: existing.invocation,
        output: existing.output,
        replayed: true,
      }) };
    }
    const runtimeRecords = [...this.records.values()].filter(({ invocation }) =>
      invocation.tenantId === identity.tenantId && invocation.runtimeId === identity.runtimeId);
    if (runtimeRecords.length >= quotas.invocationsPerRuntime) {
      throw toolFailure("quota", "tool_invocation_quota_exceeded",
        "Runtime invocation quota exceeded.");
    }
    const active = runtimeRecords.filter(({ invocation }) =>
      invocation.status === "pending" || invocation.status === "running").length;
    if (active >= quotas.parallelInvocations) {
      throw toolFailure("quota", "tool_parallel_quota_exceeded",
        "Runtime parallel invocation quota exceeded.", true);
    }
    const invocation: ToolInvocation = {
      ...identity,
      status: "running",
      outputHash: null,
      durationMs: null,
      diagnostics: [],
      metrics: { ...EMPTY_TOOL_METRICS, usage: 1, cacheMisses: 1 },
      retries: 0,
      startedAt: identity.timestamp,
      completedAt: null,
      leaseExpiresAt: new Date(Date.parse(identity.timestamp) + identity.timeoutMs).toISOString(),
      failure: null,
    };
    this.records.set(key, { invocation, output: null });
    return { state: "acquired", invocation: clone(invocation) };
  }

  async complete(
    tenantId: string,
    invocationId: string,
    output: ToolStructuredOutput,
    durationMs: number,
  ): Promise<PersistedToolResult> {
    const stored = this.records.get(this.key(tenantId, invocationId));
    if (!stored) throw toolFailure("validation", "tool_invocation_not_found", "Invocation was not found.");
    if (stored.invocation.status !== "running") {
      throw toolFailure("validation", "tool_invocation_not_running", "Invocation is not running.");
    }
    stored.output = clone(output);
    stored.invocation = {
      ...stored.invocation,
      status: "succeeded",
      outputHash: stableHash(output),
      durationMs,
      diagnostics: clone(output.diagnostics),
      metrics: clone(output.metrics),
      retries: output.metrics.retryCount,
      completedAt: new Date(Date.parse(stored.invocation.timestamp) + durationMs).toISOString(),
      leaseExpiresAt: null,
      failure: null,
    };
    return clone({ invocation: stored.invocation, output: stored.output, replayed: false });
  }

  async fail(
    tenantId: string,
    invocationId: string,
    failure: ToolFailure,
    diagnostics: ToolInvocation["diagnostics"],
    metrics: ToolMetrics,
    durationMs: number,
    retries: number,
  ): Promise<PersistedToolResult> {
    const stored = this.records.get(this.key(tenantId, invocationId));
    if (!stored) throw toolFailure("validation", "tool_invocation_not_found", "Invocation was not found.");
    stored.output = null;
    stored.invocation = {
      ...stored.invocation,
      status: "failed",
      outputHash: null,
      durationMs,
      diagnostics: clone(diagnostics),
      metrics: clone(metrics),
      retries,
      completedAt: new Date(Date.parse(stored.invocation.timestamp) + durationMs).toISOString(),
      leaseExpiresAt: null,
      failure: clone(failure),
    };
    return clone({ invocation: stored.invocation, output: null, replayed: false });
  }

  async get(tenantId: string, invocationId: string): Promise<PersistedToolResult | null> {
    const stored = this.records.get(this.key(tenantId, invocationId));
    return stored ? clone({ invocation: stored.invocation, output: stored.output, replayed: false }) : null;
  }

  async metrics(tenantId?: string): Promise<ToolMetrics> {
    const records = [...this.records.values()].filter(({ invocation }) =>
      tenantId === undefined || invocation.tenantId === tenantId);
    return records.reduce<ToolMetrics>((total, { invocation }) => ({
      usage: total.usage + 1,
      latencyMs: total.latencyMs + (invocation.durationMs ?? 0),
      timeouts: total.timeouts + (invocation.failure?.kind === "timeout" ? 1 : 0),
      failures: total.failures + (invocation.status === "failed" ? 1 : 0),
      retryCount: total.retryCount + invocation.retries,
      payloadBytes: total.payloadBytes + invocation.metrics.payloadBytes,
      cacheHits: total.cacheHits + invocation.metrics.cacheHits,
      cacheMisses: total.cacheMisses + invocation.metrics.cacheMisses,
      diagnosticGeneration: total.diagnosticGeneration + invocation.diagnostics.length,
    }), { ...EMPTY_TOOL_METRICS });
  }

  async recover(now = new Date()): Promise<number> {
    let recovered = 0;
    for (const stored of this.records.values()) {
      if (stored.invocation.status !== "running" ||
          Date.parse(stored.invocation.leaseExpiresAt ?? "") > now.getTime()) continue;
      const diagnostic = {
        code: "tool_invocation_recovered",
        message: "Expired unfinished tool invocation recovered.",
        level: "error" as const,
        details: {},
        createdAt: now.toISOString(),
      };
      stored.invocation = {
        ...stored.invocation,
        status: "failed",
        durationMs: Math.max(0, now.getTime() - Date.parse(stored.invocation.timestamp)),
        diagnostics: [...stored.invocation.diagnostics, diagnostic],
        retries: stored.invocation.retries + 1,
        completedAt: now.toISOString(),
        leaseExpiresAt: null,
        failure: {
          kind: "runtime",
          code: "unfinished_tool_invocation",
          message: "Unfinished tool invocation recovered.",
          retryable: true,
          details: {},
        },
      };
      recovered += 1;
    }
    return recovered;
  }

  async collect(tenantId: string, retentionCount: number): Promise<number> {
    const terminal = [...this.records.entries()].filter(([, { invocation }]) =>
      invocation.tenantId === tenantId &&
      (invocation.status === "succeeded" || invocation.status === "failed"))
      .sort((left, right) => right[1].invocation.timestamp.localeCompare(left[1].invocation.timestamp) ||
        right[1].invocation.invocationId.localeCompare(left[1].invocation.invocationId));
    let removed = 0;
    for (const [key] of terminal.slice(Math.max(1, retentionCount))) {
      this.records.delete(key);
      removed += 1;
    }
    return removed;
  }

  async verify(registry = runtimeToolRegistry): Promise<void> {
    registry.verify();
    for (const { invocation, output } of this.records.values()) {
      if (output && stableHash(output) !== invocation.outputHash) {
        throw toolFailure("serialization", "tool_output_hash_mismatch",
          "Stored tool output hash is invalid.");
      }
    }
  }
}

interface RpcQuery extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {}
interface DatabaseClient { rpc(name: string, parameters?: Record<string, unknown>): RpcQuery }

function first(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : undefined;
}

export class PostgresToolInvocationStore implements ToolInvocationStore {
  constructor(
    private readonly client: DatabaseClient,
    private readonly registry: ToolRegistry = runtimeToolRegistry,
  ) {}

  private async call(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const message = error.message ?? `Tool persistence RPC ${name} failed.`;
      const known = [
        ["tool_invocation_conflict", "validation", false],
        ["tool_invocation_in_progress", "tool_unavailable", true],
        ["tool_invocation_quota_exceeded", "quota", false],
        ["tool_parallel_quota_exceeded", "quota", true],
        ["permission", "permission", false],
      ] as const;
      const match = known.find(([code]) => message.includes(code));
      throw match
        ? toolFailure(match[1], match[0], message, match[2])
        : toolFailure("runtime", "tool_persistence_failed", message, true);
    }
    return data;
  }

  async begin(identity: ToolInvocationIdentity, quotas: ToolInvocationQuotas): Promise<BeginInvocationResult> {
    const data = await this.call("begin_tool_invocation", {
      input_identity: identity,
      input_max_invocations: quotas.invocationsPerRuntime,
      input_max_parallel: quotas.parallelInvocations,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.state === "replay") {
      return { state: "replay", result: clone(row.result as unknown as PersistedToolResult) };
    }
    return { state: "acquired", invocation: clone(row.invocation as unknown as ToolInvocation) };
  }

  async complete(tenantId: string, invocationId: string, output: ToolStructuredOutput, durationMs: number) {
    const data = await this.call("complete_tool_invocation", {
      input_tenant_id: tenantId,
      input_invocation_id: invocationId,
      input_output: output,
      input_output_hash: stableHash(output),
      input_duration_ms: durationMs,
    });
    return clone((first(data)?.result ?? data) as PersistedToolResult);
  }

  async fail(
    tenantId: string,
    invocationId: string,
    failure: ToolFailure,
    diagnostics: ToolInvocation["diagnostics"],
    metrics: ToolMetrics,
    durationMs: number,
    retries: number,
  ) {
    const data = await this.call("fail_tool_invocation", {
      input_tenant_id: tenantId,
      input_invocation_id: invocationId,
      input_failure: failure,
      input_diagnostics: diagnostics,
      input_metrics: metrics,
      input_duration_ms: durationMs,
      input_retries: retries,
    });
    return clone((first(data)?.result ?? data) as PersistedToolResult);
  }

  async get(tenantId: string, invocationId: string) {
    const data = await this.call("get_tool_invocation", {
      input_tenant_id: tenantId,
      input_invocation_id: invocationId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    const result = first(data)?.result ?? data;
    return result ? clone(result as PersistedToolResult) : null;
  }

  async metrics(tenantId?: string) {
    const data = await this.call("tool_invocation_metrics", { input_tenant_id: tenantId ?? null });
    return clone((first(data)?.metrics ?? data) as ToolMetrics);
  }

  async recover(now = new Date()) {
    const data = await this.call("recover_tool_invocations", { input_now: now.toISOString() });
    return Number(first(data)?.recovered_count ?? data ?? 0);
  }

  async collect(tenantId: string, retentionCount: number) {
    const data = await this.call("collect_tool_invocations", {
      input_tenant_id: tenantId,
      input_retention_count: retentionCount,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async verify(registry = this.registry) {
    registry.verify();
    const data = await this.call("verify_tool_invocation_contract", {
      input_framework_version: TOOL_FRAMEWORK_VERSION,
      input_registry: registry.list(),
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw toolFailure("runtime", "tool_startup_validation_failed",
        "Tool invocation database contract is invalid.", false, { problems: row.problems ?? [] });
    }
  }
}

export const runtimeToolInvocationStore: ToolInvocationStore =
  new PostgresToolInvocationStore(supabase as unknown as SupabaseClient);
