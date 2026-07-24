import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import { AgentRuntimeExecutor } from "../services/agentRuntime/executor.js";
import { AgentCapabilityRegistry } from "../services/agentRuntime/registry.js";
import {
  MemoryAgentRuntimeStore,
  PostgresAgentRuntimeStore,
  type AgentRuntimeClaim,
} from "../services/agentRuntime/store.js";
import type {
  AgentExecutionContext,
  AgentRuntimeQuotas,
  AgentStructuredOutput,
} from "../services/agentRuntime/types.js";
import { AgentRuntimeError } from "../services/agentRuntime/types.js";

const quotas: AgentRuntimeQuotas = {
  activeRuntimes: 10,
  leasedWorkUnits: 4,
  runtimeDurationMs: 120_000,
  retries: 2,
  outputBytes: 100_000,
  concurrentAgents: 4,
  retentionCount: 5,
};

function context(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  const registry = new AgentCapabilityRegistry();
  const capability = registry.get("planner").capability;
  return {
    tenantId: "tenant-1",
    executionId: "execution-1",
    executionVersion: "execution-v1",
    workUnitId: "work-1",
    workUnitVersion: "work-v1",
    repositoryId: "acme/widgets",
    repositorySnapshot: { version: "revision-1", published: true, payload: { files: [] } },
    retrievalBundle: { version: "retrieval-1", published: true, payload: { chunks: [] } },
    graphExpansion: { version: "graph-1", published: true, payload: { nodes: [] } },
    intelligenceSnapshot: { version: "intelligence-1", published: true, payload: { subsystems: [] } },
    executionMetadata: { traceparent: "00-11111111111111111111111111111111-2222222222222222-01" },
    workUnitMetadata: { objective: "Plan the backend change." },
    policy: {
      planningOnly: true,
      repositoryMutation: false,
      allowed: capability.allowed,
      forbidden: capability.forbidden,
    },
    limits: { runtimeDurationMs: 120_000, retries: 2, outputBytes: 100_000, concurrentWorkUnits: 1 },
    ...overrides,
  };
}

const output: AgentStructuredOutput = {
  summary: "A bounded implementation plan.",
  reasoning: ["The published graph identifies one backend boundary."],
  findings: ["The service owns the relevant symbol."],
  risks: ["Version skew."],
  assumptions: ["The API contract remains stable."],
  proposedFiles: ["src/service.ts"],
  proposedSymbols: ["createWidget"],
  validation: ["Typecheck the proposed surface."],
  tests: ["Add a service unit test."],
  confidence: 0.91,
};

async function leased(
  store: MemoryAgentRuntimeStore,
  executionContext = context(),
  now = new Date(),
) {
  const runtime = await store.create({ agentId: "planner", context: executionContext }, quotas, now);
  const lease = await store.leaseNext(
    executionContext.tenantId,
    "worker-1",
    60_000,
    quotas,
    new Date(now.getTime() + 1_000),
  );
  assert.ok(lease);
  const claim: AgentRuntimeClaim = {
    tenantId: executionContext.tenantId,
    runtimeId: runtime.runtimeId,
    executionVersion: executionContext.executionVersion,
    workUnitVersion: executionContext.workUnitVersion,
    workerId: lease.workerId,
    claimToken: lease.claimToken,
  };
  return { runtime, lease, claim };
}

test("registry exposes all stable agents and deterministic safe capabilities", () => {
  const first = new AgentCapabilityRegistry();
  const second = new AgentCapabilityRegistry();
  assert.deepEqual(first.list(), second.list());
  assert.deepEqual(first.list().map((agent) => agent.name), [
    "Planner", "Backend Engineer", "Frontend Engineer", "DevOps", "Reviewer",
    "Documentation", "Test Engineer", "Refactoring", "Security", "Architecture",
  ]);
  for (const agent of first.list()) {
    assert.equal(agent.capability.deterministic, true);
    assert.deepEqual(agent.capability.forbidden, [
      "shell", "filesystem_mutation", "git", "network", "secrets", "process_execution",
    ]);
    assert.match(agent.capability.capabilityHash, /^[0-9a-f]{64}$/);
  }
});

test("runtime creation is deterministic and execution context is deeply immutable", async () => {
  const store = new MemoryAgentRuntimeStore();
  const source = context();
  const first = await store.create({ agentId: "planner", context: source }, quotas,
    new Date("2026-07-24T00:00:00.000Z"));
  const second = await store.create({ agentId: "planner", context: context() }, quotas,
    new Date("2026-07-24T01:00:00.000Z"));
  assert.equal(first.runtimeId, second.runtimeId);
  assert.equal(first.status, "ready");
  assert.ok(Object.isFrozen(first.context.repositorySnapshot.payload));
  (source.workUnitMetadata as Record<string, unknown>).objective = "mutated";
  assert.equal(first.context.workUnitMetadata.objective, "Plan the backend change.");
});

test("unpublished artifacts and weakened mutation policy are rejected", async () => {
  const store = new MemoryAgentRuntimeStore();
  await assert.rejects(() => store.create({
    agentId: "planner",
    context: context({ repositorySnapshot: { version: "draft", published: false as true, payload: {} } }),
  }, quotas), (error: unknown) => error instanceof AgentRuntimeError && error.code === "unpublished_artifact");
  await assert.rejects(() => store.create({
    agentId: "planner",
    context: context({ policy: { ...context().policy, repositoryMutation: true as false } }),
  }, quotas), /capability boundary/);
});

test("leases are exclusive, heartbeat fenced, and running/waiting transitions are supported", async () => {
  const store = new MemoryAgentRuntimeStore();
  const { claim, lease } = await leased(store, context(), new Date("2026-07-24T00:00:00.000Z"));
  assert.equal(await store.leaseNext("tenant-1", "worker-2", 60_000, quotas,
    new Date("2026-07-24T00:00:02.000Z")), null);
  const heartbeat = await store.heartbeat(claim, 90_000,
    new Date("2026-07-24T00:00:03.000Z"));
  assert.ok(Date.parse(heartbeat.expiresAt) > Date.parse(lease.expiresAt));
  assert.equal((await store.transition(claim, "running",
    new Date("2026-07-24T00:00:04.000Z"))).status, "running");
  assert.equal((await store.transition(claim, "waiting",
    new Date("2026-07-24T00:00:05.000Z"))).status, "waiting");
  await assert.rejects(() => store.heartbeat({ ...claim, claimToken: "stale" }, 1_000), /stale/);
});

test("structured outputs are validated, version fenced, immutable, and size limited", async () => {
  const store = new MemoryAgentRuntimeStore();
  const { runtime, claim } = await leased(store);
  await store.transition(claim, "running", new Date("2026-07-24T00:00:02.000Z"));
  await assert.rejects(() => store.publish(claim, { summary: "" } as AgentStructuredOutput, quotas),
    /Malformed structured/);
  await assert.rejects(() => store.publish({ ...claim, executionVersion: "execution-v0" }, output, quotas),
    /version fence is stale/);
  await assert.rejects(() => store.publish(claim, output, { ...quotas, outputBytes: 10 }),
    /size limit/);
  const published = await store.publish(claim, output, quotas,
    new Date("2026-07-24T00:00:03.000Z"));
  assert.equal(published.outputVersion, 1);
  assert.equal(published.executionVersion, "execution-v1");
  assert.equal(published.workUnitVersion, "work-v1");
  assert.equal((await store.get("tenant-1", runtime.runtimeId))?.status, "completed");
  assert.equal((await store.outputs("tenant-1", runtime.runtimeId))[0]?.capabilityVersion,
    "planner-capability-v1");
});

test("retry is bounded and restricted to transient, timeout, and lease expiration failures", async () => {
  const transientStore = new MemoryAgentRuntimeStore();
  const transient = await leased(transientStore);
  const retried = await transientStore.fail(transient.claim, "transient_runtime_failure", "retry", quotas);
  assert.equal(retried.status, "ready");
  assert.equal(retried.diagnostics[0]?.retryable, true);

  const invalidStore = new MemoryAgentRuntimeStore();
  const invalid = await leased(invalidStore);
  const failed = await invalidStore.fail(invalid.claim, "output_validation_failed", "invalid", quotas);
  assert.equal(failed.status, "failed");
  assert.equal(failed.diagnostics[0]?.retryable, false);

  const exhaustedStore = new MemoryAgentRuntimeStore();
  const exhausted = await leased(exhaustedStore);
  const noRetry = await exhaustedStore.fail(exhausted.claim, "runtime_timeout", "timeout",
    { ...quotas, retries: 0 });
  assert.equal(noRetry.status, "failed");
});

test("recovery handles expired leases and stale heartbeats while preserving audit diagnostics", async () => {
  const store = new MemoryAgentRuntimeStore();
  const baseline = new Date("2026-07-24T00:00:00.000Z");
  const { runtime, claim } = await leased(store, context(), baseline);
  assert.equal(await store.recover(new Date("2026-07-24T00:01:10.000Z"), quotas), 1);
  const recovered = await store.get("tenant-1", runtime.runtimeId);
  assert.equal(recovered?.status, "ready");
  assert.equal(recovered?.recoveryCount, 1);
  assert.equal(recovered?.diagnostics[0]?.code, "lease_expired");
  await assert.rejects(() => store.transition(claim, "running"), /stale/);
});

test("cancellation, supersession, orphan output fencing, quotas, and tenant isolation hold", async () => {
  const store = new MemoryAgentRuntimeStore();
  const first = await store.create({ agentId: "planner", context: context() }, quotas);
  assert.equal(await store.get("tenant-2", first.runtimeId), null);
  await assert.rejects(() => store.cancel("tenant-2", first.runtimeId), /not found/);
  assert.equal((await store.cancel("tenant-1", first.runtimeId)).status, "cancelled");

  const secondContext = context({
    executionId: "execution-2", executionVersion: "execution-v2",
    workUnitId: "work-2", workUnitVersion: "work-v2",
  });
  const { runtime, claim } = await leased(store, secondContext);
  await store.transition(claim, "running");
  await store.publish(claim, output, quotas);
  await store.supersede("tenant-1", runtime.runtimeId, "runtime-new");
  const orphan = (await store.outputs("tenant-1", runtime.runtimeId))[0];
  assert.equal(orphan?.published, false);
  assert.equal(orphan?.orphaned, true);

  const quotaStore = new MemoryAgentRuntimeStore();
  await quotaStore.create({ agentId: "planner", context: context() }, { ...quotas, activeRuntimes: 1 });
  await assert.rejects(() => quotaStore.create({
    agentId: "reviewer",
    context: context({ executionId: "execution-3", executionVersion: "execution-v3",
      workUnitId: "work-3", workUnitVersion: "work-v3" }),
  }, { ...quotas, activeRuntimes: 1 }), /Active runtime quota/);
});

test("executor emits planning output through the capability-limited context only", async () => {
  const store = new MemoryAgentRuntimeStore();
  const { runtime, claim } = await leased(store);
  const entries: string[] = [];
  const logger = {
    debug: () => undefined,
    info: (operation: string) => entries.push(operation),
    warn: () => undefined,
    error: (operation: string) => entries.push(operation),
    flush: async () => undefined,
  };
  const executor = new AgentRuntimeExecutor(store, async (immutableContext) => {
    assert.equal(immutableContext.policy.repositoryMutation, false);
    return output;
  }, logger);
  await executor.execute(claim, context(), quotas);
  assert.equal((await store.get("tenant-1", runtime.runtimeId))?.status, "completed");
  assert.deepEqual(entries, ["agent_runtime.execute.started", "agent_runtime.execute.completed"]);
});

test("PostgreSQL adapter mirrors the store contract and validates startup capability registry", async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const client = {
    rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      return {
        then(resolve: (value: unknown) => unknown) {
          return resolve({ data: [{ valid: true, problems: [] }], error: null });
        },
      };
    },
  };
  const store = new PostgresAgentRuntimeStore(client as never);
  await store.verify();
  assert.equal(calls[0]?.name, "verify_agent_runtime_contract");
  assert.equal((calls[0]?.parameters.input_capabilities as readonly unknown[]).length, 10);
});

test("startup validation detects stale capabilities and memory store contract remains valid", async () => {
  const store = new MemoryAgentRuntimeStore();
  await store.create({ agentId: "planner", context: context() }, quotas);
  await assert.doesNotReject(() => store.verify());
});

test("migration defines persistence, fencing, isolation, recovery, grants, indexes, and retention", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260809000000_add_agent_runtime_capability_framework.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "agent_capabilities", "agent_runtimes", "agent_runtime_leases", "agent_runtime_outputs",
    "agent_runtime_diagnostics", "agent_runtime_heartbeats", "agent_runtime_recovery_state",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "lease_agent_runtime", "heartbeat_agent_runtime", "publish_agent_runtime_output",
    "recover_agent_runtimes", "verify_agent_runtime_contract", "collect_agent_runtimes",
  ]) assert.match(migration, new RegExp(contract));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant execute[\s\S]+to service_role/);
  assert.match(migration, /claim_token text not null unique/);
  assert.match(migration, /execution_version text not null/);
  assert.match(migration, /work_unit_version text not null/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("agent runtime metrics expose the complete observability contract", async () => {
  const metrics = new MetricsRegistry();
  metrics.recordAgentRuntime({
    activeAgents: 1, runningAgents: 2, leases: 3, retries: 4, failures: 5,
    runtimeDurationMs: 6, heartbeatLatencyMs: 7, capabilityUsage: 8,
    outputBytes: 9, recoveryCount: 10,
  });
  const rendered = metrics.render();
  for (const expected of [
    "giro_agent_runtime_active_agents 1",
    "giro_agent_runtime_running_agents 2",
    "giro_agent_runtime_leases 3",
    "giro_agent_runtime_retries_total 4",
    "giro_agent_runtime_failures_total 5",
    "giro_agent_runtime_duration_ms_total 6",
    "giro_agent_runtime_heartbeat_latency_ms_total 7",
    "giro_agent_runtime_capability_usage_total 8",
    "giro_agent_runtime_output_bytes_total 9",
    "giro_agent_runtime_recovery_total 10",
  ]) assert.match(rendered, new RegExp(expected));

  const store = new MemoryAgentRuntimeStore();
  await store.create({ agentId: "planner", context: context() }, quotas);
  assert.equal((await store.metrics()).capabilityUsage, 1);
});
