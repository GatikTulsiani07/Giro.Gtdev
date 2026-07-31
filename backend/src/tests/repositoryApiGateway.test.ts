import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createApp } from "../app.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { signAccessToken } from "../services/auth/jwt.js";
import {
  REPOSITORY_GATEWAY_ROUTES,
  RepositoryApiGateway,
} from "../services/repositoryApiGateway/service.js";
import {
  MemoryRepositoryApiGatewayStore,
} from "../services/repositoryApiGateway/store.js";
import {
  REPOSITORY_API_GATEWAY_SCHEMA_VERSION,
  RepositoryGatewayError,
  type RepositoryGatewayService,
} from "../services/repositoryApiGateway/types.js";
import { MemoryRepositoryStore } from "../services/repository/store/memoryRepositoryStore.js";

const USER = { userId: "gateway-user", email: "gateway@example.com" };
const OTHER = { userId: "other-user", email: "other@example.com" };
const REPOSITORY_ID = "acme/widgets";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const BASE_REVISION = "89abcdef0123456789abcdef0123456789abcdef";
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

function fixture() {
  const repositories = new MemoryRepositoryStore();
  repositories.connectRepository({
    owner: "acme", repo: "widgets", ownerUserId: USER.userId,
  });
  repositories.markIndexed(REPOSITORY_ID, {
    counts: COUNTS, indexedRevision: REVISION,
  });
  const calls: RepositoryGatewayService[] = [];
  const dependencies = {
    repositories,
    overview: verified({
      async getPublishedSnapshot(): Promise<unknown | null> {
        return { status: "published" };
      },
      async getRepositoryOverview() {
        calls.push("repository-overview");
        return { architecture: { layers: [] } };
      },
    }),
    query: verified({
      async query() {
        calls.push("repository-query");
        return {
          query: { lifecycle: "completed", queryId: "query-1" },
          diagnostics: [],
        };
      },
      async recover() { return 0; },
    }),
    insights: verified({
      async generate() {
        calls.push("repository-insights");
        return { lifecycle: "published", insights: [] };
      },
      async navigate() { return []; },
      async recover() { return 0; },
    }),
    features: verified({
      async navigate() {
        calls.push("feature-navigation");
        return {
          byName: (name: string) => ({ feature: { name } }),
          entryPoints: () => [],
          exitPoints: () => [],
          files: () => [],
          symbols: () => [],
          dependencies: () => [],
          upstream: () => [],
          downstream: () => [],
        };
      },
      async recover() { return 0; },
    }),
    semantics: verified({
      async navigate() {
        calls.push("semantic-navigation");
        const result = (query: string) => ({
          query, symbols: [], relationships: [],
        });
        return {
          definition: result, references: result, implementations: result,
          callers: result, callees: result, inheritanceChain: result,
          dependencyChain: result,
        };
      },
      async recover() { return 0; },
    }),
    changes: verified({
      async analyzePublished() {
        calls.push("change-impact");
        return { lifecycle: "published", diagnostics: [] };
      },
      async recover() { return 0; },
    }),
    taskPlanner: verified({
      async plan() {
        calls.push("task-planning");
        return {
          task: { lifecycle: "published", taskId: "task-1" },
          diagnostics: [],
        };
      },
      async recover() { return 0; },
    }),
    specifications: verified({
      async generate() {
        calls.push("engineering-specification");
        return {
          specification: {
            lifecycle: "published", specificationId: "specification-1",
          },
          diagnostics: [],
        };
      },
      async recover() { return 0; },
    }),
    coordinator: verified({
      async coordinate() {
        calls.push("execution-coordination");
        return {
          execution: { status: "completed", executionId: "execution-1" },
          diagnostics: [],
        };
      },
      async recover() { return 0; },
    }),
    evolution: verified({
      async compare() {
        calls.push("repository-evolution");
        return { lifecycle: "published", evolutionId: "evolution-1" };
      },
      async recover() { return 0; },
    }),
    workflows: verified({
      async get(_tenantId: string, workflowId: string) {
        return {
          workflowId,
          ownerId: USER.userId,
          repositoryId: REPOSITORY_ID,
          repositoryRevision: REVISION,
        };
      },
    }),
  };
  const store = new MemoryRepositoryApiGatewayStore();
  const metrics = new MetricsRegistry();
  let tick = 0;
  const gateway = new RepositoryApiGateway(
    store,
    dependencies as never,
    metrics,
    () => new Date("2099-01-01T00:00:00.000Z"),
    () => tick++,
  );
  return { repositories, dependencies, store, metrics, gateway, calls };
}

async function headers(user = USER) {
  return {
    Authorization: `Bearer ${await signAccessToken(user)}`,
    "Content-Type": "application/json",
    "X-Request-ID": "gateway-request-1",
  };
}

test("all ten gateway routes delegate and return the normalized response model",
  async () => {
    const f = fixture();
    const app = createApp({ repositoryApiGateway: f.gateway });
    const auth = await headers();
    const requests: ReadonlyArray<readonly [string, string, unknown]> = [
      ["GET", `/api/v1/repository-gateway/acme/widgets/overview?revision=${REVISION}`, null],
      ["POST", "/api/v1/repository-gateway/acme/widgets/query",
        { revision: REVISION, query: "show architecture" }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/insights",
        { revision: REVISION }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/features",
        { revision: REVISION, operation: "feature", name: "Payments" }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/semantics",
        { revision: REVISION, operation: "definition", query: "main" }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/change-impact", {
        revision: REVISION, workflowId: "workflow-1",
        target: { kind: "file", value: "src/index.ts" },
        changeType: "modify", rationale: "Change the entry point",
      }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/task-plan",
        { revision: REVISION, objective: "Add deterministic coverage" }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/specification",
        { revision: REVISION, objective: "Add deterministic coverage" }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/execution", {
        revision: REVISION, objective: "Add deterministic coverage",
        workflowId: "workflow-1",
      }],
      ["POST", "/api/v1/repository-gateway/acme/widgets/evolution",
        { revision: REVISION, baseRevision: BASE_REVISION }],
    ];
    for (const [method, path, body] of requests) {
      const response = await app.request(path, {
        method,
        headers: auth,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      const result = await response.json() as Record<string, unknown>;
      assert.deepEqual(Object.keys(result).sort(), [
        "diagnostics", "payload", "repositoryId", "requestId", "revision",
        "service", "status", "timestamps",
      ]);
      assert.equal(result.requestId, "gateway-request-1");
      assert.equal(result.repositoryId, REPOSITORY_ID);
      assert.equal(result.revision, REVISION);
      assert.equal(result.status, "ok");
    }
    assert.deepEqual(f.calls.sort(), [
      "change-impact", "engineering-specification",
      "execution-coordination", "feature-navigation",
      "repository-evolution", "repository-insights",
      "repository-overview", "repository-query",
      "semantic-navigation", "task-planning",
    ]);
  });

test("authorization, workflow access, validation, and revision fencing normalize errors",
  async () => {
    const f = fixture();
    const app = createApp({ repositoryApiGateway: f.gateway });
    const noAuth = await app.request(
      `/api/v1/repository-gateway/acme/widgets/overview?revision=${REVISION}`);
    assert.equal(noAuth.status, 401);
    const noAuthBody = await noAuth.json() as any;
    assert.equal(noAuthBody.requestId.length > 0, true);
    assert.equal(noAuthBody.repositoryId, REPOSITORY_ID);
    assert.equal(noAuthBody.revision, REVISION);
    assert.equal(noAuthBody.status, "error");
    assert.equal(noAuthBody.diagnostics[0].code,
      "gateway_authorization_failed");

    const forbidden = await app.request(
      `/api/v1/repository-gateway/acme/widgets/overview?revision=${REVISION}`,
      { headers: await headers(OTHER) });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json() as any).diagnostics[0].code,
      "gateway_authorization_failed");

    const stale = await app.request(
      "/api/v1/repository-gateway/acme/widgets/query", {
        method: "POST", headers: await headers(),
        body: JSON.stringify({ revision: "a".repeat(40), query: "overview" }),
      });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as any).diagnostics[0].code,
      "gateway_stale_revision");

    const invalid = await app.request(
      "/api/v1/repository-gateway/acme/widgets/query", {
        method: "POST", headers: await headers(),
        body: JSON.stringify({ revision: REVISION, query: "" }),
      });
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json() as any;
    assert.equal(invalidBody.status, "error");
    assert.equal(invalidBody.payload, null);
    assert.equal(invalidBody.diagnostics[0].code,
      "gateway_validation_failed");

    f.dependencies.workflows.get = async () => null as never;
    const workflow = await app.request(
      "/api/v1/repository-gateway/acme/widgets/execution", {
        method: "POST", headers: await headers(),
        body: JSON.stringify({
          revision: REVISION, objective: "Run plan",
          workflowId: "foreign-workflow",
        }),
      });
    assert.equal(workflow.status, 403);
    assert.equal((await workflow.json() as any).diagnostics[0].code,
      "gateway_authorization_failed");
  });

test("identical requests cache only while ownership and revision remain fenced",
  async () => {
    const f = fixture();
    const request = {
      requestId: "first",
      ownerId: USER.userId,
      repositoryId: REPOSITORY_ID,
      revision: REVISION,
      service: "repository-query" as const,
      input: { query: "show architecture" },
      receivedAt: "2099-01-01T00:00:00.000Z",
    };
    await f.gateway.execute(request);
    const cached = await f.gateway.execute({ ...request, requestId: "second" });
    assert.equal(cached.requestId, "second");
    assert.equal(f.calls.filter((item) => item === "repository-query").length, 1);
    const metrics = await f.gateway.metricsSnapshot(USER.userId);
    assert.equal(metrics.endpointUsage["repository-query"], 2);
    assert.equal(metrics.cacheHits, 1);

    f.repositories.updateRepository(REPOSITORY_ID, {
      ownerUserId: OTHER.userId,
    });
    await assert.rejects(
      f.gateway.execute({ ...request, requestId: "third" }),
      (error: unknown) => error instanceof RepositoryGatewayError &&
        error.code === "gateway_authorization_failed",
    );
  });

test("partial results, unavailable intelligence, metrics, recovery, and startup validate",
  async () => {
    const f = fixture();
    f.dependencies.query.query = async () => ({
      query: { lifecycle: "partial", queryId: "partial-query" },
      diagnostics: [{
        code: "repository_query_partial_engine_failure",
        message: "Semantic service unavailable.",
        severity: "warning",
      }],
    }) as never;
    const partial = await f.gateway.execute({
      requestId: "partial", ownerId: USER.userId,
      repositoryId: REPOSITORY_ID, revision: REVISION,
      service: "repository-query", input: { query: "show architecture" },
    });
    assert.equal(partial.status, "partial");
    assert.equal(partial.diagnostics[0]?.code,
      "repository_query_partial_engine_failure");

    f.dependencies.overview.getPublishedSnapshot = async () => null;
    await assert.rejects(f.gateway.execute({
      requestId: "missing", ownerId: USER.userId,
      repositoryId: REPOSITORY_ID, revision: REVISION,
      service: "repository-overview", input: {},
    }), (error: unknown) => error instanceof RepositoryGatewayError &&
      error.code === "gateway_intelligence_unavailable");

    f.store.hydrate({
      cacheKey: "stale",
      schemaVersion: "old",
      ownerId: USER.userId,
      repositoryId: REPOSITORY_ID,
      repositoryRevision: REVISION,
      ownershipFingerprint: "owner",
      service: "repository-overview",
      requestFingerprint: "request",
      status: "ok",
      payload: {},
      diagnostics: [],
      createdAt: "2099-01-01T00:00:00.000Z",
      lastAccessedAt: "2099-01-01T00:00:00.000Z",
      hitCount: 0,
    });
    assert.equal(await f.gateway.recover(), 1);
    await f.gateway.verify();
    assert.equal(REPOSITORY_GATEWAY_ROUTES.length, 10);
    const rendered = f.metrics.render();
    assert.match(rendered, /giro_repository_gateway_endpoint_usage_total/);
    assert.match(rendered, /giro_repository_gateway_cache_hits_total/);
    assert.match(rendered, /giro_repository_gateway_failures_total 1/);
    assert.match(rendered, /giro_repository_gateway_service_distribution_total/);
  });

test("migration and startup source retain gateway safety contracts", async () => {
  const [migration, startup, routes] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260830000000_add_repository_api_gateway.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/index.ts", import.meta.url), "utf8"),
  ]);
  for (const token of [
    "repository_api_gateway_cache_lookup_idx",
    "repository_api_gateway_metrics_service_idx",
    "enable row level security",
    "verify_repository_api_gateway_contract",
    "recover_repository_api_gateway_cache",
    "repository-api-gateway-schema-v1",
  ]) assert.ok(migration.includes(token), token);
  assert.ok(startup.indexOf("runtimeRepositoryApiGateway.verify") <
    startup.indexOf("server = serve"));
  assert.match(routes, /createRepositoryApiGatewayRoute/);
  assert.equal(REPOSITORY_API_GATEWAY_SCHEMA_VERSION,
    "repository-api-gateway-schema-v1");
});
