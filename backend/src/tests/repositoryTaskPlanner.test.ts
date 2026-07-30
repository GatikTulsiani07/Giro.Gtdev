import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyRepositoryTask, deterministicRepositoryTaskId,
  selectTaskPlanningEngines,
} from "../services/repositoryTaskPlanner/classifier.js";
import {
  buildRepositoryTaskPlan,
  type RepositoryTaskPlanningContext,
} from "../services/repositoryTaskPlanner/planner.js";
import {
  RepositoryTaskPlanner,
} from "../services/repositoryTaskPlanner/service.js";
import {
  MemoryRepositoryTaskPlannerStore,
  PostgresRepositoryTaskPlannerStore,
} from "../services/repositoryTaskPlanner/store.js";
import {
  REPOSITORY_TASK_PLAN_SCHEMA_VERSION,
  RepositoryTaskPlannerError,
  type CreateRepositoryTaskPlanInput,
  type RepositoryTask,
  type RepositoryTaskPlan,
} from "../services/repositoryTaskPlanner/types.js";
import {
  validateRepositoryTaskPlan, validateTaskPlannerSources,
} from "../services/repositoryTaskPlanner/validation.js";

const revision = "a".repeat(40);
const previousRevision = "b".repeat(40);
const timestamp = "2026-08-27T00:00:00.000Z";
const input: CreateRepositoryTaskPlanInput = {
  tenantId: "tenant-1", ownerId: "user-1",
  repositoryOwnerId: "user-1", repositoryId: "acme/widgets",
  repositoryRevision: revision,
  userRequest: "Fix the payment service authentication bug",
  requestedAt: timestamp,
};

function sources() {
  const semantic = {
    graphVersion: "semantic-v1", schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: "1".repeat(64), adapterVersions: [],
    lifecycle: "published", symbols: [{
      symbolId: "symbol-payment", graphVersion: "semantic-v1",
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, file: "src/payment/service.ts",
      language: "typescript", kind: "function", name: "authenticatePayment",
      qualifiedName: "PaymentService.authenticatePayment",
      visibility: "public", signature: "authenticatePayment",
      documentationHash: "d".repeat(64), line: 1, column: 1,
      endLine: 2, endColumn: 1, createdAt: timestamp, updatedAt: timestamp,
    }], relationships: [], fileAnalyses: [{
      file: "src/payment/service.ts", language: "typescript",
      adapterVersion: "typescript-v1", contentHash: "c".repeat(64),
      symbols: [], imports: [], diagnostics: [],
    }, {
      file: "src/payment/service.test.ts", language: "typescript",
      adapterVersion: "typescript-v1", contentHash: "e".repeat(64),
      symbols: [], imports: [], diagnostics: [],
    }], diagnostics: [], metrics: {
      indexedSymbols: 1, indexedRelationships: 0, indexingDurationMs: 1,
      graphRebuilds: 1, incrementalUpdates: 0, recoveryOperations: 0,
    }, createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
  const intelligence = {
    intelligenceVersion: "intelligence-v1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    graphVersion: "graph-v1", embeddingVersion: "embedding-v1",
    parserVersion: "parser-v1", analysisVersion: "repository-intelligence-v1",
    schemaVersion: "repository-intelligence-schema-v1", status: "published",
    createdAt: timestamp, validatedAt: timestamp, publishedAt: timestamp,
    publicationMetadata: {
      repositoryRevision: revision, graphVersion: "graph-v1",
      embeddingVersion: "embedding-v1", previousIntelligenceVersion: null,
    },
    architecture: {
      subsystemIds: ["payments"], packageHierarchy: ["src"],
      layers: [], dependencyGraph: [], hotspots: [],
    },
    codeOrganization: {
      largestModules: [], mostImportedFiles: [], highestFanIn: [],
      highestFanOut: [], utilityClusters: [], cyclicDependencies: [],
    },
    symbols: {
      publicApis: [], internalApis: [], orphanSymbols: [], deadExports: [],
      entrypoints: ["src/payment/service.ts"], sharedAbstractions: [],
    },
    quality: {
      duplicateImplementations: [], oversizedFiles: [],
      oversizedFunctions: [], todoFixmeDensity: 0,
      generatedCodeRatio: 0, documentationCoverage: 1,
    },
    evolution: {
      changedHotspots: [], stableAreas: [], architecturalDrift: [],
      growth: {
        files: 2, symbols: 1, dependencyEdges: 0,
        fileDelta: 0, symbolDelta: 0, dependencyEdgeDelta: 0,
      },
    },
    subsystems: [{
      subsystemId: "payments", name: "Payments",
      rootPath: "src/payment", layer: "application",
      files: ["src/payment/service.ts"], dependencies: [],
      publicApis: [], entrypoints: ["src/payment/service.ts"],
      summary: "Payment processing.", metrics: {
        files: 1, symbols: 1, incomingDependencies: 2,
        outgoingDependencies: 3,
      },
    }],
    metrics: {
      filesAnalyzed: 2, symbolsAnalyzed: 1,
      dependencyEdgesAnalyzed: 0, generatedSubsystems: 1,
      qualityFindings: 0, hotspots: 0,
    },
  };
  const graph = {
    graphVersion: "graph-v1", repositoryId: "acme/widgets",
    repositoryRevision: revision, repositoryVersion: revision,
    parserVersion: "parser-v1", status: "published",
    createdAt: timestamp, publishedAt: timestamp,
    nodes: [{
      nodeId: "symbol-payment", symbolId: "symbol-payment",
      graphVersion: "graph-v1", repositoryId: "acme/widgets",
      repositoryRevision: revision, repositoryVersion: revision,
      parserVersion: "parser-v1", name: "authenticatePayment",
      qualifiedName: "PaymentService.authenticatePayment", kind: "function",
      language: "typescript", file: "src/payment/service.ts",
      line: 1, endLine: 2, column: 1, endColumn: 1,
      exported: true, defaultExport: false, metadata: {},
    }], edges: [], diagnostics: {
      parsedFileCount: 1, parserFailureCount: 0,
      unresolvedImportCount: 0, importCount: 0,
      unresolvedFileRatio: 0, parserFailureRatio: 0,
      orphanSymbolCount: 0, duplicateNodeIdCount: 0,
      duplicateEdgeIdCount: 0, missingEndpointCount: 0,
      impossibleSelfEdgeCount: 0, graphBytes: 10,
      durationMs: 1, failures: [],
    },
  };
  const feature = {
    graphVersion: "feature-v1", schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    semanticGraphVersion: "semantic-v1",
    repositoryIntelligenceVersion: "intelligence-v1",
    sourceFingerprint: "f".repeat(64), lifecycle: "published",
    features: [{
      featureId: "feature-payment", graphVersion: "feature-v1",
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, name: "Payment authentication",
      description: "Authenticates payment requests.", confidence: 0.9,
      primaryEntryPoint: "symbol-payment",
      primaryExitPoint: "symbol-payment", entryPoints: ["symbol-payment"],
      exitPoints: ["symbol-payment"], owningModules: ["src/payment"],
      files: ["src/payment/service.ts"], symbolIds: ["symbol-payment"],
      lifecycle: "active", createdAt: timestamp, updatedAt: timestamp,
    }], relationships: [], flows: [], diagnostics: [], metrics: {
      indexedFeatures: 1, indexedRelationships: 0, indexedFlows: 0,
      generationDurationMs: 1, graphRebuilds: 1,
      incrementalUpdates: 0, recoveryOperations: 0,
    }, createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
  return { intelligence, graph, semantic, feature };
}

function task(lifecycle: RepositoryTask["lifecycle"] = "published"):
RepositoryTask {
  return {
    taskId: deterministicRepositoryTaskId(input),
    schemaVersion: REPOSITORY_TASK_PLAN_SCHEMA_VERSION,
    persistenceVersion: 1, tenantId: input.tenantId,
    ownerId: input.ownerId, repositoryId: input.repositoryId,
    repositoryRevision: revision, userRequest: input.userRequest,
    normalizedObjective: "fix the payment service authentication bug",
    category: "security", confidence: 0.86, lifecycle,
    createdAt: timestamp, updatedAt: timestamp,
    completedAt: lifecycle === "published" ? timestamp : null,
  };
}

function context(): RepositoryTaskPlanningContext {
  const fixture = sources();
  return {
    task: task(), orchestrationPlan:
      selectTaskPlanningEngines("security"),
    repositoryIntelligence: fixture.intelligence as never,
    repositoryGraph: fixture.graph as never,
    semanticGraph: fixture.semantic as never,
    featureGraph: fixture.feature as never,
    query: null, change: null, insights: [], evolution: null,
    knowledge: [], workflow: null, diagnostics: [],
    engineUsage: [
      "Repository Intelligence", "Semantic Intelligence",
      "Feature Intelligence",
    ], latencyMs: 4,
  };
}

test("task IDs, classification, and engine selection are deterministic", () => {
  assert.equal(deterministicRepositoryTaskId(input),
    deterministicRepositoryTaskId({ ...input }));
  assert.equal(classifyRepositoryTask("Fix broken checkout").category, "bug fix");
  assert.equal(classifyRepositoryTask("Add a checkout feature").category, "new feature");
  assert.equal(classifyRepositoryTask("Refactor checkout").category, "refactor");
  assert.equal(classifyRepositoryTask("Optimize request latency").category, "performance");
  assert.equal(classifyRepositoryTask("Harden authentication security").category, "security");
  assert.equal(classifyRepositoryTask("Update the README docs").category, "documentation");
  assert.equal(classifyRepositoryTask("Increase test coverage").category, "testing");
  assert.equal(classifyRepositoryTask("Upgrade dependency to v4").category, "dependency update");
  assert.equal(classifyRepositoryTask("Change the API endpoint").category, "API change");
  assert.equal(classifyRepositoryTask("Decouple architecture layers").category,
    "architecture improvement");
  assert.deepEqual(selectTaskPlanningEngines("testing").map((item) => item.engine), [
    "Repository Intelligence", "Semantic Intelligence",
    "Feature Intelligence", "Query Engine", "Change Intelligence",
  ]);
});

test("planning produces ordered, evidence-backed phases, impact, risk, and checklist", () => {
  const plan = buildRepositoryTaskPlan(context());
  validateRepositoryTaskPlan(plan);
  assert.deepEqual(plan.phases.map((item) => item.kind), [
    "preparation", "investigation", "implementation", "validation",
    "testing", "review", "deployment readiness",
  ]);
  assert.equal(plan.phases[1]!.dependsOn[0], plan.phases[0]!.phaseId);
  assert.ok(plan.impact.affectedFiles.includes("src/payment/service.ts"));
  assert.ok(plan.impact.affectedFeatures.includes("feature-payment"));
  assert.ok(plan.risk.architecturalRisk > 0);
  assert.ok(plan.validationChecklist.requiredTests.length > 0);
  assert.ok(plan.phases.every((phase) =>
    phase.actions.every((action) => !action.includes("```"))));
});

function dependencies(overrides: Record<string, unknown> = {}) {
  const fixture = sources();
  const counters = new Map<string, number>();
  const called = (name: string) =>
    counters.set(name, (counters.get(name) ?? 0) + 1);
  const repository = {
    repositoryId: "acme/widgets", ownerUserId: "user-1",
    deletionState: "active", currentRevision: revision,
    indexedRevision: revision, previousRevision,
  };
  const verify = async () => {};
  const result = {
    repositories: {
      getRepository: async () => repository,
    },
    repositoryGraph: {
      loadPublished: async () => fixture.graph, verify,
    },
    repositoryIntelligence: {
      getPublishedSnapshot: async () => fixture.intelligence, verify,
    },
    semantic: { get: async () => fixture.semantic, verify },
    features: { get: async () => fixture.feature, verify },
    query: {
      query: async () => {
        called("query");
        return {
          query: { queryId: "query-1" },
          response: {
            relevantFiles: ["src/payment/service.ts"],
            relevantSymbols: fixture.semantic.symbols,
            relatedFeatures: fixture.feature.features,
          },
        };
      }, verify,
    },
    changes: {
      analyze: async () => {
        called("change");
        throw new Error("change unavailable");
      }, verify,
    },
    insights: {
      generate: async () => {
        called("insights");
        return { insights: [] };
      }, verify,
    },
    evolution: {
      compare: async () => {
        called("evolution");
        return { trends: [] };
      }, verify,
    },
    knowledge: {
      retrieve: async () => {
        called("knowledge");
        return [];
      }, verify,
    },
    workflows: {
      list: async () => {
        called("workflow");
        return [];
      }, verify,
    },
    ...overrides,
  };
  return { result, counters, repository };
}

test("service fences ownership/revision, orchestrates selectively, caches, and records metrics", async () => {
  const store = new MemoryRepositoryTaskPlannerStore();
  const fixture = dependencies();
  const planner = new RepositoryTaskPlanner(
    store, fixture.result as never, () => new Date(timestamp));
  const first = await planner.plan(input);
  assert.equal(first.task.lifecycle, "partial");
  assert.equal(fixture.counters.get("query"), 1);
  assert.equal(fixture.counters.get("insights"), 1);
  assert.equal(fixture.counters.get("evolution"), undefined);
  const second = await planner.plan(input);
  assert.equal(second.cacheHit, true);
  assert.equal(fixture.counters.get("query"), 1);
  assert.deepEqual(await planner.metrics("tenant-1"), {
    plansCreated: 1, cacheHits: 1,
    averageOrchestrationLatencyMs: 0,
    averageAccuracyInputs: first.accuracyInputCount,
    recoveryCount: 0,
  });

  fixture.repository.ownerUserId = "other";
  await assert.rejects(() => new RepositoryTaskPlanner(
    new MemoryRepositoryTaskPlannerStore(), fixture.result as never,
  ).plan(input), (error: unknown) =>
    error instanceof RepositoryTaskPlannerError &&
    error.code === "repository_task_planner_access_denied");
  fixture.repository.ownerUserId = "user-1";
  fixture.repository.currentRevision = previousRevision;
  await assert.rejects(() => new RepositoryTaskPlanner(
    new MemoryRepositoryTaskPlannerStore(), fixture.result as never,
  ).plan(input), (error: unknown) =>
    error instanceof RepositoryTaskPlannerError &&
    error.code === "repository_task_planner_revision_conflict");
});

test("validation detects graph/feature lineage errors and recovery fences interrupted plans", async () => {
  const fixture = sources();
  assert.throws(() => validateTaskPlannerSources({
    repositoryIntelligence: fixture.intelligence as never,
    repositoryGraph: fixture.graph as never,
    semanticGraph: fixture.semantic as never,
    featureGraph: {
      ...fixture.feature, semanticGraphVersion: "stale",
    } as never,
  }, "tenant-1", "user-1", "acme/widgets", revision));
  const store = new MemoryRepositoryTaskPlannerStore();
  const interrupted = {
    ...buildRepositoryTaskPlan(context()),
    task: task("planning"), phases: [],
  } satisfies RepositoryTaskPlan;
  store.hydrate(interrupted);
  assert.equal(await store.recover(), 1);
  assert.equal(await store.get(
    "tenant-1", "user-1", interrupted.task.taskId), null);
});

test("startup verification covers every intelligence engine", async () => {
  const fixture = dependencies();
  let verifications = 0;
  for (const value of Object.values(fixture.result)) {
    if (typeof value === "object" && value && "verify" in value) {
      (value as { verify(): Promise<void> }).verify = async () => {
        verifications += 1;
      };
    }
  }
  const store = new MemoryRepositoryTaskPlannerStore();
  store.verify = async () => { verifications += 1; };
  await new RepositoryTaskPlanner(store, fixture.result as never).verify();
  assert.equal(verifications, 11);
});

test("PostgreSQL adapter and migration expose equivalent durable contracts", async () => {
  const plan = buildRepositoryTaskPlan(context());
  const calls: string[] = [];
  const database = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "get_repository_task_plan") return {
        data: [{ plan }], error: null,
      };
      if (name === "save_repository_task_plan") return {
        data: [{ plan }], error: null,
      };
      if (name === "repository_task_planner_metrics") return {
        data: [{
          plansCreated: 1, cacheHits: 0,
          averageOrchestrationLatencyMs: 4,
          averageAccuracyInputs: 4, recoveryCount: 0,
        }], error: null,
      };
      if (name === "verify_repository_task_planner_contract") return {
        data: [{
          valid: true,
          schemaVersion: REPOSITORY_TASK_PLAN_SCHEMA_VERSION,
          failures: [],
        }], error: null,
      };
      return { data: [1], error: null };
    },
  };
  const store = new PostgresRepositoryTaskPlannerStore(database as never);
  assert.deepEqual(await store.save(plan), plan);
  assert.deepEqual(await store.get(
    "tenant-1", "user-1", plan.task.taskId), plan);
  await store.recordCacheHit("tenant-1", "user-1", plan.task.taskId);
  assert.equal(await store.recover(), 1);
  assert.equal((await store.metrics()).plansCreated, 1);
  assert.equal(await store.collect("tenant-1", 10), 1);
  await store.verify();
  assert.deepEqual(calls, [
    "save_repository_task_plan", "get_repository_task_plan",
    "record_repository_task_plan_cache_hit",
    "recover_repository_task_plans", "repository_task_planner_metrics",
    "collect_repository_task_plans",
    "verify_repository_task_planner_contract",
  ]);

  const migration = await readFile(new URL(
    "../../supabase/migrations/20260827000000_add_repository_task_planner.sql",
    import.meta.url), "utf8");
  for (const contract of [
    "repository_task_plans", "repository_task_execution_phases",
    "repository_task_planning_diagnostics", "repository_task_plan_cache",
    "repository_task_planner_metrics", "repository_task_planner_retention",
    "enable row level security", "service_role", "on delete cascade",
    "repository_task_plan_cache_identity_idx",
    "verify_repository_task_planner_contract",
  ]) assert.ok(migration.includes(contract), contract);
});
