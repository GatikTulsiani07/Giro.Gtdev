import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { signAccessToken } from "../services/auth/jwt.js";
import {
  RepositorySessionEngine,
} from "../services/repositorySession/service.js";
import {
  MemoryRepositorySessionStore,
} from "../services/repositorySession/store.js";
import {
  REPOSITORY_SESSION_API_ROUTES,
  verifyRepositorySessionApiContracts,
} from "../services/repositorySessionApi/contracts.js";
import { publicWorkflow } from
  "../services/engineeringPlatformApi/service.js";
import {
  MemoryRepositoryStore,
} from "../services/repository/store/memoryRepositoryStore.js";
import {
  MemoryRateLimitStore,
} from "../services/rateLimit/memoryRateLimitStore.js";

const USER = { userId: "session-api-user", email: "session@example.com" };
const OTHER = { userId: "other-session-user", email: "other@example.com" };
const REPOSITORY_ID = "acme/widgets";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const COUNTS = {
  chunkCount: 1,
  fileCount: 1,
  symbolCount: 1,
  graphNodeCount: 1,
  graphEdgeCount: 0,
  summaryAvailable: true,
};

const verified = <T extends Record<string, unknown>>(extra: T) => ({
  async verify() {},
  ...extra,
});

async function fixture(defaultApiLimit = 1_000) {
  const repositories = new MemoryRepositoryStore();
  repositories.connectRepository({
    owner: "acme",
    repo: "widgets",
    ownerUserId: USER.userId,
  });
  repositories.markIndexed(REPOSITORY_ID, {
    counts: COUNTS,
    indexedRevision: REVISION,
  });
  repositories.connectRepository({
    owner: "private",
    repo: "repository",
    ownerUserId: OTHER.userId,
  });
  repositories.markIndexed("private/repository", {
    counts: COUNTS,
    indexedRevision: REVISION,
  });
  const calls: string[] = [];
  let failQuery = false;
  const dependencies = {
    repositories,
    workflows: verified({
      async get(_tenantId: string, workflowId: string) {
        if (workflowId === "missing-workflow") return null;
        return {
          workflowId,
          ownerId: workflowId === "foreign-workflow"
            ? OTHER.userId : USER.userId,
          repositoryId: workflowId === "wrong-repository"
            ? "private/repository" : REPOSITORY_ID,
          repositoryRevision: workflowId === "wrong-revision"
            ? "a".repeat(40) : REVISION,
          lifecycle: workflowId === "failed-workflow"
            ? "failed" : "created",
          currentStage: workflowId === "planning-workflow"
            ? "planning" : null,
        };
      },
    }),
    query: verified({
      async query(input: Record<string, unknown>) {
        calls.push(`query:${input.sessionId}`);
        if (failQuery) {
          throw Object.assign(
            new Error("Published query intelligence is unavailable."),
            { code: "repository_query_dependency_unavailable" },
          );
        }
        return {
          query: {
            queryId: "query-1",
            intents: ["architecture"],
            lifecycle: "completed",
            tenantId: USER.userId,
            userId: USER.userId,
          },
          response: {
            summary: "Architecture uses deterministic layers.",
            confidence: 0.9,
            relevantFiles: ["src/index.ts"],
            relevantSymbols: [],
            relatedFeatures: [],
          },
          diagnostics: [],
          cacheHit: false,
          engineUsage: [],
          latencyMs: 1,
        };
      },
    }),
    taskPlanner: verified({
      async plan() {
        calls.push("plan");
        return {
          task: {
            taskId: "task-1",
            userRequest: "Plan the change",
            category: "new feature",
            lifecycle: "published",
            tenantId: USER.userId,
            ownerId: USER.userId,
          },
          impact: {
            affectedModules: [],
            affectedFiles: ["src/index.ts"],
            affectedFeatures: [],
            affectedSymbols: [],
            dependencies: [],
            downstreamImpact: [],
          },
          phases: [],
          risk: {},
          validationChecklist: {},
          diagnostics: [],
        };
      },
    }),
    specifications: verified({
      async generate(input: Record<string, unknown>) {
        calls.push(`specification:${input.taskId}`);
        return {
          specification: {
            specificationId: "specification-1",
            title: "Session API specification",
            type: "feature",
            tenantId: USER.userId,
            ownerId: USER.userId,
            ownershipFingerprint: "must-not-leak",
          },
          diagnostics: [],
        };
      },
    }),
    coordinator: verified({
      async coordinate(input: Record<string, unknown>) {
        calls.push(`execution:${input.workflowId}`);
        return {
          execution: {
            executionId: "execution-1",
            status: "completed",
            tenantId: USER.userId,
            ownerId: USER.userId,
          },
          summary: { readinessStatus: "ready" },
          diagnostics: [],
        };
      },
    }),
    insights: verified({
      async generate() {
        calls.push("insights");
        return {
          insights: [{
            insightId: "insight-1",
            title: "Architecture hotspot",
            type: "architectural hotspot",
            severity: "high",
            tenantId: USER.userId,
          }],
          diagnostics: [],
        };
      },
    }),
  };
  const store = new MemoryRepositorySessionStore();
  const metrics = new MetricsRegistry();
  const engine = new RepositorySessionEngine(
    store,
    dependencies as never,
    { maximumHistory: 20, expirationMs: 60_000 },
    metrics,
    () => new Date("2099-01-01T00:00:00.000Z"),
  );
  const app = createApp({
    repositorySessionEngine: engine,
    metrics,
    rateLimitStore: new MemoryRateLimitStore(),
    rateLimitPolicy: {
      authentication: { windowMs: 60_000, maxRequests: 1_000 },
      repositoryConnect: { windowMs: 60_000, maxRequests: 1_000 },
      askGiro: { windowMs: 60_000, maxRequests: 1_000 },
      retrievalSearch: { windowMs: 60_000, maxRequests: 1_000 },
      indexingOperations: { windowMs: 60_000, maxRequests: 1_000 },
      defaultApi: { windowMs: 60_000, maxRequests: defaultApiLimit },
    },
  });
  const token = await signAccessToken(USER);
  const otherToken = await signAccessToken(OTHER);
  return {
    app,
    engine,
    store,
    repositories,
    dependencies,
    calls,
    metrics,
    failNextQuery() { failQuery = true; },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Request-ID": "session-api-request",
    },
    otherHeaders: {
      Authorization: `Bearer ${otherToken}`,
      "Content-Type": "application/json",
    },
  };
}

const CREATE_BODY = {
  owner: "acme",
  repo: "widgets",
  revision: REVISION,
  workflowId: "workflow-1",
};

async function createSession(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.app.request("/api/v1/sessions", {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify(CREATE_BODY),
  });
  return {
    response,
    body: await response.json() as any,
  };
}

async function createUnattachedSession(
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const { workflowId: _workflowId, ...body } = CREATE_BODY;
  const response = await f.app.request("/api/v1/sessions", {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as any };
}

test("session workflow attachment is fenced, idempotent, and publicly linked",
  async () => {
    const f = await fixture();
    const created = await createUnattachedSession(f);
    const id = created.body.data.session.sessionId;
    const attach = (workflowId: string, headers = f.headers) => f.app.request(
      `/api/v1/sessions/${id}/workflow`, {
        method: "POST",
        headers,
        body: JSON.stringify({ workflowId }),
      });

    const attached = await attach("planning-workflow");
    const attachedBody = await attached.json() as any;
    assert.equal(attached.status, 200);
    assert.equal(attachedBody.code, "repository_session_workflow_attached");
    assert.equal(attachedBody.data.session.attachedWorkflowId,
      "planning-workflow");
    assert.equal(attachedBody.data.session.workflowId, "planning-workflow");
    assert.equal(attachedBody.data.session.workflowState, "created");
    assert.equal(attachedBody.data.session.workflowStage, "planning");
    assert.equal(attachedBody.data.session.attachedAt,
      "2099-01-01T00:00:00.000Z");
    assert.equal("ownerId" in attachedBody.data.session, false);
    assert.equal("persistenceVersion" in attachedBody.data.session, false);
    const retrieved = await f.app.request(`/api/v1/sessions/${id}`, {
      headers: f.headers,
    });
    const retrievedBody = await retrieved.json() as any;
    assert.equal(retrievedBody.data.session.attachedWorkflowId,
      "planning-workflow");
    assert.equal(retrievedBody.data.session.workflowState, "created");
    assert.equal(retrievedBody.data.session.workflowStage, "planning");

    const duplicate = await attach("planning-workflow");
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as any).code,
      "repository_session_workflow_attachment_reused");
    assert.equal((await f.engine.findByWorkflow(
      USER.userId, USER.userId, "planning-workflow"))?.session.sessionId, id);
    assert.equal(publicWorkflow({
      workflowId: "planning-workflow",
      repositoryId: REPOSITORY_ID,
      executionId: "execution-1",
      workflowVersion: 1,
      lifecycle: "created",
      currentStage: "planning",
      approvals: [],
      createdAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
    } as never, id).attachedSessionId, id);

    const replacement = await attach("workflow-2");
    assert.equal(replacement.status, 409);
    assert.equal((await replacement.json() as any).code,
      "repository_session_workflow_attachment_conflict");
    const metrics = f.metrics.render();
    assert.match(metrics, /operation="workflow_attachment"\} 1/);
    assert.match(metrics,
      /operation="workflow_duplicate_attachment"\} 1/);
    assert.match(metrics,
      /operation="workflow_validation_failure"\} 1/);
  });

test("workflow attachment rejects ownership, identity, lifecycle, and input failures",
  async () => {
    for (const [workflowId, status, code] of [
      ["foreign-workflow", 403, "repository_session_workflow_access_denied"],
      ["wrong-repository", 409,
        "repository_session_workflow_repository_conflict"],
      ["wrong-revision", 409,
        "repository_session_workflow_revision_conflict"],
      ["missing-workflow", 404, "repository_session_workflow_not_found"],
      ["failed-workflow", 422,
        "repository_session_workflow_lifecycle_incompatible"],
    ] as const) {
      const f = await fixture();
      const created = await createUnattachedSession(f);
      const response = await f.app.request(
        `/api/v1/sessions/${created.body.data.session.sessionId}/workflow`, {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify({ workflowId }),
        });
      const body = await response.json() as any;
      assert.equal(response.status, status, workflowId);
      assert.equal(body.code, code, workflowId);
      assert.equal(body.data, null, workflowId);
    }

    const f = await fixture();
    const invalidSession = await f.app.request(
      "/api/v1/sessions/missing-session/workflow", {
        method: "POST", headers: f.headers,
        body: JSON.stringify({ workflowId: "workflow-1" }),
      });
    assert.equal(invalidSession.status, 404);
    const invalidWorkflow = await f.app.request(
      "/api/v1/sessions/missing-session/workflow", {
        method: "POST", headers: f.headers,
        body: JSON.stringify({ workflowId: "../invalid" }),
      });
    assert.equal(invalidWorkflow.status, 400);
    const unauthorized = await f.app.request(
      "/api/v1/sessions/missing-session/workflow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: "workflow-1" }),
      });
    assert.equal(unauthorized.status, 401);

    const rendered = f.metrics.render();
    assert.match(rendered,
      /operation="workflow_validation_failure"\} 2/);
    assert.match(rendered,
      /operation="workflow_authorization_failure"\} 1/);
  });

test("versioned session API creates, reuses, lists, retrieves, and archives",
  async () => {
    const f = await fixture();
    const created = await createSession(f);
    assert.equal(created.response.status, 201);
    assert.equal(created.body.status, 201);
    assert.equal(created.body.code, "repository_session_created");
    assert.equal(created.body.requestId, "session-api-request");
    assert.equal(created.body.data.session.repositoryId, REPOSITORY_ID);
    assert.equal(created.body.data.session.revision, REVISION);
    assert.equal("tenantId" in created.body.data.session, false);
    assert.equal("ownerId" in created.body.data.session, false);
    assert.equal("persistenceVersion" in created.body.data.session, false);

    const reused = await createSession(f);
    assert.equal(reused.response.status, 200);
    assert.equal(reused.body.code, "repository_session_reused");
    assert.equal(
      reused.body.data.session.sessionId,
      created.body.data.session.sessionId,
    );

    const listed = await f.app.request("/api/v1/sessions", {
      headers: f.headers,
    });
    const listedBody = await listed.json() as any;
    assert.equal(listed.status, 200);
    assert.equal(listedBody.data.count, 1);
    assert.equal(
      listedBody.data.sessions[0].sessionId,
      created.body.data.session.sessionId,
    );

    const id = created.body.data.session.sessionId;
    const retrieved = await f.app.request(`/api/v1/sessions/${id}`, {
      headers: f.headers,
    });
    const retrievedBody = await retrieved.json() as any;
    assert.equal(retrieved.status, 200);
    assert.deepEqual(retrievedBody.data, reused.body.data);

    const archived = await f.app.request(`/api/v1/sessions/${id}/archive`, {
      method: "POST",
      headers: f.headers,
      body: "{}",
    });
    const archivedBody = await archived.json() as any;
    assert.equal(archived.status, 200);
    assert.equal(archivedBody.data.session.lifecycle, "archived");
    const afterArchive = await f.app.request("/api/v1/sessions", {
      headers: f.headers,
    });
    assert.equal((await afterArchive.json() as any).data.count, 0);

    const second = await createSession(f);
    const deleted = await f.app.request(
      `/api/v1/sessions/${second.body.data.session.sessionId}`,
      { method: "DELETE", headers: f.headers },
    );
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");
  });

test("authentication, repository ownership, revision, and workflow fences fail closed",
  async () => {
    const f = await fixture();
    const unauthenticated = await f.app.request("/api/v1/sessions");
    const unauthenticatedBody = await unauthenticated.json() as any;
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticatedBody.status, 401);
    assert.equal(unauthenticatedBody.retryable, false);
    assert.equal(
      unauthenticatedBody.code,
      "repository_session_api_unauthorized",
    );

    const foreignRepository = await f.app.request("/api/v1/sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        owner: "private",
        repo: "repository",
        revision: REVISION,
      }),
    });
    assert.equal(foreignRepository.status, 403);
    assert.equal((await foreignRepository.json() as any).status, 403);

    const stale = await f.app.request("/api/v1/sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ ...CREATE_BODY, revision: "a".repeat(40) }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as any).code,
      "repository_session_revision_conflict");

    const foreignWorkflow = await f.app.request("/api/v1/sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        ...CREATE_BODY,
        workflowId: "foreign-workflow",
      }),
    });
    assert.equal(foreignWorkflow.status, 403);
    assert.equal((await foreignWorkflow.json() as any).code,
      "repository_session_workflow_access_denied");

    const created = await createSession(f);
    const hidden = await f.app.request(
      `/api/v1/sessions/${created.body.data.session.sessionId}`,
      { headers: f.otherHeaders },
    );
    assert.equal(hidden.status, 404);
  });

test("query, plan, specification, insights, and execution delegate to the engine",
  async () => {
    const f = await fixture();
    const created = await createSession(f);
    const id = created.body.data.session.sessionId;
    const requests = [
      ["query", { query: "Explain the architecture" }],
      ["plan", { objective: "Plan the change" }],
      ["specification", { objective: "Specify the change" }],
      ["insights", {}],
      ["execution", { objective: "Coordinate the change" }],
    ] as const;
    for (const [operation, body] of requests) {
      const response = await f.app.request(
        `/api/v1/sessions/${id}/${operation}`,
        {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify(body),
        },
      );
      const result = await response.json() as any;
      assert.equal(response.status, 200, operation);
      assert.equal(result.status, 200, operation);
      assert.equal(result.success, true, operation);
      assert.equal(result.data.session.session.sessionId, id, operation);
      assert.equal(
        JSON.stringify(result.data.result).includes(USER.userId),
        false,
        operation,
      );
      assert.equal(
        JSON.stringify(result.data.result).includes("must-not-leak"),
        false,
        operation,
      );
    }
    assert.deepEqual(f.calls, [
      `query:${id}`,
      "plan",
      "specification:task-1",
      "insights",
      "execution:workflow-1",
    ]);
  });

test("validation and dependency failures use the normalized error contract",
  async () => {
    const f = await fixture();
    const invalid = await f.app.request("/api/v1/sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        owner: "../acme",
        repo: "widgets",
        revision: "invalid",
      }),
    });
    const invalidBody = await invalid.json() as any;
    assert.equal(invalid.status, 400);
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.success, false);
    assert.equal(invalidBody.retryable, false);
    assert.equal(invalidBody.diagnostics.length, 1);

    const malformed = await f.app.request("/api/v1/sessions", {
      method: "POST",
      headers: f.headers,
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal(
      (await malformed.json() as any).code,
      "repository_session_api_invalid_json",
    );

    const created = await createSession(f);
    f.failNextQuery();
    const failure = await f.app.request(
      `/api/v1/sessions/${created.body.data.session.sessionId}/query`,
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({ query: "Explain the architecture" }),
      },
    );
    const failureBody = await failure.json() as any;
    assert.equal(failure.status, 503);
    assert.equal(failureBody.status, 503);
    assert.equal(failureBody.retryable, true);
    assert.equal(failureBody.data, null);
    assert.equal(failureBody.diagnostics[0].severity, "error");
  });

test("rate limiting uses the normalized session error contract", async () => {
  const f = await fixture(1);
  const first = await f.app.request("/api/v1/sessions", {
    headers: f.headers,
  });
  assert.equal(first.status, 200);
  const limited = await f.app.request("/api/v1/sessions", {
    headers: f.headers,
  });
  const body = await limited.json() as any;
  assert.equal(limited.status, 429);
  assert.equal(body.status, 429);
  assert.equal(body.code, "repository_session_api_rate_limited");
  assert.equal(body.retryable, true);
  assert.equal(body.requestId, "session-api-request");
  assert.equal(body.diagnostics[0].details.retryAfterSeconds, 60);
});

test("session API metrics and startup contracts cover every public operation",
  async () => {
    const f = await fixture();
    const created = await createSession(f);
    await createSession(f);
    const id = created.body.data.session.sessionId;
    for (const [operation, body] of [
      ["query", { query: "Explain architecture" }],
      ["plan", { objective: "Plan change" }],
      ["specification", { objective: "Specify change" }],
      ["insights", {}],
      ["execution", { objective: "Coordinate change" }],
    ] as const) {
      await f.app.request(`/api/v1/sessions/${id}/${operation}`, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify(body),
      });
    }
    await f.app.request(`/api/v1/sessions/${id}/archive`, {
      method: "POST",
      headers: f.headers,
      body: "{}",
    });
    await f.app.request("/api/v1/sessions", {
      method: "POST",
      headers: f.headers,
      body: "{}",
    });
    const rendered = f.metrics.render();
    for (const operation of [
      "creation", "reuse", "archive", "query", "plan",
      "specification", "insights", "execution", "failure",
    ]) {
      assert.match(
        rendered,
        new RegExp(
          `giro_repository_session_api_operations_total\\{operation="${operation}"\\} 1`,
        ),
        operation,
      );
    }
    assert.equal(REPOSITORY_SESSION_API_ROUTES.length, 11);
    verifyRepositorySessionApiContracts(f.engine);
    assert.throws(
      () => verifyRepositorySessionApiContracts({} as never),
      /repository_session_api_dependency_missing/,
    );
  });
