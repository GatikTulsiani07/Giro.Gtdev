import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { stableHash } from "../services/repositoryExecution/determinism.js";
import { builtInTools } from "../services/toolInvocation/builtins.js";
import { ToolRegistry } from "../services/toolInvocation/registry.js";
import { ToolInvocationService } from "../services/toolInvocation/service.js";
import { MemoryToolInvocationStore } from "../services/toolInvocation/store.js";
import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolInvocationIdentity,
  ToolInvocationQuotas,
} from "../services/toolInvocation/types.js";
import { ToolInvocationError } from "../services/toolInvocation/types.js";
import { FORBIDDEN_TOOL_CAPABILITIES } from "../services/toolInvocation/validation.js";

const now = new Date("2026-07-25T00:00:00.000Z");
const quotas: ToolInvocationQuotas = {
  invocationsPerRuntime: 10,
  parallelInvocations: 2,
  durationMs: 10_000,
  inputBytes: 100_000,
  outputBytes: 1_000_000,
  storedDiagnosticsBytes: 100_000,
  retries: 2,
  retentionCount: 2,
};

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    tenantId: "user-1",
    repositorySnapshot: {
      version: "rev-1",
      published: true,
      payload: { files: [{ path: "src/a.ts" }, { path: "src/b.ts" }] },
    },
    retrievalBundle: {
      version: "retrieval-1",
      published: true,
      payload: {
        candidates: [
          { filePath: "src/b.ts", content: "beta alpha", score: 0.2 },
          { filePath: "src/a.ts", content: "alpha", score: 0.8 },
        ],
        diagnostics: [{ code: "retrieval_ready" }],
        metrics: { candidates: 2 },
      },
    },
    graph: {
      version: "graph-1",
      published: true,
      payload: {
        nodes: [
          { nodeId: "a", name: "alpha", file: "src/a.ts" },
          { nodeId: "b", name: "beta", file: "src/b.ts" },
        ],
        edges: [{ source: "a", target: "b", kind: "imports" }],
      },
    },
    intelligence: {
      version: "intel-1",
      published: true,
      payload: { modules: ["src"], diagnostics: [] },
    },
    planning: {
      version: "plan-1",
      published: true,
      payload: { status: "published", steps: ["inspect"] },
    },
    executionMetadata: {
      executionId: "execution-1",
      executionVersion: "execution-v1",
      workUnitId: "work-1",
      workUnitVersion: "work-v1",
      repositoryId: "repo-1",
      repositoryRevision: "rev-1",
      ownerId: "user-1",
      leased: true,
      leaseOwnerId: "runtime-1",
      leaseExpiresAt: "2099-07-25T01:00:00.000Z",
    },
    runtimeMetadata: {
      runtimeId: "runtime-1",
      healthy: true,
      ownerId: "user-1",
      allowedPermissions: [
        "retrieval", "graph_traversal", "intelligence_lookup",
        "planning", "diagnostics", "metrics",
      ],
    },
    ...overrides,
  };
}

function customTool(
  id: string,
  handler: RegisteredTool["handler"],
  version = `${id.replace("internal.", "")}-v1`,
): RegisteredTool {
  const capability = {
    toolId: id,
    version,
    category: "Diagnostics" as const,
    description: "A bounded deterministic test tool.",
    inputSchema: {
      type: "object" as const,
      properties: { value: { type: "string" as const, minLength: 1, maxLength: 20 } },
      required: ["value"],
      additionalProperties: false,
    },
    outputSchema: { type: "object" as const, additionalProperties: true },
    requiredPermissions: ["diagnostics"] as const,
    forbiddenCapabilities: FORBIDDEN_TOOL_CAPABILITIES,
    timeoutMs: 50,
    resourceLimits: {
      inputBytes: 1_000,
      outputBytes: 10_000,
      diagnosticsBytes: 1_000,
      resultItems: 10,
      traversalDepth: 1,
    },
  };
  return {
    definition: {
      ...capability,
      capabilityHash: stableHash(capability),
      lifecycle: "registered",
    },
    handler,
  };
}

test("built-in registration is deterministic, loaded, ready, versioned, and complete", () => {
  const first = new ToolRegistry();
  const second = new ToolRegistry();
  assert.equal(first.list().length, 10);
  assert.deepEqual(first.list(), second.list());
  assert.equal(first.capabilityManifestHash(), second.capabilityManifestHash());
  assert.ok(first.list().every((tool) =>
    tool.lifecycle === "ready" &&
    tool.toolId.startsWith("internal.") &&
    /^[0-9a-f]{64}$/.test(tool.capabilityHash)));
});

test("registry rejects unsafe or incomplete permission declarations", () => {
  const valid = customTool("internal.permission-test", () => ({ payload: {} }));
  const unsafe = {
    ...valid,
    definition: {
      ...valid.definition,
      forbiddenCapabilities: valid.definition.forbiddenCapabilities.filter(
        (capability) => capability !== "shell_execution",
      ),
    },
  };
  assert.throws(() => new ToolRegistry([unsafe]), (error: unknown) =>
    error instanceof ToolInvocationError &&
    error.code === "invalid_tool_capability_boundary");
});

test("deterministic invocation replays the atomically published versioned result", async () => {
  const store = new MemoryToolInvocationStore();
  const service = new ToolInvocationService(store, new ToolRegistry(), quotas, () => now);
  const request = {
    toolId: "internal.hybrid-retrieval-v2",
    toolVersion: "hybrid-retrieval-v2-v1",
    input: { query: "alpha", limit: 2 },
    idempotencyKey: "retrieval-1",
  };
  const first = await service.invoke(request, context());
  const replay = await service.invoke(request, context());
  assert.equal(first.invocation.status, "succeeded");
  assert.equal(first.output?.version, request.toolVersion);
  assert.equal(first.invocation.outputHash, stableHash(first.output));
  assert.equal(replay.invocation.invocationId, first.invocation.invocationId);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.output, first.output);
  assert.equal(replay.invocation.metrics.cacheHits, first.invocation.metrics.cacheHits + 1);
});

test("schema, health, lease, ownership, revision, permission, and version fences fail structurally", async () => {
  const service = new ToolInvocationService(
    new MemoryToolInvocationStore(), new ToolRegistry(), quotas, () => now,
  );
  const request = {
    toolId: "internal.file-lookup",
    toolVersion: "file-lookup-tool-v1",
    input: { query: "" },
  };
  await assert.rejects(() => service.invoke(request, context()), (error: unknown) =>
    error instanceof ToolInvocationError && error.failure.kind === "validation");
  await assert.rejects(() => service.invoke(
    { ...request, input: { query: "src" } },
    context({ runtimeMetadata: { ...context().runtimeMetadata, healthy: false } }),
  ), (error: unknown) => error instanceof ToolInvocationError && error.code === "runtime_unhealthy");
  await assert.rejects(() => service.invoke(
    { ...request, input: { query: "src" } },
    context({ repositorySnapshot: { version: "rev-2", published: true, payload: {} } }),
  ), (error: unknown) =>
    error instanceof ToolInvocationError && error.code === "repository_revision_mismatch");
  await assert.rejects(() => service.invoke(
    { ...request, input: { query: "src" } },
    context({ runtimeMetadata: { ...context().runtimeMetadata, allowedPermissions: [] } }),
  ), (error: unknown) =>
    error instanceof ToolInvocationError && error.failure.kind === "permission");
  await assert.rejects(() => service.invoke(
    { ...request, toolVersion: "file-lookup-tool-v2", input: { query: "src" } },
    context(),
  ), (error: unknown) => error instanceof ToolInvocationError && error.code === "tool_not_found");
});

test("timeouts and retries are persisted as structured failures without outputs", async () => {
  const slow = customTool("internal.slow-test", async (_input, _context, signal) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      setTimeout(() => resolve({ payload: { late: true } }), 500);
    }));
  const registry = new ToolRegistry([slow]);
  const store = new MemoryToolInvocationStore();
  const service = new ToolInvocationService(store, registry, { ...quotas, retries: 1 });
  const result = await service.invoke({
    toolId: slow.definition.toolId,
    toolVersion: slow.definition.version,
    input: { value: "slow" },
    timeoutMs: 5,
  }, context());
  assert.equal(result.invocation.status, "failed");
  assert.equal(result.invocation.failure?.kind, "timeout");
  assert.equal(result.invocation.retries, 1);
  assert.equal(result.invocation.metrics.timeouts, 1);
  assert.equal(result.output, null);
});

test("retryable tools retry, publish once, and expose the metrics contract", async () => {
  let attempts = 0;
  const flaky = customTool("internal.flaky-test", () => {
    attempts += 1;
    if (attempts < 2) throw new Error("temporary");
    return { payload: { attempts } };
  });
  const store = new MemoryToolInvocationStore();
  const service = new ToolInvocationService(store, new ToolRegistry([flaky]), quotas);
  const result = await service.invoke({
    toolId: flaky.definition.toolId,
    toolVersion: flaky.definition.version,
    input: { value: "retry" },
  }, context());
  assert.equal(result.invocation.status, "succeeded");
  assert.equal(result.invocation.retries, 1);
  assert.equal(result.output?.metrics.retryCount, 1);
  assert.deepEqual(Object.keys(await service.metrics()).sort(), [
    "cacheHits", "cacheMisses", "diagnosticGeneration", "failures", "latencyMs",
    "payloadBytes", "retryCount", "timeouts", "usage",
  ]);
});

test("store enforces deterministic conflicts, quotas, tenant isolation, recovery, and retention", async () => {
  const store = new MemoryToolInvocationStore();
  const base: ToolInvocationIdentity = {
    invocationId: `tool_invocation_${"a".repeat(24)}`,
    tenantId: "user-1",
    executionId: "execution-1",
    executionVersion: "execution-v1",
    workUnitId: "work-1",
    workUnitVersion: "work-v1",
    runtimeId: "runtime-1",
    repositoryId: "repo-1",
    repositoryRevision: "rev-1",
    toolId: "internal.metrics",
    toolVersion: "metrics-tool-v1",
    inputHash: "b".repeat(64),
    timeoutMs: 10,
    timestamp: now.toISOString(),
  };
  await store.begin(base, { ...quotas, parallelInvocations: 1 });
  await assert.rejects(() => store.begin({ ...base, inputHash: "c".repeat(64) }, quotas),
    (error: unknown) => error instanceof ToolInvocationError &&
      error.code === "tool_invocation_conflict");
  assert.equal(await store.get("user-2", base.invocationId), null);
  assert.equal(await store.recover(new Date(now.getTime() + 11)), 1);
  const recovered = await store.get("user-1", base.invocationId);
  assert.equal(recovered?.invocation.failure?.code, "unfinished_tool_invocation");
  assert.equal(recovered?.invocation.retries, 1);
  assert.equal(await store.collect("user-1", 1), 0);
});

test("all built-in tools return structured data without mutation capabilities", async () => {
  const store = new MemoryToolInvocationStore();
  const registry = new ToolRegistry();
  const service = new ToolInvocationService(store, registry, quotas, () => now);
  const inputs: Record<string, unknown> = {
    "internal.hybrid-retrieval-v2": { query: "alpha", limit: 10 },
    "internal.repository-graph": { nodeId: "a", maxDepth: 2 },
    "internal.repository-intelligence": { query: "modules" },
    "internal.repository-planning": {},
    "internal.repository-statistics": {},
    "internal.dependency-lookup": { symbol: "a" },
    "internal.symbol-lookup": { query: "alpha", limit: 10 },
    "internal.file-lookup": { query: "src", limit: 10 },
    "internal.diagnostics": {},
    "internal.metrics": {},
  };
  for (const tool of builtInTools()) {
    const result = await service.invoke({
      toolId: tool.definition.toolId,
      toolVersion: tool.definition.version,
      input: inputs[tool.definition.toolId],
    }, context());
    assert.equal(result.invocation.status, "succeeded", tool.definition.toolId);
    assert.equal(typeof result.output?.payload, "object");
    assert.deepEqual(tool.definition.forbiddenCapabilities, FORBIDDEN_TOOL_CAPABILITIES);
  }
});

test("migration contract covers durable entities, RLS, grants, indexes, constraints, and recovery", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260810000000_add_tool_invocation_framework.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "tool_registry", "tool_versions", "tool_invocations", "tool_invocation_outputs",
    "tool_invocation_diagnostics", "tool_invocation_metrics", "tool_invocation_retention",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.%I enable row level security`));
  }
  assert.match(migration, /references public\.tool_versions\(tool_id,tool_version\) on delete cascade/);
  assert.match(migration, /tool_invocations_active_idx/);
  assert.match(migration, /grant execute on function public\.begin_tool_invocation/);
  assert.match(migration, /recover_tool_invocations/);
  assert.match(migration, /verify_tool_invocation_contract/);
});
