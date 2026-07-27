import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";
import { MetricsRegistry } from "../observability/metrics.js";
import {
  AutonomousWorkflowOrchestrator,
} from "../services/autonomousWorkflow/service.js";
import { MemoryAutonomousWorkflowStore } from "../services/autonomousWorkflow/store.js";
import type {
  WorkflowServiceComposition,
} from "../services/autonomousWorkflow/composition.js";
import {
  MemoryEngineeringApiIdempotencyStore,
} from "../services/engineeringPlatformApi/idempotencyStore.js";
import {
  EngineeringPlatformApiService,
  type EngineeringPlatformApiDependencies,
} from "../services/engineeringPlatformApi/service.js";
import {
  engineeringPlatformOpenApi,
  verifyEngineeringPlatformApiContracts,
} from "../services/engineeringPlatformApi/openapi.js";
import { MemoryRepositoryStore } from "../services/repository/store/memoryRepositoryStore.js";
import { signAccessToken } from "../services/auth/jwt.js";

const USER = { userId: "api-user", email: "api@example.com" };
const OTHER_USER = { userId: "other-user", email: "other@example.com" };
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const COUNTS = {
  chunkCount: 1,
  fileCount: 1,
  symbolCount: 1,
  graphNodeCount: 1,
  graphEdgeCount: 0,
  summaryAvailable: true,
};

const composition: WorkflowServiceComposition = {
  async execute(stage, payload) {
    const executionId = payload && typeof payload === "object" &&
      "executionId" in payload && typeof payload.executionId === "string"
      ? payload.executionId : `${stage}-id`;
    return {
      result: {
        stage,
        referenceId: executionId,
        referenceVersion: "1",
        status: "published",
        outputHash: "a".repeat(64),
        metadata: {},
      },
      output: {},
    };
  },
  async approve() {},
  async cancel() {},
  async recoverDependencies() {
    return {
      intelligence: 0, planning: 0, execution: 0, agentRuntime: 0,
      toolInvocation: 0, collaboration: 0, workspace: 0, artifact: 0,
      review: 0, proposal: 0, apply: 0, knowledge: 0,
    };
  },
};

async function fixture(defaultApiLimit = 1_000) {
  const repositories = new MemoryRepositoryStore();
  repositories.connectRepository({
    owner: "acme",
    repo: "widgets",
    ownerUserId: USER.userId,
  });
  repositories.markIndexed("acme/widgets", {
    counts: COUNTS,
    indexedRevision: REVISION,
  });
  repositories.connectRepository({
    owner: "private",
    repo: "repo",
    ownerUserId: OTHER_USER.userId,
  });
  repositories.markIndexed("private/repo", {
    counts: COUNTS,
    indexedRevision: REVISION,
  });
  const workflowStore = new MemoryAutonomousWorkflowStore();
  const workflows = new AutonomousWorkflowOrchestrator(
    workflowStore, composition);
  const idempotency = new MemoryEngineeringApiIdempotencyStore();
  const lineage = { executionId: "" };
  const emptyEngine = {
    async verify() {},
    async get() { return null; },
  };
  const artifactEngine = {
    async verify() {},
    async get(_tenantId: string, artifactId: string) {
      if (!lineage.executionId || artifactId !== "artifact-id") return null;
      return {
        artifactId,
        workspaceId: "workspace-id",
        executionId: lineage.executionId,
        workUnitId: "work-unit-id",
        artifactVersion: 1,
        artifactType: "source_code",
        lifecycle: "approved",
        content: { proposalOnly: true, operations: [] },
        affectedFiles: ["src/index.ts"],
        affectedSymbols: ["main"],
        diagnostics: [],
        confidence: 1,
        warnings: [],
        generationMetadata: { engineVersion: "artifact-v1" },
        createdAt: "2099-01-01T00:00:00.000Z",
        updatedAt: "2099-01-01T00:00:00.000Z",
      };
    },
  };
  const stageEngine = (kind: string) => ({
    async verify() {},
    async get(_tenantId: string, resourceId: string) {
      if (!lineage.executionId || resourceId !== `${kind}-id`) return null;
      return {
        [`${kind === "apply" ? "transaction" : kind}Id`]: resourceId,
        executionId: lineage.executionId,
        lifecycle: kind === "review" ? "approved"
          : kind === "proposal" ? "approved" : "ready",
        tenantId: USER.userId,
        ownerId: USER.userId,
        leaseToken: "must-not-leak",
      };
    },
  });
  const knowledge = {
    ...emptyEngine,
    async retrieve() { return []; },
    async listMemories() { return []; },
  };
  const dependencies = {
    workflows,
    artifacts: artifactEngine,
    reviews: stageEngine("review"),
    proposals: stageEngine("proposal"),
    apply: stageEngine("apply"),
    knowledge,
    repositories,
    idempotency,
  } as unknown as EngineeringPlatformApiDependencies;
  const service = new EngineeringPlatformApiService(dependencies);
  const metrics = new MetricsRegistry();
  const app = createApp({
    engineeringPlatformApiService: service,
    metrics,
    rateLimitPolicy: {
      authentication: { windowMs: 60_000, maxRequests: 1_000, burst: 1_000 },
      repositoryConnect: { windowMs: 60_000, maxRequests: 1_000, burst: 1_000 },
      askGiro: { windowMs: 60_000, maxRequests: 1_000, burst: 1_000 },
      retrievalSearch: { windowMs: 60_000, maxRequests: 1_000, burst: 1_000 },
      indexingOperations: { windowMs: 60_000, maxRequests: 1_000, burst: 1_000 },
      defaultApi: {
        windowMs: 60_000,
        maxRequests: defaultApiLimit,
        burst: 0,
      },
    },
  });
  const token = await signAccessToken(USER);
  return {
    app,
    workflows,
    workflowStore,
    service,
    lineage,
    metrics,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

const CREATE_BODY = {
  repositoryId: "acme/widgets",
  repositoryRevision: REVISION,
  task: "Add deterministic API coverage",
  executionConfiguration: {
    policy: "review_only",
    maxParallelism: 2,
  },
};

async function createWorkflow(
  f: Awaited<ReturnType<typeof fixture>>,
  key = "create-1",
) {
  const response = await f.app.request("/api/v1/workflows", {
    method: "POST",
    headers: { ...f.headers, "Idempotency-Key": key },
    body: JSON.stringify(CREATE_BODY),
  });
  return {
    response,
    body: await response.json() as any,
  };
}

test("engineering API requires authentication and returns correlation IDs", async () => {
  const f = await fixture();
  const response = await f.app.request("/api/v1/workflows", {
    headers: { "X-Request-ID": "api-correlation-1" },
  });
  const body = await response.json() as any;
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("X-Request-ID"), "api-correlation-1");
  assert.equal(body.requestId, "api-correlation-1");
  assert.equal(body.error.code, "unauthorized");
});

test("engineering API uses the existing authenticated rate limiter", async () => {
  const f = await fixture(1);
  const first = await f.app.request("/api/v1/workflows", {
    headers: f.headers,
  });
  const second = await f.app.request("/api/v1/workflows", {
    headers: f.headers,
  });
  const body = await second.json() as any;
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(body.error.code, "rate_limited");
  assert.equal(second.headers.get("X-RateLimit-Remaining"), "0");
});

test("workflow creation is durable, deterministic, safe, and idempotent", async () => {
  const f = await fixture();
  const first = await createWorkflow(f);
  const replay = await createWorkflow(f);
  assert.equal(first.response.status, 201);
  assert.equal(replay.response.status, 201);
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual(replay.body.data, first.body.data);
  assert.equal(first.body.data.repositoryId, "acme/widgets");
  assert.equal(first.body.data.version, 1);
  assert.equal(first.response.headers.get("ETag"), "\"1\"");
  assert.equal("ownerId" in first.body.data, false);
  assert.equal("tenantId" in first.body.data, false);
  assert.equal("leaseToken" in first.body.data, false);
  const fetched = await f.app.request(
    `/api/v1/workflows/${first.body.data.workflowId}`,
    { headers: f.headers },
  );
  const fetchedBody = await fetched.json() as any;
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetchedBody.data, first.body.data);
});

test("idempotency conflicts, ownership, and repository revisions fail closed", async () => {
  const f = await fixture();
  await createWorkflow(f, "conflicting");
  const conflict = await f.app.request("/api/v1/workflows", {
    method: "POST",
    headers: { ...f.headers, "Idempotency-Key": "conflicting" },
    body: JSON.stringify({ ...CREATE_BODY, task: "different" }),
  });
  assert.equal(conflict.status, 409);

  const forbidden = await f.app.request("/api/v1/workflows", {
    method: "POST",
    headers: { ...f.headers, "Idempotency-Key": "forbidden" },
    body: JSON.stringify({
      ...CREATE_BODY,
      repositoryId: "private/repo",
    }),
  });
  assert.equal(forbidden.status, 403);

  const stale = await f.app.request("/api/v1/workflows", {
    method: "POST",
    headers: { ...f.headers, "Idempotency-Key": "stale-revision" },
    body: JSON.stringify({
      ...CREATE_BODY,
      repositoryRevision: "f".repeat(40),
    }),
  });
  assert.equal(stale.status, 412);
});

test("workflow lists and immutable history use deterministic cursors", async () => {
  const f = await fixture();
  await createWorkflow(f, "list-1");
  await f.app.request("/api/v1/workflows", {
    method: "POST",
    headers: { ...f.headers, "Idempotency-Key": "list-2" },
    body: JSON.stringify({ ...CREATE_BODY, task: "second task" }),
  });
  const first = await f.app.request("/api/v1/workflows?limit=1", {
    headers: f.headers,
  });
  const firstBody = await first.json() as any;
  assert.equal(firstBody.data.items.length, 1);
  assert.ok(firstBody.data.nextCursor);
  const second = await f.app.request(
    `/api/v1/workflows?limit=1&cursor=${firstBody.data.nextCursor}`,
    { headers: f.headers },
  );
  const secondBody = await second.json() as any;
  assert.equal(secondBody.data.items.length, 1);
  assert.notEqual(
    secondBody.data.items[0].workflowId,
    firstBody.data.items[0].workflowId,
  );
  const workflowId = firstBody.data.items[0].workflowId;
  const history = await f.app.request(
    `/api/v1/workflows/${workflowId}/history?limit=1`,
    { headers: f.headers },
  );
  const historyBody = await history.json() as any;
  assert.equal(historyBody.data.items[0].version, 1);
  assert.deepEqual(historyBody.data.items[0].diagnostics.codes, []);
});

test("workflow actions enforce If-Match and replay the original response", async () => {
  const f = await fixture();
  const created = await createWorkflow(f, "cancel-create");
  const workflowId = created.body.data.workflowId;
  const missingFence = await f.app.request(
    `/api/v1/workflows/${workflowId}/cancel`,
    {
      method: "POST",
      headers: { ...f.headers, "Idempotency-Key": "cancel-missing" },
    },
  );
  assert.equal(missingFence.status, 412);

  const cancelHeaders = {
    ...f.headers,
    "Idempotency-Key": "cancel-1",
    "If-Match": "\"1\"",
  };
  const cancelled = await f.app.request(
    `/api/v1/workflows/${workflowId}/cancel`,
    { method: "POST", headers: cancelHeaders },
  );
  const cancelledBody = await cancelled.json() as any;
  assert.equal(cancelled.status, 200);
  assert.equal(cancelledBody.data.lifecycle, "cancelled");

  const replay = await f.app.request(
    `/api/v1/workflows/${workflowId}/cancel`,
    { method: "POST", headers: cancelHeaders },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");

  const stale = await f.app.request(
    `/api/v1/workflows/${workflowId}/cancel`,
    {
      method: "POST",
      headers: {
        ...f.headers,
        "Idempotency-Key": "cancel-stale",
        "If-Match": "\"1\"",
      },
    },
  );
  const staleBody = await stale.json() as any;
  assert.equal(stale.status, 412);
  assert.equal(staleBody.error.code, "precondition_failed");
  assert.doesNotMatch(JSON.stringify(staleBody), /workflow version is stale/i);
});

test("illegal approval, retry, resume, and replay transitions fail closed", async () => {
  const f = await fixture();
  const created = await createWorkflow(f, "illegal-actions");
  for (const actionName of ["approve", "retry", "resume", "replay"]) {
    const response = await f.app.request(
      `/api/v1/workflows/${created.body.data.workflowId}/${actionName}`,
      {
        method: "POST",
        headers: {
          ...f.headers,
          "Idempotency-Key": `illegal-${actionName}`,
          "If-Match": "\"1\"",
        },
      },
    );
    const body = await response.json() as any;
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "conflict");
  }
});

test("unavailable lineage resources return safe empty collections or 404", async () => {
  const f = await fixture();
  const created = await createWorkflow(f);
  const workflowId = created.body.data.workflowId;
  const artifacts = await f.app.request(
    `/api/v1/workflows/${workflowId}/artifacts`,
    { headers: f.headers },
  );
  const artifactBody = await artifacts.json() as any;
  assert.equal(artifacts.status, 200);
  assert.deepEqual(artifactBody.data.items, []);
  for (const path of ["review", "proposal", "apply-plan"]) {
    const response = await f.app.request(
      `/api/v1/workflows/${workflowId}/${path}`,
      { headers: f.headers },
    );
    assert.equal(response.status, 404);
  }
});

test("artifact, review, proposal, and apply resources enforce workflow lineage", async () => {
  const f = await fixture();
  const created = await createWorkflow(f, "lineage-create");
  let workflow = await f.service.getWorkflow(
    USER.userId, created.body.data.workflowId);
  f.lineage.executionId = workflow.executionId;
  for (const stage of [
    "intelligence", "planning", "execution",
  ] as const) {
    workflow = (await f.workflows.advance({
      tenantId: USER.userId,
      workflowId: workflow.workflowId,
      ownerId: USER.userId,
      expectedWorkflowVersion: workflow.workflowVersion,
      request: {
        stage,
        payload: stage === "execution"
          ? { executionId: workflow.executionId } : {},
      },
    })).workflow;
  }
  const approval = await f.app.request(
    `/api/v1/workflows/${workflow.workflowId}/approve`,
    {
      method: "POST",
      headers: {
        ...f.headers,
        "Idempotency-Key": "lineage-approval",
        "If-Match": `\"${workflow.workflowVersion}\"`,
      },
    },
  );
  assert.equal(approval.status, 200);
  workflow = await f.service.getWorkflow(USER.userId, workflow.workflowId);
  for (const stage of [
    "agent_runtime", "tool_invocation", "collaboration", "workspace", "patch",
    "artifact", "review", "proposal", "apply",
  ] as const) {
    workflow = (await f.workflows.advance({
      tenantId: USER.userId,
      workflowId: workflow.workflowId,
      ownerId: USER.userId,
      expectedWorkflowVersion: workflow.workflowVersion,
      request: { stage, payload: {} },
    })).workflow;
  }
  const artifact = await f.app.request(
    `/api/v1/workflows/${workflow.workflowId}/artifacts/artifact-id`,
    { headers: f.headers },
  );
  assert.equal(artifact.status, 200);
  const wrongArtifact = await f.app.request(
    `/api/v1/workflows/${workflow.workflowId}/artifacts/other-id`,
    { headers: f.headers },
  );
  assert.equal(wrongArtifact.status, 404);
  for (const path of ["review", "proposal", "apply-plan"]) {
    const response = await f.app.request(
      `/api/v1/workflows/${workflow.workflowId}/${path}`,
      { headers: f.headers },
    );
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal("tenantId" in body.data, false);
    assert.equal("ownerId" in body.data, false);
    assert.equal("leaseToken" in body.data, false);
  }
});

test("knowledge filters, API metrics, OpenAPI, and startup contracts are stable", async () => {
  const f = await fixture();
  const knowledge = await f.app.request(
    "/api/v1/repositories/acme/widgets/knowledge" +
    "?namespace=architecture&minimumConfidence=0.8&limit=10",
    { headers: f.headers },
  );
  assert.equal(knowledge.status, 200);
  const memory = await f.app.request(
    "/api/v1/repositories/acme/widgets/memory?executionId=execution-1",
    { headers: f.headers },
  );
  assert.equal(memory.status, 200);
  const specification = await f.app.request("/api/v1/openapi.json", {
    headers: f.headers,
  });
  assert.equal(specification.status, 200);
  verifyEngineeringPlatformApiContracts();
  assert.equal(engineeringPlatformOpenApi.openapi, "3.1.0");
  assert.ok(engineeringPlatformOpenApi.paths["/api/v1/workflows"]);
  const rendered = f.metrics.render();
  assert.match(rendered, /giro_engineering_api_actions_total/);
  assert.match(rendered, /action="pagination"/);
});
