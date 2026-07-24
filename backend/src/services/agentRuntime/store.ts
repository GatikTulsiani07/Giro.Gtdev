import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import { AgentCapabilityRegistry } from "./registry.js";
import type {
  AgentExecutionContext,
  AgentKind,
  AgentRuntime,
  AgentRuntimeFailureCode,
  AgentRuntimeMetrics,
  AgentRuntimeQuotas,
  AgentStructuredOutput,
  RuntimeLease,
  VersionedAgentRuntimeOutput,
} from "./types.js";
import {
  AGENT_OUTPUT_SCHEMA_VERSION,
  AGENT_RUNTIME_VERSION,
  AgentRuntimeError,
} from "./types.js";
import {
  immutableClone,
  isRetryableFailure,
  validateExecutionContext,
  validateStructuredOutput,
} from "./validation.js";

export interface CreateAgentRuntimeInput {
  agentId: AgentKind;
  context: AgentExecutionContext;
}

export interface AgentRuntimeClaim {
  tenantId: string;
  runtimeId: string;
  executionVersion: string;
  workUnitVersion: string;
  workerId: string;
  claimToken: string;
}

export interface AgentRuntimeStore {
  create(input: CreateAgentRuntimeInput, quotas: AgentRuntimeQuotas, now?: Date): Promise<AgentRuntime>;
  get(tenantId: string, runtimeId: string): Promise<AgentRuntime | null>;
  leaseNext(tenantId: string, workerId: string, leaseMs: number, quotas: AgentRuntimeQuotas, now?: Date): Promise<RuntimeLease | null>;
  heartbeat(claim: AgentRuntimeClaim, leaseMs: number, now?: Date): Promise<RuntimeLease>;
  transition(claim: AgentRuntimeClaim, status: "running" | "waiting", now?: Date): Promise<AgentRuntime>;
  publish(claim: AgentRuntimeClaim, output: AgentStructuredOutput, quotas: AgentRuntimeQuotas, now?: Date): Promise<VersionedAgentRuntimeOutput>;
  fail(claim: AgentRuntimeClaim, code: AgentRuntimeFailureCode, message: string, quotas: AgentRuntimeQuotas, now?: Date): Promise<AgentRuntime>;
  cancel(tenantId: string, runtimeId: string, now?: Date): Promise<AgentRuntime>;
  supersede(tenantId: string, runtimeId: string, supersededBy: string, now?: Date): Promise<AgentRuntime>;
  recover(now?: Date, quotas?: AgentRuntimeQuotas): Promise<number>;
  outputs(tenantId: string, runtimeId: string): Promise<readonly VersionedAgentRuntimeOutput[]>;
  metrics(): Promise<AgentRuntimeMetrics>;
  collect(tenantId: string, retentionCount: number): Promise<number>;
  verify(): Promise<void>;
}

const terminal = new Set(["completed", "failed", "cancelled"]);
const clone = <T>(value: T): T => immutableClone(value);

export class MemoryAgentRuntimeStore implements AgentRuntimeStore {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly runtimeOutputs = new Map<string, VersionedAgentRuntimeOutput[]>();
  private retryCount = 0;
  private failureCount = 0;
  private heartbeatLatencyMs = 0;
  private outputBytes = 0;
  private recoveryTotal = 0;

  constructor(private readonly registry = new AgentCapabilityRegistry()) {}

  private key(tenantId: string, runtimeId: string): string {
    return `${tenantId}\0${runtimeId}`;
  }

  private require(tenantId: string, runtimeId: string): AgentRuntime {
    const runtime = this.runtimes.get(this.key(tenantId, runtimeId));
    if (!runtime) throw new AgentRuntimeError("authorization_failed", "Runtime was not found.");
    return runtime;
  }

  async create(input: CreateAgentRuntimeInput, quotas: AgentRuntimeQuotas, now = new Date()): Promise<AgentRuntime> {
    const agent = this.registry.get(input.agentId);
    const context = validateExecutionContext(input.context, agent);
    const active = [...this.runtimes.values()].filter((runtime) =>
      runtime.tenantId === context.tenantId && !terminal.has(runtime.status)).length;
    if (active >= quotas.activeRuntimes) {
      throw new AgentRuntimeError("active_runtime_quota_exceeded", "Active runtime quota exceeded.");
    }
    const runtimeId = stableId("runtime", {
      tenantId: context.tenantId,
      executionVersion: context.executionVersion,
      workUnitVersion: context.workUnitVersion,
      agentId: agent.agentId,
      agentVersion: agent.version,
      capabilityVersion: agent.capability.capabilityVersion,
      runtimeVersion: AGENT_RUNTIME_VERSION,
    });
    const key = this.key(context.tenantId, runtimeId);
    const existing = this.runtimes.get(key);
    if (existing) {
      if (stableHash(existing.context) !== stableHash(context)) {
        throw new AgentRuntimeError("runtime_identity_conflict", "Deterministic runtime identity conflicts.");
      }
      return clone(existing);
    }
    const timestamp = now.toISOString();
    const runtime: AgentRuntime = {
      runtimeId,
      tenantId: context.tenantId,
      agentId: agent.agentId,
      agentVersion: agent.version,
      capabilityVersion: agent.capability.capabilityVersion,
      capabilityHash: agent.capability.capabilityHash,
      executionVersion: context.executionVersion,
      workUnitVersion: context.workUnitVersion,
      workerId: null,
      status: "ready",
      attempt: 0,
      lease: null,
      heartbeat: null,
      diagnostics: [],
      context,
      outputVersion: 0,
      supersededBy: null,
      recoveryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
    };
    this.runtimes.set(key, runtime);
    return clone(runtime);
  }

  async get(tenantId: string, runtimeId: string): Promise<AgentRuntime | null> {
    const runtime = this.runtimes.get(this.key(tenantId, runtimeId));
    return runtime ? clone(runtime) : null;
  }

  async leaseNext(
    tenantId: string,
    workerId: string,
    leaseMs: number,
    quotas: AgentRuntimeQuotas,
    now = new Date(),
  ): Promise<RuntimeLease | null> {
    const tenant = [...this.runtimes.values()].filter((runtime) => runtime.tenantId === tenantId);
    const leased = tenant.filter((runtime) => runtime.lease &&
      Date.parse(runtime.lease.expiresAt) > now.getTime()).length;
    if (leased >= quotas.leasedWorkUnits || leased >= quotas.concurrentAgents) {
      throw new AgentRuntimeError("runtime_lease_quota_exceeded", "Runtime lease quota exceeded.");
    }
    const runtime = tenant
      .filter((candidate) => candidate.status === "ready" && !candidate.supersededBy)
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.runtimeId.localeCompare(right.runtimeId))[0];
    if (!runtime) return null;
    if (now.getTime() - Date.parse(runtime.createdAt) >= Math.min(
      quotas.runtimeDurationMs,
      runtime.context.limits.runtimeDurationMs,
    )) {
      this.timeout(runtime, now);
      return null;
    }
    const timestamp = now.toISOString();
    const lease: RuntimeLease = {
      runtimeId: runtime.runtimeId,
      workerId,
      claimToken: randomUUID(),
      attempt: runtime.attempt + 1,
      leasedAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
    runtime.attempt = lease.attempt;
    runtime.workerId = workerId;
    runtime.lease = lease;
    runtime.status = "leased";
    runtime.updatedAt = timestamp;
    runtime.startedAt ??= timestamp;
    return clone(lease);
  }

  private fenced(claim: AgentRuntimeClaim, now = new Date()): AgentRuntime {
    const runtime = this.require(claim.tenantId, claim.runtimeId);
    if (runtime.executionVersion !== claim.executionVersion ||
        runtime.workUnitVersion !== claim.workUnitVersion ||
        runtime.lease?.workerId !== claim.workerId ||
        runtime.lease.claimToken !== claim.claimToken ||
        Date.parse(runtime.lease.expiresAt) <= now.getTime() ||
        runtime.supersededBy) {
      throw new AgentRuntimeError("stale_runtime_rejected", "Runtime lease or version fence is stale.");
    }
    return runtime;
  }

  async heartbeat(claim: AgentRuntimeClaim, leaseMs: number, now = new Date()): Promise<RuntimeLease> {
    const runtime = this.fenced(claim, now);
    const lease = runtime.lease!;
    const latency = Math.max(0, now.getTime() - Date.parse(lease.heartbeatAt));
    lease.heartbeatAt = now.toISOString();
    lease.expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    runtime.heartbeat = {
      runtimeId: runtime.runtimeId,
      workerId: lease.workerId,
      claimToken: lease.claimToken,
      recordedAt: lease.heartbeatAt,
      latencyMs: latency,
    };
    runtime.updatedAt = lease.heartbeatAt;
    this.heartbeatLatencyMs += latency;
    return clone(lease);
  }

  async transition(
    claim: AgentRuntimeClaim,
    status: "running" | "waiting",
    now = new Date(),
  ): Promise<AgentRuntime> {
    const runtime = this.fenced(claim, now);
    if (status === "running" && !["leased", "waiting", "running"].includes(runtime.status) ||
        status === "waiting" && runtime.status !== "running") {
      throw new AgentRuntimeError("invalid_runtime_transition", `Cannot transition ${runtime.status} to ${status}.`);
    }
    runtime.status = status;
    runtime.updatedAt = now.toISOString();
    return clone(runtime);
  }

  async publish(
    claim: AgentRuntimeClaim,
    output: AgentStructuredOutput,
    quotas: AgentRuntimeQuotas,
    now = new Date(),
  ): Promise<VersionedAgentRuntimeOutput> {
    const bytes = validateStructuredOutput(output, Math.min(quotas.outputBytes,
      this.registry.get(this.fenced(claim, now).agentId).limits.outputBytes));
    const runtime = this.fenced(claim, now);
    if (runtime.status !== "running" && runtime.status !== "waiting") {
      throw new AgentRuntimeError("invalid_runtime_transition", "Only a running runtime may publish.");
    }
    const outputVersion = runtime.outputVersion + 1;
    const versioned: VersionedAgentRuntimeOutput = {
      outputId: stableId("agent_output", {
        runtimeId: runtime.runtimeId,
        executionVersion: runtime.executionVersion,
        workUnitVersion: runtime.workUnitVersion,
        agentVersion: runtime.agentVersion,
        capabilityVersion: runtime.capabilityVersion,
        outputVersion,
        schemaVersion: AGENT_OUTPUT_SCHEMA_VERSION,
        output,
      }),
      runtimeId: runtime.runtimeId,
      executionVersion: runtime.executionVersion,
      workUnitVersion: runtime.workUnitVersion,
      agentVersion: runtime.agentVersion,
      capabilityVersion: runtime.capabilityVersion,
      outputVersion,
      payloadHash: stableHash(output),
      output: immutableClone(output),
      published: true,
      orphaned: false,
      createdAt: now.toISOString(),
    };
    const key = this.key(runtime.tenantId, runtime.runtimeId);
    this.runtimeOutputs.set(key, [...(this.runtimeOutputs.get(key) ?? []), versioned]);
    runtime.outputVersion = outputVersion;
    runtime.status = "completed";
    runtime.lease = null;
    runtime.workerId = null;
    runtime.updatedAt = versioned.createdAt;
    runtime.completedAt = versioned.createdAt;
    this.outputBytes += bytes;
    return clone(versioned);
  }

  async fail(
    claim: AgentRuntimeClaim,
    code: AgentRuntimeFailureCode,
    message: string,
    quotas: AgentRuntimeQuotas,
    now = new Date(),
  ): Promise<AgentRuntime> {
    const runtime = this.fenced(claim, now);
    const retryLimit = Math.min(quotas.retries, runtime.context.limits.retries);
    const retry = isRetryableFailure(code) && runtime.attempt <= retryLimit;
    runtime.status = retry ? "ready" : code === "transient_runtime_failure" ? "unhealthy" : "failed";
    runtime.lease = null;
    runtime.workerId = null;
    runtime.updatedAt = now.toISOString();
    runtime.completedAt = retry ? null : runtime.updatedAt;
    runtime.diagnostics = [...runtime.diagnostics, {
      code,
      message,
      retryable: retry,
      details: {},
      createdAt: runtime.updatedAt,
    }];
    if (retry) this.retryCount += 1;
    else this.failureCount += 1;
    return clone(runtime);
  }

  async cancel(tenantId: string, runtimeId: string, now = new Date()): Promise<AgentRuntime> {
    const runtime = this.require(tenantId, runtimeId);
    if (!terminal.has(runtime.status)) {
      runtime.status = "cancelled";
      runtime.lease = null;
      runtime.workerId = null;
      runtime.updatedAt = now.toISOString();
      runtime.completedAt = runtime.updatedAt;
    }
    return clone(runtime);
  }

  async supersede(
    tenantId: string,
    runtimeId: string,
    supersededBy: string,
    now = new Date(),
  ): Promise<AgentRuntime> {
    const runtime = this.require(tenantId, runtimeId);
    runtime.supersededBy = supersededBy;
    runtime.status = "cancelled";
    runtime.lease = null;
    runtime.workerId = null;
    runtime.updatedAt = now.toISOString();
    runtime.completedAt = runtime.updatedAt;
    const key = this.key(tenantId, runtimeId);
    this.runtimeOutputs.set(key, (this.runtimeOutputs.get(key) ?? []).map((output) => ({
      ...output,
      published: false,
      orphaned: true,
    })));
    return clone(runtime);
  }

  async recover(now = new Date(), quotas?: AgentRuntimeQuotas): Promise<number> {
    let recovered = 0;
    for (const runtime of this.runtimes.values()) {
      if (terminal.has(runtime.status)) continue;
      const outputKey = this.key(runtime.tenantId, runtime.runtimeId);
      const orphaned = (this.runtimeOutputs.get(outputKey) ?? []).map((output) =>
        output.published ? { ...output, published: false, orphaned: true } : output);
      if (orphaned.some((output) => output.orphaned)) {
        this.runtimeOutputs.set(outputKey, orphaned);
      }
      const durationLimit = Math.min(
        quotas?.runtimeDurationMs ?? runtime.context.limits.runtimeDurationMs,
        runtime.context.limits.runtimeDurationMs,
      );
      if (now.getTime() - Date.parse(runtime.createdAt) >= durationLimit) {
        this.timeout(runtime, now);
        recovered += 1;
        continue;
      }
      if (runtime.lease && Date.parse(runtime.lease.expiresAt) <= now.getTime()) {
        const retryLimit = Math.min(quotas?.retries ?? runtime.context.limits.retries,
          runtime.context.limits.retries);
        const retry = runtime.attempt <= retryLimit;
        runtime.status = retry ? "ready" : "failed";
        runtime.lease = null;
        runtime.workerId = null;
        runtime.recoveryCount += 1;
        runtime.updatedAt = now.toISOString();
        runtime.completedAt = retry ? null : runtime.updatedAt;
        runtime.diagnostics = [...runtime.diagnostics, {
          code: "lease_expired",
          message: "Expired runtime lease recovered.",
          retryable: retry,
          details: {},
          createdAt: runtime.updatedAt,
        }];
        if (retry) this.retryCount += 1;
        else this.failureCount += 1;
        recovered += 1;
      }
    }
    this.recoveryTotal += recovered;
    return recovered;
  }

  private timeout(runtime: AgentRuntime, now: Date): void {
    runtime.status = "failed";
    runtime.lease = null;
    runtime.workerId = null;
    runtime.updatedAt = now.toISOString();
    runtime.completedAt = runtime.updatedAt;
    runtime.diagnostics = [...runtime.diagnostics, {
      code: "runtime_timeout",
      message: "Runtime duration quota exceeded.",
      retryable: false,
      details: {},
      createdAt: runtime.updatedAt,
    }];
    this.failureCount += 1;
  }

  async outputs(tenantId: string, runtimeId: string): Promise<readonly VersionedAgentRuntimeOutput[]> {
    this.require(tenantId, runtimeId);
    return clone(this.runtimeOutputs.get(this.key(tenantId, runtimeId)) ?? []);
  }

  async metrics(): Promise<AgentRuntimeMetrics> {
    const runtimes = [...this.runtimes.values()];
    const now = Date.now();
    return {
      activeAgents: runtimes.filter((runtime) => !terminal.has(runtime.status)).length,
      runningAgents: runtimes.filter((runtime) => runtime.status === "running").length,
      leases: runtimes.filter((runtime) => runtime.lease &&
        Date.parse(runtime.lease.expiresAt) > now).length,
      retries: this.retryCount,
      failures: this.failureCount,
      runtimeDurationMs: runtimes.reduce((total, runtime) =>
        total + Math.max(0, Date.parse(runtime.completedAt ?? runtime.updatedAt) -
          Date.parse(runtime.startedAt ?? runtime.createdAt)), 0),
      heartbeatLatencyMs: this.heartbeatLatencyMs,
      capabilityUsage: runtimes.length,
      outputBytes: this.outputBytes,
      recoveryCount: this.recoveryTotal,
    };
  }

  async collect(tenantId: string, retentionCount: number): Promise<number> {
    const candidates = [...this.runtimes.entries()]
      .filter(([, runtime]) => runtime.tenantId === tenantId && terminal.has(runtime.status))
      .sort((left, right) => right[1].createdAt.localeCompare(left[1].createdAt));
    let removed = 0;
    for (const [key] of candidates.slice(Math.max(1, retentionCount))) {
      this.runtimes.delete(key);
      this.runtimeOutputs.delete(key);
      removed += 1;
    }
    return removed;
  }

  async verify(): Promise<void> {
    this.registry.verify();
    for (const runtime of this.runtimes.values()) {
      const agent = this.registry.get(runtime.agentId);
      if (runtime.capabilityHash !== agent.capability.capabilityHash ||
          runtime.capabilityVersion !== agent.capability.capabilityVersion) {
        throw new AgentRuntimeError("agent_runtime_startup_validation_failed", "Runtime capability is stale.");
      }
      validateExecutionContext(runtime.context, agent);
    }
  }
}

interface RpcQuery extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {}
interface DatabaseClient { rpc(name: string, parameters?: Record<string, unknown>): RpcQuery }
const first = (data: unknown): Record<string, unknown> | null =>
  Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) ?? null
    : data && typeof data === "object" ? data as Record<string, unknown> : null;

export class PostgresAgentRuntimeStore implements AgentRuntimeStore {
  constructor(
    private readonly client: DatabaseClient | SupabaseClient,
    private readonly registry = new AgentCapabilityRegistry(),
  ) {}

  private async call(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await (this.client as DatabaseClient).rpc(name, parameters);
    if (error) throw new AgentRuntimeError(error.message ?? "agent_runtime_storage_error", error.message ?? name);
    return data;
  }

  async create(input: CreateAgentRuntimeInput, quotas: AgentRuntimeQuotas) {
    const agent = this.registry.get(input.agentId);
    const context = validateExecutionContext(input.context, agent);
    const runtimeId = stableId("runtime", {
      tenantId: context.tenantId, executionVersion: context.executionVersion,
      workUnitVersion: context.workUnitVersion, agentId: agent.agentId,
      agentVersion: agent.version, capabilityVersion: agent.capability.capabilityVersion,
      runtimeVersion: AGENT_RUNTIME_VERSION,
    });
    const data = await this.call("create_agent_runtime", {
      input_runtime_id: runtimeId, input_agent: agent, input_context: context,
      input_max_active_runtimes: quotas.activeRuntimes,
    });
    return clone((first(data)?.runtime ?? data) as AgentRuntime);
  }
  async get(tenantId: string, runtimeId: string) {
    const data = await this.call("get_agent_runtime", { input_tenant_id: tenantId, input_runtime_id: runtimeId });
    return first(data) ? clone((first(data)?.runtime ?? first(data)) as AgentRuntime) : null;
  }
  async leaseNext(tenantId: string, workerId: string, leaseMs: number, quotas: AgentRuntimeQuotas) {
    const data = await this.call("lease_agent_runtime", {
      input_tenant_id: tenantId, input_worker_id: workerId, input_lease_ms: leaseMs,
      input_max_leases: Math.min(quotas.leasedWorkUnits, quotas.concurrentAgents),
      input_max_runtime_ms: quotas.runtimeDurationMs,
    });
    return first(data) ? clone((first(data)?.lease ?? first(data)) as unknown as RuntimeLease) : null;
  }
  async heartbeat(claim: AgentRuntimeClaim, leaseMs: number) {
    const data = await this.call("heartbeat_agent_runtime", { ...this.claim(claim), input_lease_ms: leaseMs });
    return clone((first(data)?.lease ?? data) as RuntimeLease);
  }
  async transition(claim: AgentRuntimeClaim, status: "running" | "waiting") {
    const data = await this.call("transition_agent_runtime", { ...this.claim(claim), input_status: status });
    return clone((first(data)?.runtime ?? data) as AgentRuntime);
  }
  async publish(claim: AgentRuntimeClaim, output: AgentStructuredOutput, quotas: AgentRuntimeQuotas) {
    validateStructuredOutput(output, quotas.outputBytes);
    const data = await this.call("publish_agent_runtime_output", {
      ...this.claim(claim), input_output: output, input_max_output_bytes: quotas.outputBytes,
    });
    return clone((first(data)?.output ?? data) as VersionedAgentRuntimeOutput);
  }
  async fail(claim: AgentRuntimeClaim, code: AgentRuntimeFailureCode, message: string, quotas: AgentRuntimeQuotas) {
    const data = await this.call("fail_agent_runtime", {
      ...this.claim(claim), input_code: code, input_message: message, input_max_retries: quotas.retries,
    });
    return clone((first(data)?.runtime ?? data) as AgentRuntime);
  }
  async cancel(tenantId: string, runtimeId: string) {
    const data = await this.call("cancel_agent_runtime", { input_tenant_id: tenantId, input_runtime_id: runtimeId });
    return clone((first(data)?.runtime ?? data) as AgentRuntime);
  }
  async supersede(tenantId: string, runtimeId: string, supersededBy: string) {
    const data = await this.call("supersede_agent_runtime", {
      input_tenant_id: tenantId, input_runtime_id: runtimeId, input_superseded_by: supersededBy,
    });
    return clone((first(data)?.runtime ?? data) as AgentRuntime);
  }
  async recover(now = new Date(), quotas?: AgentRuntimeQuotas) {
    const data = await this.call("recover_agent_runtimes", {
      input_now: now.toISOString(), input_max_retries: quotas?.retries ?? 2,
      input_max_runtime_ms: quotas?.runtimeDurationMs ?? 120_000,
    });
    return Number(first(data)?.recovered_count ?? data ?? 0);
  }
  async outputs(tenantId: string, runtimeId: string) {
    const data = await this.call("list_agent_runtime_outputs", {
      input_tenant_id: tenantId, input_runtime_id: runtimeId,
    });
    return clone((first(data)?.outputs ?? data ?? []) as VersionedAgentRuntimeOutput[]);
  }
  async metrics() {
    const data = await this.call("agent_runtime_metrics");
    return clone((first(data)?.metrics ?? data) as AgentRuntimeMetrics);
  }
  async collect(tenantId: string, retentionCount: number) {
    const data = await this.call("collect_agent_runtimes", {
      input_tenant_id: tenantId, input_retention_count: retentionCount,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }
  async verify() {
    this.registry.verify();
    const data = await this.call("verify_agent_runtime_contract", {
      input_runtime_version: AGENT_RUNTIME_VERSION,
      input_capabilities: this.registry.list(),
    });
    if (first(data)?.valid !== true && data !== true) {
      throw new AgentRuntimeError("agent_runtime_startup_validation_failed", "Agent runtime contract is invalid.");
    }
  }
  private claim(input: AgentRuntimeClaim): Record<string, unknown> {
    return {
      input_tenant_id: input.tenantId, input_runtime_id: input.runtimeId,
      input_execution_version: input.executionVersion,
      input_work_unit_version: input.workUnitVersion, input_worker_id: input.workerId,
      input_claim_token: input.claimToken,
    };
  }
}

export const runtimeAgentRuntimeStore: AgentRuntimeStore =
  new PostgresAgentRuntimeStore(supabase);
