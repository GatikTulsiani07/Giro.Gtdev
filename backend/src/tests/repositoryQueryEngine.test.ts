import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  classifyRepositoryQuery, deterministicRepositoryQueryId,
  normalizeRepositoryQuery,
} from "../services/repositoryQuery/classifier.js";
import { buildRepositoryQueryPlan } from "../services/repositoryQuery/planner.js";
import { RepositoryQueryEngine } from "../services/repositoryQuery/service.js";
import {
  MemoryRepositoryQueryStore, PostgresRepositoryQueryStore,
} from "../services/repositoryQuery/store.js";
import {
  REPOSITORY_QUERY_SCHEMA_VERSION, RepositoryQueryError,
  type RepositoryQueryExecution, type RepositoryQueryInput,
} from "../services/repositoryQuery/types.js";
import type { RepositoryIntelligenceRecord } from "../services/repositoryIntelligence/types.js";
import type { SemanticGraph } from "../services/semanticCodeIntelligence/types.js";
import type { FeatureGraph } from "../services/featureIntelligence/types.js";

const revision = "a".repeat(40);
const timestamp = "2026-08-24T00:00:00.000Z";
const baseInput: RepositoryQueryInput = {
  tenantId: "tenant-1", userId: "user-1", repositoryOwnerId: "user-1",
  repositoryId: "acme/widgets", repositoryRevision: revision,
  query: "Where is JWT validated?", requestedAt: timestamp,
};

function intelligence(): RepositoryIntelligenceRecord {
  return {
    intelligenceVersion: "intelligence-v1", repositoryId: "acme/widgets",
    repositoryRevision: revision, graphVersion: "repository-graph-v1",
    embeddingVersion: "embedding-v1", parserVersion: "parser-v1",
    analysisVersion: "repository-intelligence-v1",
    schemaVersion: "repository-intelligence-schema-v1", status: "published",
    createdAt: timestamp, validatedAt: timestamp, publishedAt: timestamp,
    publicationMetadata: {
      repositoryRevision: revision, graphVersion: "repository-graph-v1",
      embeddingVersion: "embedding-v1", previousIntelligenceVersion: null,
    },
    architecture: {
      subsystemIds: ["auth"], packageHierarchy: ["src"],
      dependencyGraph: [], layers: [{ name: "service", paths: ["src/auth"] }],
      hotspots: [{ path: "src/auth/jwt.ts", value: 3 }],
    },
    codeOrganization: {
      largestModules: [{ path: "src/auth/jwt.ts", value: 100 }],
      mostImportedFiles: [], highestFanIn: [], highestFanOut: [],
      cyclicDependencies: [], utilityClusters: [],
    },
    symbols: {
      publicApis: [], internalApis: [], orphanSymbols: [], deadExports: [],
      entrypoints: ["src/auth/route.ts"], sharedAbstractions: [],
    },
    quality: {
      duplicateImplementations: [], oversizedFiles: [], oversizedFunctions: [],
      todoFixmeDensity: 0, generatedCodeRatio: 0, documentationCoverage: 1,
    },
    evolution: {
      changedHotspots: [], stableAreas: ["src/auth"], architecturalDrift: [],
      growth: { files: 2, symbols: 2, dependencyEdges: 1,
        fileDelta: 0, symbolDelta: 0, dependencyEdgeDelta: 0 },
    },
    subsystems: [{
      subsystemId: "auth", name: "Authentication", rootPath: "src/auth",
      layer: "service", files: ["src/auth/route.ts", "src/auth/jwt.ts"],
      dependencies: [], publicApis: [], entrypoints: ["src/auth/route.ts"],
      summary: "JWT authentication.", metrics: {
        files: 2, symbols: 2, incomingDependencies: 0, outgoingDependencies: 0,
      },
    }],
    metrics: { filesAnalyzed: 2, symbolsAnalyzed: 2,
      dependencyEdgesAnalyzed: 1, generatedSubsystems: 1,
      qualityFindings: 0, hotspots: 1 },
  };
}

function semantic(): SemanticGraph {
  const symbol = (symbolId: string, name: string, file: string, line: number) => ({
    symbolId, graphVersion: "semantic-v1", tenantId: "tenant-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    file, language: "typescript" as const, kind: "function" as const, name,
    qualifiedName: name, visibility: "public" as const,
    signature: `function ${name}()`, documentationHash: "d".repeat(64),
    line, column: 1, endLine: line + 1, endColumn: 1,
    createdAt: timestamp, updatedAt: timestamp,
  });
  return {
    graphVersion: "semantic-v1", schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: "f".repeat(64),
    adapterVersions: ["typescript:typescript-semantic-adapter-v1"],
    lifecycle: "published",
    symbols: [
      symbol("route", "authenticationRoute", "src/auth/route.ts", 4),
      symbol("jwt", "validateJwt", "src/auth/jwt.ts", 12),
    ],
    relationships: [{
      relationshipId: "calls", graphVersion: "semantic-v1",
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, fromSymbolId: "route", toSymbolId: "jwt",
      kind: "calls", createdAt: timestamp,
    }],
    fileAnalyses: [], diagnostics: [],
    metrics: { indexedSymbols: 2, indexedRelationships: 1,
      indexingDurationMs: 0, graphRebuilds: 1, incrementalUpdates: 0,
      recoveryOperations: 0 },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}

function features(): FeatureGraph {
  return {
    graphVersion: "feature-v1", schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligenceVersion: "intelligence-v1",
    semanticGraphVersion: "semantic-v1", lifecycle: "published",
    features: [{
      featureId: "auth-feature", graphVersion: "feature-v1",
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, name: "Authentication",
      description: "Authentication starts at authenticationRoute and validates JWT.",
      confidence: 0.95, primaryEntryPoint: "route", primaryExitPoint: "jwt",
      entryPoints: ["route"], exitPoints: ["jwt"], owningModules: ["src/auth"],
      files: ["src/auth/route.ts", "src/auth/jwt.ts"],
      symbolIds: ["route", "jwt"], lifecycle: "active",
      createdAt: timestamp, updatedAt: timestamp,
    }],
    relationships: [], flows: [{
      flowId: "auth-flow", graphVersion: "feature-v1",
      featureId: "auth-feature", entryPoint: "route", exitPoint: "jwt",
      steps: [
        { position: 0, kind: "http_route", symbolId: "route",
          file: "src/auth/route.ts", label: "authenticationRoute" },
        { position: 1, kind: "service", symbolId: "jwt",
          file: "src/auth/jwt.ts", label: "validateJwt" },
      ], createdAt: timestamp,
    }],
    diagnostics: [], metrics: {
      featuresDiscovered: 1, averageFeatureSize: 2, dependencyDensity: 0,
      rebuildDurationMs: 0, incrementalRebuildCount: 0, recoveryCount: 0,
    },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    repositories: { getRepository: async () => ({
      repositoryId: "acme/widgets", ownerUserId: "user-1",
      deletionState: "active", currentRevision: revision,
      indexedRevision: revision,
    }) },
    repositoryIntelligence: {
      getPublishedSnapshot: async () => intelligence(),
      verify: async () => {},
    },
    semantic: { get: async () => semantic(), verify: async () => {} },
    features: { get: async () => features(), verify: async () => {} },
    changes: { analyze: async () => { throw new Error("not expected"); },
      verify: async () => {} },
    knowledge: { retrieve: async () => [], verify: async () => {} },
    workflows: { get: async () => null, verify: async () => {} },
    ...overrides,
  };
}

function interrupted(): RepositoryQueryExecution {
  const queryId = deterministicRepositoryQueryId(baseInput);
  const classified = classifyRepositoryQuery(baseInput.query);
  const normalized = normalizeRepositoryQuery(baseInput.query);
  return {
    query: {
      queryId, schemaVersion: REPOSITORY_QUERY_SCHEMA_VERSION,
      persistenceVersion: 1, tenantId: "tenant-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      workflowId: null, sessionId: null, userId: "user-1",
      originalQuery: baseInput.query, normalizedQuery: normalized,
      intents: classified.intents, confidence: classified.confidence,
      lifecycle: "running", createdAt: timestamp, updatedAt: timestamp,
      completedAt: null,
    },
    plan: buildRepositoryQueryPlan(queryId, classified.intents, normalized),
    response: null, diagnostics: [], cacheHit: false, engineUsage: [],
    latencyMs: 0,
  };
}

test("query identity, normalization, multi-intent classification, and planning are deterministic", () => {
  assert.equal(normalizeRepositoryQuery("  Where   is “JWT” validated? "),
    "where is jwt validated?");
  assert.equal(deterministicRepositoryQueryId(baseInput),
    deterministicRepositoryQueryId({ ...baseInput, query: " WHERE is JWT validated? " }));
  assert.notEqual(deterministicRepositoryQueryId(baseInput),
    deterministicRepositoryQueryId({ ...baseInput, repositoryRevision: "b".repeat(40) }));
  const classified = classifyRepositoryQuery("What breaks if I modify this service?");
  assert.deepEqual(classified.intents, ["change impact"]);
  const plan = buildRepositoryQueryPlan("query-1", classified.intents,
    "what breaks if i modify this service?");
  assert.deepEqual(plan.steps.map((step) => step.engine), [
    "Repository Intelligence", "Semantic Code Intelligence",
    "Feature Intelligence", "Change Intelligence",
  ]);
  assert.equal(new Set(plan.steps.map((step) => step.engine)).size, plan.steps.length);
});

test("navigation orchestration returns only evidence-backed applicable sections and caches identical ownership", async () => {
  const store = new MemoryRepositoryQueryStore();
  const engine = new RepositoryQueryEngine(store, dependencies() as never,
    () => new Date(timestamp));
  const first = await engine.query(baseInput);
  assert.equal(first.query.lifecycle, "completed");
  assert.equal(first.cacheHit, false);
  assert.deepEqual(first.engineUsage, [
    "Repository Intelligence", "Semantic Code Intelligence",
    "Feature Intelligence",
  ]);
  assert.deepEqual(first.response?.relevantFiles,
    ["src/auth/jwt.ts", "src/auth/route.ts"]);
  assert.deepEqual(first.response?.relevantSymbols?.map((item) => item.name),
    ["validateJwt", "authenticationRoute"]);
  assert.equal(first.response?.relatedFeatures?.[0]?.name, "Authentication");
  assert.equal(first.response?.featureFlow?.[0]?.steps[1]?.label, "validateJwt");
  assert.equal(first.response?.implementationRoadmap, undefined);
  assert.equal(first.response?.knowledgeReferences, undefined);
  const second = await engine.query(baseInput);
  assert.equal(second.cacheHit, true);
  assert.equal((await engine.metrics()).cacheHits, 1);
});

test("overview and architecture navigation return deterministic read-first repository context", async () => {
  const engine = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(), dependencies() as never,
    () => new Date(timestamp));
  const result = await engine.query({
    ...baseInput, query: "Explain this repository. Which files should I read first?",
  });
  assert.ok(result.response?.architecture);
  assert.deepEqual(result.response?.relevantFiles,
    ["src/auth/jwt.ts", "src/auth/route.ts"]);
  assert.match(result.response?.summary ?? "", /Published repository intelligence/);
});

test("change-impact queries invoke existing change intelligence and expose its roadmap without code execution", async () => {
  const engine = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(), dependencies({
      changes: {
        analyze: async (input: { requestedTarget: { kind: string; value: string } }) => ({
          analysisId: "analysis-1", schemaVersion: "change-analysis-v1",
          persistenceVersion: 1, lifecycle: "published",
          request: {}, repositoryIntelligenceVersion: "intelligence-v1",
          semanticGraphVersion: "semantic-v1", featureGraphVersion: "feature-v1",
          impact: {
            impactGraphId: "impact-1", changeId: "change-1",
            directlyAffectedFiles: ["src/auth/jwt.ts"],
            indirectlyAffectedFiles: ["src/auth/route.ts"],
            affectedSymbolIds: ["jwt"], affectedFeatureIds: ["auth-feature"],
            affectedApis: [], affectedWorkflowIds: [],
            dependencyChains: [], maximumDependencyDepth: 1,
            target: input.requestedTarget,
          },
          risk: {
            riskAssessmentId: "risk-1", changeId: "change-1",
            level: "medium", score: 35, reasons: ["Authentication depends on JWT validation."],
            factors: { directFiles: 1 },
          },
          implementationPlan: {
            implementationPlanId: "plan-1", changeId: "change-1",
            steps: [{ stepId: "step-1", position: 0, phase: "implementation",
              action: "Modify the traced JWT validation symbol.",
              targets: ["src/auth/jwt.ts"] }],
          },
          diagnostics: [], createdAt: timestamp, updatedAt: timestamp,
          publishedAt: timestamp,
        }),
        verify: async () => {},
      },
    }) as never, () => new Date(timestamp));
  const result = await engine.query({
    ...baseInput, query: "What breaks if I modify src/auth/jwt.ts?",
  });
  assert.equal(result.query.lifecycle, "completed");
  assert.equal(result.engineUsage.at(-1), "Change Intelligence");
  assert.deepEqual(result.response?.changeImpact?.impact.directlyAffectedFiles,
    ["src/auth/jwt.ts"]);
  assert.equal(result.response?.implementationRoadmap?.steps[0]?.targets[0],
    "src/auth/jwt.ts");
});

test("optional engine failures return deterministic partial responses with diagnostics", async () => {
  const engine = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(), dependencies({
      knowledge: {
        retrieve: async () => { throw new Error("temporarily unavailable"); },
        verify: async () => {},
      },
    }) as never, () => new Date(timestamp));
  const result = await engine.query({
    ...baseInput, query: "What repository knowledge documents this decision?",
  });
  assert.equal(result.query.lifecycle, "partial");
  assert.equal(result.response?.knowledgeReferences, undefined);
  assert.equal(result.diagnostics[0]?.engine, "Repository Knowledge");
});

test("ownership and revision fencing fail before intelligence orchestration", async () => {
  const denied = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(),
    dependencies({ repositories: { getRepository: async () => ({
      repositoryId: "acme/widgets", ownerUserId: "other",
      deletionState: "active", currentRevision: revision,
      indexedRevision: revision,
    }) } }) as never);
  await assert.rejects(() => denied.query(baseInput),
    (error: RepositoryQueryError) => error.code === "repository_query_access_denied");
  const stale = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(),
    dependencies({ repositories: { getRepository: async () => ({
      repositoryId: "acme/widgets", ownerUserId: "user-1",
      deletionState: "active", currentRevision: "b".repeat(40),
      indexedRevision: "b".repeat(40),
    }) } }) as never);
  await assert.rejects(() => stale.query(baseInput),
    (error: RepositoryQueryError) => error.code === "repository_query_revision_conflict");
});

test("published graph integrity and feature lineage are validated", async () => {
  const brokenSemantic = semantic();
  (brokenSemantic.relationships as Array<SemanticGraph["relationships"][number]>).push({
    ...brokenSemantic.relationships[0]!, relationshipId: "orphan",
    toSymbolId: "missing",
  });
  const engine = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(),
    dependencies({ semantic: {
      get: async () => brokenSemantic, verify: async () => {},
    } }) as never, () => new Date(timestamp));
  const result = await engine.query(baseInput);
  assert.equal(result.query.lifecycle, "failed");
  assert.equal(result.response, null);
  assert.equal(result.diagnostics[0]?.code, "repository_query_graph_integrity_invalid");
});

test("memory recovery fences interrupted and stale cached results and reports metrics", async () => {
  const store = new MemoryRepositoryQueryStore();
  const running = interrupted();
  store.hydrate(running);
  assert.equal(await store.recover(), 1);
  const recovered = await store.get("tenant-1", "user-1", running.query.queryId);
  assert.equal(recovered?.query.lifecycle, "failed");
  assert.equal(recovered?.response, null);
  assert.equal((await store.metrics("tenant-1")).recoveryCount, 1);
  assert.equal((await store.metrics("tenant-1")).intentDistribution.navigation, 1);

  const stale: RepositoryQueryExecution = {
    ...running,
    query: { ...running.query, queryId: "query_stale", lifecycle: "completed",
      completedAt: timestamp },
    plan: { ...running.plan, queryId: "query_stale", planId: "plan_stale" },
    response: {
      queryId: "query_stale", repositoryId: "acme/widgets",
      repositoryRevision: "b".repeat(40), intents: running.query.intents,
      confidence: 0.7,
    },
  };
  store.hydrate(stale);
  assert.equal(await store.recover(), 1);
  assert.equal((await store.get("tenant-1", "user-1", "query_stale"))?.response, null);
});

test("startup validation checks storage and every registered intelligence engine", async () => {
  const verified: string[] = [];
  const store = new MemoryRepositoryQueryStore();
  store.verify = async () => { verified.push("store"); };
  const engine = new RepositoryQueryEngine(store, dependencies({
    repositoryIntelligence: {
      getPublishedSnapshot: async () => intelligence(),
      verify: async () => { verified.push("repository"); },
    },
    semantic: { get: async () => semantic(), verify: async () => { verified.push("semantic"); } },
    features: { get: async () => features(), verify: async () => { verified.push("feature"); } },
    changes: { analyze: async () => null, verify: async () => { verified.push("change"); } },
    knowledge: { retrieve: async () => [], verify: async () => { verified.push("knowledge"); } },
    workflows: { get: async () => null, verify: async () => { verified.push("workflow"); } },
  }) as never);
  await engine.verify();
  assert.deepEqual(verified.sort(),
    ["change", "feature", "knowledge", "repository", "semantic", "store", "workflow"]);

  const unavailable = new RepositoryQueryEngine(
    new MemoryRepositoryQueryStore(), dependencies({
      features: {
        get: async () => features(),
        verify: async () => { throw new Error("feature engine unavailable"); },
      },
    }) as never);
  await assert.rejects(() => unavailable.verify(), /feature engine unavailable/);
});

test("PostgreSQL adapter preserves the same execution contract as memory", async () => {
  const expected = { ...interrupted(), query: {
    ...interrupted().query, persistenceVersion: 2,
  } };
  const calls: string[] = [];
  const postgres = new PostgresRepositoryQueryStore({
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "save_repository_query") {
        return { data: { execution: expected }, error: null };
      }
      if (name === "get_repository_query") {
        return { data: { execution: expected }, error: null };
      }
      if (name === "repository_query_metrics") {
        return { data: { metrics: {
          queries: 1, cacheHits: 0, averageLatencyMs: 0,
          engineUsage: {}, intentDistribution: {},
          confidenceDistribution: { low: 0, medium: 1, high: 0 },
          recoveryCount: 0,
        } }, error: null };
      }
      return { data: { valid: true, recovered_count: 0, deleted_count: 0 },
        error: null };
    },
  } as never);
  assert.deepEqual(await postgres.save(interrupted()), expected);
  assert.deepEqual(await postgres.get("tenant-1", "user-1", expected.query.queryId),
    expected);
  assert.equal((await postgres.metrics()).queries, 1);
  await postgres.verify();
  assert.deepEqual(calls, [
    "save_repository_query", "get_repository_query",
    "repository_query_metrics", "verify_repository_query_contract",
  ]);
});

test("migration defines durable query, plan, cache, diagnostic, metrics, security, and retention contracts", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260824000000_add_repository_query_engine.sql",
    import.meta.url), "utf8");
  for (const table of [
    "repository_queries", "repository_query_plans",
    "repository_query_cached_responses", "repository_query_diagnostics",
    "repository_query_metrics",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /repository_query_plan_query_fk/);
  assert.match(migration, /repository_queries_cache_lookup_idx/);
  assert.match(migration, /verify_repository_query_contract/);
  assert.match(migration, /collect_repository_queries/);
  assert.match(migration, /repository_query_grants_invalid/);
});
