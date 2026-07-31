import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MetricsRegistry } from "../observability/metrics.js";
import {
  deterministicRepositorySessionId,
  RepositorySessionEngine,
} from "../services/repositorySession/service.js";
import {
  MemoryRepositorySessionStore,
} from "../services/repositorySession/store.js";
import {
  REPOSITORY_SESSION_SCHEMA_VERSION,
  RepositorySessionError,
} from "../services/repositorySession/types.js";
import { MemoryRepositoryStore } from "../services/repository/store/memoryRepositoryStore.js";

const USER = "session-owner";
const OTHER = "other-user";
const REPOSITORY_ID = "acme/widgets";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const COUNTS = {
  chunkCount: 1, fileCount: 1, symbolCount: 1,
  graphNodeCount: 1, graphEdgeCount: 0, summaryAvailable: true,
};

const verified = <T extends Record<string, unknown>>(extra: T) => ({
  async verify() {},
  ...extra,
});

function fixture(limits = { maximumHistory: 10, expirationMs: 60_000 }) {
  const repositories = new MemoryRepositoryStore();
  repositories.connectRepository({
    owner: "acme", repo: "widgets", ownerUserId: USER,
  });
  repositories.markIndexed(REPOSITORY_ID, {
    counts: COUNTS, indexedRevision: REVISION,
  });
  const calls: string[] = [];
  const dependencies = {
    repositories,
    workflows: verified({
      async get(_tenantId: string, workflowId: string) {
        return {
          workflowId, ownerId: USER, repositoryId: REPOSITORY_ID,
          repositoryRevision: REVISION,
        };
      },
    }),
    query: verified({
      async query(input: Record<string, unknown>) {
        calls.push(`query:${input.sessionId}`);
        return {
          query: {
            queryId: "query-1", intents: ["architecture"],
            lifecycle: "completed",
          },
          response: {
            summary: "Architecture is organized into deterministic layers.",
            confidence: 0.9,
            architecture: { overview: {}, subsystems: [] },
            relevantFiles: ["src/index.ts", "src/service.ts"],
            relevantSymbols: [{
              symbolId: "symbol-main", qualifiedName: "main",
              file: "src/index.ts",
            }],
            relatedFeatures: [{
              featureId: "feature-payments", name: "Payments",
              owningModules: ["payments"],
            }],
            changeImpact: { impact: {}, risk: {} },
          },
          diagnostics: [], cacheHit: false, engineUsage: [], latencyMs: 0,
        };
      },
    }),
    taskPlanner: verified({
      async plan() {
        calls.push("plan");
        return {
          task: {
            taskId: "task-1", userRequest: "Plan payment change",
            category: "new feature", lifecycle: "published",
          },
          impact: {
            affectedModules: ["payments"],
            affectedFiles: ["src/payment.ts"],
            affectedFeatures: ["feature-payments"],
            affectedSymbols: [], dependencies: [], downstreamImpact: [],
          },
        };
      },
    }),
    specifications: verified({
      async generate(input: Record<string, unknown>) {
        calls.push(`specification:${input.taskId}`);
        return {
          specification: {
            specificationId: "specification-1",
            title: "Payment specification", type: "feature",
          },
        };
      },
    }),
    coordinator: verified({
      async coordinate(input: Record<string, unknown>) {
        calls.push(`coordinate:${input.workflowId}`);
        return {
          execution: {
            executionId: "execution-1", status: "completed",
          },
          summary: { readinessStatus: "ready" },
        };
      },
    }),
    insights: verified({
      async generate() {
        calls.push("insights");
        return {
          insights: [{
            insightId: "insight-1", title: "Architecture hotspot",
            type: "architectural hotspot", severity: "high",
          }],
        };
      },
    }),
  };
  const store = new MemoryRepositorySessionStore();
  const metrics = new MetricsRegistry();
  let now = new Date("2099-01-01T00:00:00.000Z");
  const engine = new RepositorySessionEngine(
    store, dependencies as never, limits, metrics, () => now);
  const input = {
    tenantId: USER, ownerId: USER, userId: USER,
    repositoryOwnerId: USER, repositoryId: REPOSITORY_ID,
    repositoryRevision: REVISION, workflowId: "workflow-1",
    requestedAt: "2099-01-01T00:00:00.000Z",
  };
  return {
    repositories, dependencies, store, metrics, engine, input, calls,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
  };
}

test("session IDs are deterministic and create reuses the same fenced session",
  async () => {
    const f = fixture();
    assert.equal(deterministicRepositorySessionId(f.input),
      deterministicRepositorySessionId({ ...f.input }));
    const first = await f.engine.create(f.input);
    const second = await f.engine.create(f.input);
    assert.equal(first.session.sessionId, second.session.sessionId);
    assert.equal(second.reuseCount, 1);
    assert.equal(second.session.repositoryRevision, REVISION);
    assert.equal(second.session.ownerId, USER);
    assert.equal(second.session.userId, USER);
    assert.equal(second.session.workflowId, "workflow-1");
  });

test("service orchestration accumulates navigable engineering context",
  async () => {
    const f = fixture({ maximumHistory: 20, expirationMs: 60_000 });
    const session = await f.engine.create(f.input);
    const id = session.session.sessionId;
    await f.engine.query({
      tenantId: USER, ownerId: USER, sessionId: id,
      question: "Explain the architecture",
    });
    await f.engine.plan({
      tenantId: USER, ownerId: USER, sessionId: id,
      objective: "Plan payment change",
    });
    await f.engine.specification({
      tenantId: USER, ownerId: USER, sessionId: id,
      objective: "Specify payment change",
    });
    await f.engine.coordinate({
      tenantId: USER, ownerId: USER, sessionId: id,
      objective: "Coordinate payment change",
    });
    await f.engine.insights({
      tenantId: USER, ownerId: USER, sessionId: id,
    });
    const current = await f.engine.get(USER, USER, id);
    assert.deepEqual(current.context.previousQuestions,
      ["Explain the architecture"]);
    assert.deepEqual(current.context.previousAnswers,
      ["Architecture is organized into deterministic layers."]);
    assert.deepEqual(current.context.recentFiles, [
      "src/index.ts", "src/service.ts", "src/payment.ts",
    ]);
    assert.deepEqual(current.context.recentSymbols, ["symbol-main"]);
    assert.deepEqual(current.context.recentFeatures, ["feature-payments"]);
    assert.equal(current.context.activeFeature, "feature-payments");
    assert.equal(current.context.activeModule, "payments");
    assert.equal(current.context.activeWorkflow, "workflow-1");
    assert.equal(current.context.activeArchitecture, REVISION);
    assert.equal(current.context.activeChangeAnalysis, "query-1");
    assert.deepEqual(current.context.viewedPlans, ["task-1"]);
    assert.deepEqual(current.context.viewedSpecifications,
      ["specification-1"]);
    assert.deepEqual(current.context.viewedExecutionSummaries,
      ["execution-1"]);
    assert.deepEqual(current.context.viewedInsights, ["insight-1"]);
    assert.ok(f.calls.includes(`query:${id}`));
    assert.ok(f.calls.includes("specification:task-1"));
    assert.ok(f.calls.includes("coordinate:workflow-1"));
  });

test("history and navigation context prune deterministically", async () => {
  const f = fixture({ maximumHistory: 3, expirationMs: 60_000 });
  const session = await f.engine.create(f.input);
  const id = session.session.sessionId;
  for (const file of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
    await f.engine.recordView({
      tenantId: USER, ownerId: USER, sessionId: id,
      kind: "file", referenceId: file,
    });
  }
  const current = await f.engine.get(USER, USER, id);
  assert.deepEqual(current.context.recentFiles, ["b.ts", "c.ts", "d.ts"]);
  assert.equal(current.events.length, 3);
  assert.deepEqual(current.events.map((event) => event.referenceId),
    ["b.ts", "c.ts", "d.ts"]);
});

test("ownership, workflow access, and revision fencing are enforced",
  async () => {
    const f = fixture();
    await assert.rejects(f.engine.create({
      ...f.input, ownerId: OTHER, userId: OTHER,
      repositoryOwnerId: OTHER,
    }), (error: unknown) => error instanceof RepositorySessionError &&
      error.code === "repository_session_access_denied");
    await assert.rejects(f.engine.create({
      ...f.input, repositoryRevision: "a".repeat(40),
    }), (error: unknown) => error instanceof RepositorySessionError &&
      error.code === "repository_session_revision_conflict");
    f.dependencies.workflows.get = async () => null as never;
    await assert.rejects(f.engine.create({
      ...f.input, workflowId: "foreign",
    }), (error: unknown) => error instanceof RepositorySessionError &&
      error.code === "repository_session_workflow_access_denied");
  });

test("interrupted, stale, and partially persisted sessions recover",
  async () => {
    const f = fixture({ maximumHistory: 10, expirationMs: 10 });
    const created = await f.engine.create(f.input);
    const id = created.session.sessionId;
    f.dependencies.query.query = async () => {
      throw new Error("dependency interrupted");
    };
    await assert.rejects(f.engine.query({
      tenantId: USER, ownerId: USER, sessionId: id, question: "fail",
    }));
    assert.equal((await f.store.get(USER, USER, id))?.session.lifecycle,
      "interrupted");
    assert.equal(await f.engine.recover(), 1);
    assert.equal((await f.store.get(USER, USER, id))?.session.lifecycle,
      "recovered");

    const partial = await f.engine.create({
      ...f.input, workflowId: undefined,
    });
    f.store.hydrate({ ...partial, context: null as never });
    assert.equal(await f.engine.recover(), 1);
    assert.equal((await f.store.get(
      USER, USER, partial.session.sessionId))?.context.contextVersion, 1);

    f.advance(20);
    assert.equal(await f.engine.recover(), 2);
    assert.equal((await f.store.get(USER, USER, id))?.session.lifecycle,
      "archived");
  });

test("metrics and startup/migration contracts are complete", async () => {
  const f = fixture();
  const session = await f.engine.create(f.input);
  await f.engine.recordView({
    tenantId: USER, ownerId: USER,
    sessionId: session.session.sessionId,
    kind: "feature", referenceId: "feature-payments",
  });
  await f.engine.create(f.input);
  const metrics = await f.engine.metricsSnapshot(USER);
  assert.equal(metrics.activeSessions, 1);
  assert.equal(metrics.sessionReuse, 1);
  assert.ok(metrics.averageContextSize > 0);
  assert.match(f.metrics.render(), /giro_repository_session_active 1/);
  await f.engine.verify();

  const [migration, startup] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260831000000_add_repository_session_engine.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
  ]);
  for (const token of [
    "repository_engineering_sessions",
    "repository_session_events",
    "repository_session_context_snapshots",
    "repository_session_diagnostics",
    "repository_session_metrics",
    "enable row level security",
    "verify_repository_session_engine_contract",
    "collect_repository_engineering_sessions",
  ]) assert.ok(migration.includes(token), token);
  assert.ok(startup.indexOf("runtimeRepositorySessionEngine.verify") <
    startup.indexOf("server = serve"));
  assert.equal(REPOSITORY_SESSION_SCHEMA_VERSION,
    "repository-session-schema-v1");
});
