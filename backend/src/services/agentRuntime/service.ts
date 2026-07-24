import { env } from "../../config/env.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import type {
  AgentRuntimeClaim,
  AgentRuntimeStore,
  CreateAgentRuntimeInput,
} from "./store.js";
import { runtimeAgentRuntimeStore } from "./store.js";
import type {
  AgentRuntimeFailureCode,
  AgentRuntimeQuotas,
  AgentStructuredOutput,
} from "./types.js";

export const runtimeAgentQuotas: AgentRuntimeQuotas = Object.freeze({
  activeRuntimes: env.AGENT_RUNTIME_MAX_ACTIVE,
  leasedWorkUnits: env.AGENT_RUNTIME_MAX_LEASED,
  runtimeDurationMs: env.AGENT_RUNTIME_MAX_DURATION_MS,
  retries: env.AGENT_RUNTIME_MAX_RETRIES,
  outputBytes: env.AGENT_RUNTIME_MAX_OUTPUT_BYTES,
  concurrentAgents: env.AGENT_RUNTIME_MAX_CONCURRENT_AGENTS,
  retentionCount: env.AGENT_RUNTIME_RETENTION_COUNT,
});

export class AgentRuntimeScheduler {
  constructor(
    private readonly store: AgentRuntimeStore = runtimeAgentRuntimeStore,
    private readonly quotas: AgentRuntimeQuotas = runtimeAgentQuotas,
  ) {}

  create(input: CreateAgentRuntimeInput) {
    return this.store.create(input, this.quotas);
  }

  get(tenantId: string, runtimeId: string) {
    return this.store.get(tenantId, runtimeId);
  }

  async leaseNext(tenantId: string, workerId: string, leaseMs = env.AGENT_RUNTIME_LEASE_MS) {
    const lease = await this.store.leaseNext(tenantId, workerId, leaseMs, this.quotas);
    await this.recordMetrics();
    return lease;
  }

  heartbeat(claim: AgentRuntimeClaim, leaseMs = env.AGENT_RUNTIME_LEASE_MS) {
    return this.store.heartbeat(claim, leaseMs);
  }

  transition(claim: AgentRuntimeClaim, status: "running" | "waiting") {
    return this.store.transition(claim, status);
  }

  async publish(claim: AgentRuntimeClaim, output: AgentStructuredOutput) {
    const result = await this.store.publish(claim, output, this.quotas);
    await this.recordMetrics();
    return result;
  }

  async fail(claim: AgentRuntimeClaim, code: AgentRuntimeFailureCode, message: string) {
    const result = await this.store.fail(claim, code, message, this.quotas);
    await this.recordMetrics();
    return result;
  }

  cancel(tenantId: string, runtimeId: string) {
    return this.store.cancel(tenantId, runtimeId);
  }

  supersede(tenantId: string, runtimeId: string, supersededBy: string) {
    return this.store.supersede(tenantId, runtimeId, supersededBy);
  }

  private async recordMetrics(): Promise<void> {
    runtimeMetrics.recordAgentRuntime(await this.store.metrics());
  }
}

export const runtimeAgentRuntimeScheduler = new AgentRuntimeScheduler();
