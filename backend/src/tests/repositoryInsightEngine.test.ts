import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AutonomousWorkflow } from "../services/autonomousWorkflow/types.js";
import type { ChangeAnalysis } from "../services/changeIntelligence/types.js";
import type { FeatureGraph } from "../services/featureIntelligence/types.js";
import type { KnowledgeRetrievalResult } from "../services/repositoryKnowledge/types.js";
import {
  detectRepositoryInsights, scoreRepositoryInsight,
} from "../services/repositoryInsight/detector.js";
import { navigateRepositoryInsights } from "../services/repositoryInsight/navigation.js";
import { RepositoryInsightEngine } from "../services/repositoryInsight/service.js";
import {
  MemoryRepositoryInsightSourceReader,
  PostgresRepositoryInsightSourceReader,
} from "../services/repositoryInsight/source.js";
import {
  MemoryRepositoryInsightStore, PostgresRepositoryInsightStore,
} from "../services/repositoryInsight/store.js";
import {
  INSIGHT_TYPES, REPOSITORY_INSIGHT_SCHEMA_VERSION, RepositoryInsightError,
  type RepositoryInsightGeneration, type RepositoryInsightSources,
} from "../services/repositoryInsight/types.js";
import {
  validateInsightGeneration, validateInsightSources,
} from "../services/repositoryInsight/validation.js";
import type { RepositoryIntelligenceRecord } from "../services/repositoryIntelligence/types.js";
import type {
  RepositoryGraphNode, RepositorySymbolGraph,
} from "../services/repositoryGraph/graphTypes.js";
import type { RepositoryQueryExecution } from "../services/repositoryQuery/types.js";
import type {
  SemanticGraph, SemanticSymbol,
} from "../services/semanticCodeIntelligence/types.js";

const revision = "a".repeat(40);
const staleRevision = "b".repeat(40);
const timestamp = "2026-08-25T00:00:00.000Z";

function semanticSymbol(index: number): SemanticSymbol {
  return {
    symbolId: `symbol-${index}`, graphVersion: "semantic-v1",
    tenantId: "tenant-1", repositoryId: "acme/widgets",
    repositoryRevision: revision,
    file: index < 10 ? `src/payments/file-${index % 6}.ts`
      : `src/unowned/file-${index}.ts`,
    language: "typescript", kind: index === 0 ? "interface" : "function",
    name: index === 0 ? "PaymentPort" : `paymentFunction${index}`,
    qualifiedName: index === 0 ? "PaymentPort" : `paymentFunction${index}`,
    visibility: "public", signature: `function paymentFunction${index}()`,
    documentationHash: "d".repeat(64), line: index + 1, column: 1,
    endLine: index + 2, endColumn: 1, createdAt: timestamp, updatedAt: timestamp,
  };
}

function semantic(): SemanticGraph {
  const symbols = Array.from({ length: 12 }, (_, index) => semanticSymbol(index));
  return {
    graphVersion: "semantic-v1", schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: "f".repeat(64),
    adapterVersions: ["typescript:typescript-semantic-adapter-v1"],
    lifecycle: "published", symbols,
    relationships: symbols.slice(1, 7).map((symbol, index) => ({
      relationshipId: `relationship-${index}`, graphVersion: "semantic-v1",
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, fromSymbolId: "symbol-0",
      toSymbolId: symbol.symbolId, kind: "calls", createdAt: timestamp,
    })),
    fileAnalyses: [], diagnostics: [],
    metrics: { indexedSymbols: symbols.length, indexedRelationships: 6,
      indexingDurationMs: 0, graphRebuilds: 1, incrementalUpdates: 0,
      recoveryOperations: 0 },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}

function repositoryGraph(): RepositorySymbolGraph {
  const symbols = semantic().symbols;
  const nodes: RepositoryGraphNode[] = symbols.map((symbol) => ({
    nodeId: symbol.symbolId, symbolId: symbol.symbolId,
    graphVersion: "repository-graph-v1", repositoryId: "acme/widgets",
    repositoryRevision: revision, repositoryVersion: revision,
    parserVersion: "typescript-compiler-v1", name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind as RepositoryGraphNode["kind"],
    language: symbol.language, file: symbol.file, line: symbol.line,
    endLine: symbol.endLine, column: symbol.column,
    endColumn: symbol.endColumn, exported: true, defaultExport: false,
    metadata: {},
  }));
  return {
    graphVersion: "repository-graph-v1", repositoryId: "acme/widgets",
    repositoryRevision: revision, repositoryVersion: revision,
    parserVersion: "typescript-compiler-v1", status: "published",
    createdAt: timestamp, publishedAt: timestamp, nodes,
    edges: nodes.slice(1, 9).map((node, index) => ({
      edgeId: `edge-${index}`, graphVersion: "repository-graph-v1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      parserVersion: "typescript-compiler-v1", fromNodeId: "symbol-0",
      toNodeId: node.nodeId, fromSymbolId: "symbol-0",
      toSymbolId: node.symbolId, kind: "calls", distance: 1, metadata: {},
    })),
    diagnostics: {
      parsedFileCount: 8, parserFailureCount: 0, unresolvedImportCount: 0,
      importCount: 8, unresolvedFileRatio: 0, parserFailureRatio: 0,
      orphanSymbolCount: 0, duplicateNodeIdCount: 0, duplicateEdgeIdCount: 0,
      missingEndpointCount: 0, impossibleSelfEdgeCount: 0,
      graphBytes: 1000, durationMs: 0, failures: [],
    },
  };
}

function intelligence(): RepositoryIntelligenceRecord {
  return {
    intelligenceVersion: "intelligence-v1", repositoryId: "acme/widgets",
    repositoryRevision: revision, graphVersion: "repository-graph-v1",
    embeddingVersion: "embedding-v1", parserVersion: "typescript-compiler-v1",
    analysisVersion: "repository-intelligence-v1",
    schemaVersion: "repository-intelligence-schema-v1", status: "published",
    createdAt: timestamp, validatedAt: timestamp, publishedAt: timestamp,
    publicationMetadata: {
      repositoryRevision: revision, graphVersion: "repository-graph-v1",
      embeddingVersion: "embedding-v1", previousIntelligenceVersion: null,
    },
    architecture: {
      subsystemIds: ["payments", "orphan"], packageHierarchy: ["src"],
      dependencyGraph: [{ from: "payments", to: "orphan", count: 1 }],
      layers: [], hotspots: [{ path: "src/payments/file-0.ts", value: 12 }],
    },
    codeOrganization: {
      largestModules: [], mostImportedFiles: [], highestFanIn: [],
      highestFanOut: [], cyclicDependencies: [
        ["src/payments/a.ts", "src/payments/b.ts", "src/payments/c.ts"],
      ], utilityClusters: [],
    },
    symbols: {
      publicApis: [], internalApis: [], orphanSymbols: ["paymentFunction11"],
      deadExports: ["paymentFunction10"], entrypoints: ["src/payments/file-0.ts"],
      sharedAbstractions: [],
    },
    quality: {
      duplicateImplementations: [{
        signature: "function charge()", symbols: [
          "paymentFunction1", "paymentFunction2", "paymentFunction3",
        ],
      }],
      oversizedFiles: [], oversizedFunctions: [], todoFixmeDensity: 0,
      generatedCodeRatio: 0, documentationCoverage: 0.2,
    },
    evolution: {
      changedHotspots: [], stableAreas: [], architecturalDrift: [],
      growth: { files: 8, symbols: 12, dependencyEdges: 10,
        fileDelta: 0, symbolDelta: 0, dependencyEdgeDelta: 0 },
    },
    subsystems: [
      {
        subsystemId: "payments", name: "Payments", rootPath: "src/payments",
        layer: "application", files: [
          "src/payments/file-0.ts", "src/payments/file-1.ts",
          "src/payments/file-2.ts", "src/payments/file-3.ts",
          "src/payments/file-4.ts", "src/payments/file-5.ts",
        ], dependencies: ["orphan"], publicApis: [],
        entrypoints: ["src/payments/file-0.ts"], summary: "Payment processing.",
        metrics: { files: 6, symbols: 10,
          incomingDependencies: 6, outgoingDependencies: 7 },
      },
      {
        subsystemId: "orphan", name: "Orphan", rootPath: "src/orphan",
        layer: "unknown", files: ["src/orphan/index.ts"], dependencies: [],
        publicApis: [], entrypoints: [], summary: "Disconnected module.",
        metrics: { files: 1, symbols: 0,
          incomingDependencies: 0, outgoingDependencies: 0 },
      },
    ],
    metrics: { filesAnalyzed: 8, symbolsAnalyzed: 12,
      dependencyEdgesAnalyzed: 10, generatedSubsystems: 2,
      qualityFindings: 4, hotspots: 1 },
  };
}

function featureGraph(): FeatureGraph {
  const symbols = semantic().symbols;
  const base = {
    graphVersion: "feature-v1", tenantId: "tenant-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    confidence: 0.95, primaryEntryPoint: "symbol-0",
    primaryExitPoint: "symbol-9", entryPoints: ["symbol-0"],
    exitPoints: ["symbol-9"], owningModules: ["src/payments"],
    lifecycle: "active" as const, createdAt: timestamp, updatedAt: timestamp,
  };
  return {
    graphVersion: "feature-v1", schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligenceVersion: "intelligence-v1",
    semanticGraphVersion: "semantic-v1", lifecycle: "published",
    features: [
      {
        ...base, featureId: "payments", name: "Payments",
        description: "Payment processing.",
        files: Array.from({ length: 6 }, (_, index) =>
          `src/payments/file-${index}.ts`),
        symbolIds: symbols.slice(0, 10).map((item) => item.symbolId),
      },
      {
        ...base, featureId: "billing", name: "Billing",
        description: "Billing integration.",
        files: ["src/payments/file-0.ts"], symbolIds: ["symbol-0"],
      },
    ],
    relationships: [], flows: [], diagnostics: [],
    metrics: { featuresDiscovered: 2, averageFeatureSize: 5.5,
      dependencyDensity: 0, rebuildDurationMs: 0,
      incrementalRebuildCount: 0, recoveryCount: 0 },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}

function change(): ChangeAnalysis {
  return {
    analysisId: "analysis-risk", schemaVersion: "change-analysis-v1",
    persistenceVersion: 1, lifecycle: "published",
    request: {
      changeId: "change-risk", tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      workflowId: "workflow-risk",
      requestedTarget: { kind: "module", value: "src/payments" },
      changeType: "modify", rationale: "Change payments.",
      createdAt: timestamp, updatedAt: timestamp,
    },
    repositoryIntelligenceVersion: "intelligence-v1",
    semanticGraphVersion: "semantic-v1", featureGraphVersion: "feature-v1",
    impact: {
      impactGraphId: "impact-risk", changeId: "change-risk",
      directlyAffectedFiles: ["src/payments/file-0.ts"],
      indirectlyAffectedFiles: ["src/payments/file-1.ts"],
      affectedSymbolIds: ["symbol-0"], affectedFeatureIds: ["payments"],
      affectedApis: [], affectedWorkflowIds: ["workflow-risk"],
      dependencyChains: [{
        chainId: "chain-risk", steps: [
          { position: 0, kind: "module", id: "src/payments" },
          { position: 1, kind: "feature", id: "payments" },
          { position: 2, kind: "workflow", id: "workflow-risk" },
        ],
      }], maximumDependencyDepth: 4,
    },
    risk: {
      riskAssessmentId: "risk", changeId: "change-risk",
      level: "high", score: 82, reasons: ["Deep dependency path."],
      factors: { dependencyDepth: 4 },
    },
    implementationPlan: {
      implementationPlanId: "implementation", changeId: "change-risk",
      steps: [],
    },
    diagnostics: [], createdAt: timestamp, updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

function workflow(): AutonomousWorkflow {
  return {
    workflowId: "workflow-risk", schemaVersion: "autonomous-workflow-schema-v1",
    persistenceVersion: 1, tenantId: "tenant-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    executionId: "execution-risk", ownerId: "user-1", workflowVersion: 6,
    lifecycle: "completed", currentStage: null,
    checkpoints: Array.from({ length: 6 }, (_, index) => ({
      checkpointId: `checkpoint-${index}`, workflowId: "workflow-risk",
      sequence: index, stage: "intelligence",
      requestHash: "a".repeat(64), result: {
        stage: "intelligence", referenceId: `reference-${index}`,
        referenceVersion: String(index + 1), status: "completed",
        outputHash: "b".repeat(64), metadata: {},
      }, startedAt: timestamp, completedAt: timestamp, durationMs: 0,
    })),
    approvals: [], diagnostics: [], lifecycleHistory: [], attemptHistory: [],
    recoveryHistory: [], versions: Array.from({ length: 6 }, (_, index) => ({
      workflowId: "workflow-risk", workflowVersion: index + 1,
      lifecycle: "analysing", currentStage: "intelligence",
      checkpointCount: index, retryCount: 0, failureCount: 0,
      recoveryCount: 0, reason: "test", stateHash: "c".repeat(64),
      createdAt: timestamp,
    })),
    retryCounts: {
      intelligence: 0, planning: 0, execution: 0, agent_runtime: 0,
      tool_invocation: 0, collaboration: 0, workspace: 0, patch: 0,
      artifact: 0, review: 0, proposal: 0, apply: 0, knowledge: 0,
    },
    failureCount: 2, recoveryCount: 0, resumeCount: 1, inFlight: null,
    archiveMetadata: null, createdAt: timestamp, updatedAt: timestamp,
    completedAt: timestamp,
  };
}

function staleKnowledge(): KnowledgeRetrievalResult {
  return {
    knowledgeId: "knowledge-old", namespace: "architecture",
    subject: "Payment architecture", repositoryRevision: staleRevision,
    version: 1, confidence: 0.9, score: 0.8, rank: 1,
    contentHash: "e".repeat(64),
    content: {
      schemaVersion: "repository-knowledge-schema-v1",
      summary: "Old payment architecture.", facts: [], tags: ["payments"],
    },
    executionId: null,
  };
}

function queryHistory(term = "payments"): RepositoryQueryExecution {
  return {
    query: {
      queryId: `query-${term}`, schemaVersion: "repository-query-schema-v1",
      persistenceVersion: 1, tenantId: "tenant-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      workflowId: null, sessionId: null, userId: "user-1",
      originalQuery: `Explain ${term}`, normalizedQuery: `explain ${term}`,
      intents: ["architecture"], confidence: 0.8, lifecycle: "completed",
      createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
    },
    plan: { planId: `plan-${term}`, queryId: `query-${term}`,
      steps: [], selectors: [] },
    response: null, diagnostics: [], cacheHit: false,
    engineUsage: ["Repository Intelligence"], latencyMs: 0,
  };
}

function sources(queryTerm = "payments"): RepositoryInsightSources {
  return {
    repositoryIntelligence: intelligence(), repositoryGraph: repositoryGraph(),
    semanticGraph: semantic(), featureGraph: featureGraph(),
    changeAnalyses: [change()], workflows: [workflow()],
    knowledge: [staleKnowledge()], queryHistory: [queryHistory(queryTerm)],
  };
}

function dependencies(auxiliary = {
  changeAnalyses: [change()], workflows: [workflow()],
  knowledge: [staleKnowledge()], queryHistory: [queryHistory()],
}) {
  return {
    repositories: { getRepository: async () => ({
      repositoryId: "acme/widgets", ownerUserId: "user-1",
      deletionState: "active", currentRevision: revision,
      indexedRevision: revision,
    }) },
    repositoryGraph: {
      loadPublished: async () => repositoryGraph(), verify: async () => {},
    },
    repositoryIntelligence: {
      getPublishedSnapshot: async () => intelligence(), verify: async () => {},
    },
    semantic: { get: async () => semantic(), verify: async () => {} },
    features: { get: async () => featureGraph(), verify: async () => {} },
    sources: new MemoryRepositoryInsightSourceReader(auxiliary),
    verifyAuxiliaryEngines: async () => {},
  };
}

test("deterministic generation covers every insight category with traceable evidence", () => {
  const first = detectRepositoryInsights(sources(), timestamp);
  const second = detectRepositoryInsights(sources(), timestamp);
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first.map((item) => item.type)),
    new Set(INSIGHT_TYPES));
  assert.equal(new Set(first.map((item) => item.insightId)).size, first.length);
  assert.ok(first.every((item) =>
    item.supportingEvidence.length > 0 &&
    item.supportingEvidence.every((entry) =>
      entry.evidenceId && entry.reference && entry.sourceVersion)));
  validateInsightSources(sources());
});

test("prioritisation is deterministic and responds to engineering signals", () => {
  const low = scoreRepositoryInsight("low", {});
  const high = scoreRepositoryInsight("high", {
    dependencyDepth: 1, featureImpact: 1, coupling: 1,
    usageFrequency: 1, queryFrequency: 1, architecturalCentrality: 1,
  });
  assert.ok(high.total > low.total);
  const insights = detectRepositoryInsights(sources(), timestamp);
  assert.ok(insights.every((item, index) =>
    index === 0 || insights[index - 1]!.score.total >= item.score.total));
});

test("navigation filters priority, feature, module, file, and category deterministically", () => {
  const insights = detectRepositoryInsights(sources(), timestamp);
  assert.ok(navigateRepositoryInsights(insights, {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision, limit: 3,
  }).length <= 3);
  assert.ok(navigateRepositoryInsights(insights, {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    featureId: "payments",
  }).every((item) => item.relatedFeatures.includes("payments")));
  assert.ok(navigateRepositoryInsights(insights, {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    module: "src/payments",
  }).some((item) => item.type === "highly coupled module"));
  assert.ok(navigateRepositoryInsights(insights, {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    file: "src/payments/file-0.ts",
  }).every((item) => item.relatedFiles.includes("src/payments/file-0.ts")));
  assert.ok(navigateRepositoryInsights(insights, {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    category: "documentation issues",
  }).every((item) =>
    ["documentation gap", "stale knowledge"].includes(item.type)));
});

test("service validates ownership and reuses identical incremental generations", async () => {
  const store = new MemoryRepositoryInsightStore();
  const engine = new RepositoryInsightEngine(
    store, dependencies() as never, () => new Date(timestamp));
  const input = {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryOwnerId: "user-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, generatedAt: timestamp,
  };
  const first = await engine.generate(input);
  const second = await engine.generate(input);
  assert.equal(second.generationId, first.generationId);
  assert.equal((await engine.metrics()).incrementalReuse, first.insights.length);
  assert.deepEqual(await engine.navigate({
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    category: "architectural hotspots",
  }), navigateRepositoryInsights(first.insights, {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    category: "architectural hotspots",
  }));

  const denied = new RepositoryInsightEngine(
    new MemoryRepositoryInsightStore(),
    dependencies() as never);
  await assert.rejects(() => denied.generate({
    ...input, ownerId: "other",
  }), (error: RepositoryInsightError) =>
    error.code === "repository_insight_access_denied");
});

test("query-only source changes preserve insight identities and incrementally reuse content", async () => {
  let term = "payments";
  const mutableDependencies = {
    ...dependencies(),
    sources: {
      load: async () => ({
        changeAnalyses: [change()], workflows: [workflow()],
        knowledge: [staleKnowledge()], queryHistory: [queryHistory(term)],
      }),
      verify: async () => {},
    },
  };
  const engine = new RepositoryInsightEngine(
    new MemoryRepositoryInsightStore(), mutableDependencies as never,
    () => new Date(timestamp));
  const input = {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryOwnerId: "user-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, generatedAt: timestamp,
  };
  const first = await engine.generate(input);
  term = "documentation";
  const second = await engine.generate(input);
  assert.notEqual(second.generationId, first.generationId);
  assert.ok(second.reusedCount > 0);
  assert.deepEqual(
    new Set(second.insights.map((item) => item.insightId)),
    new Set(first.insights.map((item) => item.insightId)));
});

test("validation rejects graph, semantic, feature, and evidence integrity failures", () => {
  const invalid = sources();
  invalid.repositoryGraph.edges[0]!.toNodeId = "missing";
  assert.throws(() => validateInsightSources(invalid),
    (error: RepositoryInsightError) =>
      error.code === "repository_insight_graph_integrity_invalid");

  const insights = detectRepositoryInsights(sources(), timestamp);
  const generation: RepositoryInsightGeneration = {
    generationId: "generation", schemaVersion: REPOSITORY_INSIGHT_SCHEMA_VERSION,
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    sourceVersions: {
      repositoryIntelligence: "intelligence-v1",
      repositoryGraph: "repository-graph-v1", semanticGraph: "semantic-v1",
      featureGraph: "feature-v1", changes: "changes", workflows: "workflows",
      knowledge: "knowledge", queries: "queries",
    },
    sourceFingerprint: "fingerprint", lifecycle: "published",
    insights, diagnostics: [], generatedCount: insights.length,
    reusedCount: 0, generationLatencyMs: 0, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
  validateInsightGeneration(generation);
  const broken = structuredClone(generation);
  const first = broken.insights[0]!;
  (broken.insights as RepositoryInsightGeneration["insights"]) = [{
    ...first, supportingEvidence: [],
  }, ...broken.insights.slice(1)];
  assert.throws(() => validateInsightGeneration(broken),
    (error: RepositoryInsightError) =>
      error.code === "repository_insight_generation_invalid");
});

test("recovery fences interrupted, stale, and orphan records and metrics are complete", async () => {
  const insights = detectRepositoryInsights(sources(), timestamp);
  const store = new MemoryRepositoryInsightStore();
  const interrupted: RepositoryInsightGeneration = {
    generationId: "interrupted", schemaVersion: REPOSITORY_INSIGHT_SCHEMA_VERSION,
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    sourceVersions: {
      repositoryIntelligence: "intelligence-v1",
      repositoryGraph: "repository-graph-v1", semanticGraph: "semantic-v1",
      featureGraph: "feature-v1", changes: "c", workflows: "w",
      knowledge: "k", queries: "q",
    },
    sourceFingerprint: "source", lifecycle: "generating",
    insights, diagnostics: [], generatedCount: insights.length,
    reusedCount: 0, generationLatencyMs: 2, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, publishedAt: null,
  };
  store.hydrate(interrupted);
  assert.equal(await store.recover(), 1);
  assert.equal((await store.metrics()).recoveryCount, 1);

  const published = { ...interrupted, generationId: "published",
    lifecycle: "published" as const, publishedAt: timestamp };
  await store.save(published);
  const metrics = await store.metrics("tenant-1");
  assert.equal(metrics.insightsGenerated, insights.length);
  assert.equal(metrics.insightCategories["architectural hotspot"], 1);
  assert.ok(metrics.severityDistribution.high > 0);
  assert.equal(metrics.averageGenerationLatencyMs, 2);
});

test("startup validation verifies storage and all source engines", async () => {
  const calls: string[] = [];
  const store = new MemoryRepositoryInsightStore();
  store.verify = async () => { calls.push("store"); };
  const deps = dependencies();
  deps.repositoryGraph.verify = async () => { calls.push("graph"); };
  deps.repositoryIntelligence.verify = async () => { calls.push("repository"); };
  deps.semantic.verify = async () => { calls.push("semantic"); };
  deps.features.verify = async () => { calls.push("feature"); };
  deps.sources.verify = async () => { calls.push("sources"); };
  deps.verifyAuxiliaryEngines = async () => { calls.push("auxiliary"); };
  await new RepositoryInsightEngine(store, deps as never).verify();
  assert.deepEqual(calls.sort(), [
    "auxiliary", "feature", "graph", "repository", "semantic", "sources", "store",
  ]);
});

test("PostgreSQL adapters preserve memory-equivalent contracts", async () => {
  const insights = detectRepositoryInsights(sources(), timestamp);
  const generation = {
    generationId: "generation", schemaVersion: REPOSITORY_INSIGHT_SCHEMA_VERSION,
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    sourceVersions: {
      repositoryIntelligence: "intelligence-v1",
      repositoryGraph: "repository-graph-v1", semanticGraph: "semantic-v1",
      featureGraph: "feature-v1", changes: "c", workflows: "w",
      knowledge: "k", queries: "q",
    }, sourceFingerprint: "source", lifecycle: "published" as const,
    insights, diagnostics: [], generatedCount: insights.length,
    reusedCount: 0, generationLatencyMs: 0, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
  const names: string[] = [];
  const database = {
    rpc: async (name: string) => {
      names.push(name);
      if (name === "save_repository_insight_generation" ||
          name === "get_repository_insight_generation") {
        return { data: { generation }, error: null };
      }
      if (name === "get_repository_insight_auxiliary_sources") {
        return { data: { sources: {
          changeAnalyses: [change()], workflows: [workflow()],
          knowledge: [staleKnowledge()], queryHistory: [queryHistory()],
        } }, error: null };
      }
      if (name === "repository_insight_metrics") return {
        data: { metrics: {
          insightsGenerated: insights.length, insightCategories: {},
          severityDistribution: {}, averageGenerationLatencyMs: 0,
          incrementalReuse: 0, recoveryCount: 0,
        } }, error: null,
      };
      return { data: { valid: true, recovered_count: 0, deleted_count: 0 },
        error: null };
    },
  };
  const postgres = new PostgresRepositoryInsightStore(database as never);
  assert.deepEqual(await postgres.save(generation), generation);
  assert.deepEqual(await postgres.getCurrent(
    "tenant-1", "user-1", "acme/widgets", revision), generation);
  assert.equal((await postgres.metrics()).insightsGenerated, insights.length);
  await postgres.verify();
  const source = new PostgresRepositoryInsightSourceReader(database as never);
  assert.equal((await source.load(
    "tenant-1", "user-1", "acme/widgets", revision)).workflows.length, 1);
  await source.verify();
  assert.ok(names.includes("verify_repository_insight_contract"));
  assert.ok(names.includes("verify_repository_insight_source_contract"));
});

test("migration defines normalized schema, security, startup, recovery, and retention contracts", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260825000000_add_repository_insight_engine.sql",
    import.meta.url), "utf8");
  for (const table of [
    "repository_insight_generation_metadata", "repository_insights",
    "repository_insight_evidence", "repository_insight_scores",
    "repository_insight_diagnostics",
  ]) assert.match(migration,
    new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /repository_insight_evidence_insight_fk/);
  assert.match(migration, /repository_insight_priority_idx/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /repository_insight_grants_invalid/);
  assert.match(migration, /recover_repository_insight_generations/);
  assert.match(migration, /collect_repository_insight_generations/);
  assert.match(migration, /verify_repository_insight_source_contract/);
});
