import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AutonomousWorkflow } from "../services/autonomousWorkflow/types.js";
import type { FeatureGraph } from "../services/featureIntelligence/types.js";
import type { KnowledgeRetrievalResult } from "../services/repositoryKnowledge/types.js";
import {
  buildEvolutionTimelines, compareRepositoryEvolution,
  generateEvolutionTrends,
} from "../services/repositoryEvolution/comparison.js";
import { navigateEvolutionHistory } from "../services/repositoryEvolution/navigation.js";
import {
  RepositoryEvolutionIntelligenceEngine,
} from "../services/repositoryEvolution/service.js";
import {
  MemoryRepositoryEvolutionSourceReader,
  PostgresRepositoryEvolutionSourceReader,
} from "../services/repositoryEvolution/source.js";
import {
  MemoryRepositoryEvolutionStore, PostgresRepositoryEvolutionStore,
} from "../services/repositoryEvolution/store.js";
import {
  REPOSITORY_EVOLUTION_ANALYSIS_VERSION,
  REPOSITORY_EVOLUTION_SCHEMA_VERSION,
  RepositoryEvolutionError,
  type RepositoryEvolutionRecord, type RepositoryEvolutionSources,
} from "../services/repositoryEvolution/types.js";
import {
  validateEvolutionRecord, validateEvolutionSources,
} from "../services/repositoryEvolution/validation.js";
import type { RepositoryIntelligenceRecord } from "../services/repositoryIntelligence/types.js";
import type {
  RepositoryGraphNode, RepositorySymbolGraph,
} from "../services/repositoryGraph/graphTypes.js";
import type {
  SemanticGraph, SemanticSymbol,
} from "../services/semanticCodeIntelligence/types.js";

const baseRevision = "a".repeat(40);
const targetRevision = "b".repeat(40);
const timestamp = "2026-08-26T00:00:00.000Z";

function symbol(
  revision: string, version: string, name: string,
  kind: SemanticSymbol["kind"], signature: string, file: string,
): SemanticSymbol {
  return {
    symbolId: `${version}-${name}`, graphVersion: version,
    tenantId: "tenant-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, file, language: "typescript", kind,
    name, qualifiedName: name, visibility: "public", signature,
    documentationHash: "d".repeat(64), line: 1, column: 1,
    endLine: 2, endColumn: 1, createdAt: timestamp, updatedAt: timestamp,
  };
}

function semantic(target: boolean): SemanticGraph {
  const revision = target ? targetRevision : baseRevision;
  const version = target ? "semantic-target" : "semantic-base";
  const symbols = target ? [
    symbol(revision, version, "PaymentPort", "interface",
      "interface PaymentPort { charge(amount: number): Promise<void> }",
      "src/payments/port.ts"),
    symbol(revision, version, "ChargeService", "class",
      "class ChargeService", "src/payments/charge.ts"),
  ] : [
    symbol(revision, version, "PaymentPort", "interface",
      "interface PaymentPort { charge(): void }", "src/payments/port.ts"),
    symbol(revision, version, "legacyCharge", "function",
      "function legacyCharge()", "src/payments/legacy.ts"),
  ];
  const relationships = target ? [{
    relationshipId: "semantic-edge-target", graphVersion: version,
    tenantId: "tenant-1", repositoryId: "acme/widgets",
    repositoryRevision: revision,
    fromSymbolId: symbols[1]!.symbolId, toSymbolId: symbols[0]!.symbolId,
    kind: "implements" as const, createdAt: timestamp,
  }] : [];
  return {
    graphVersion: version, schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: (target ? "2" : "1").repeat(64),
    adapterVersions: ["typescript:typescript-semantic-adapter-v1"],
    lifecycle: target ? "published" : "superseded",
    symbols, relationships,
    fileAnalyses: symbols.map((item) => ({
      file: item.file, language: "typescript",
      adapterVersion: "typescript-semantic-adapter-v1",
      contentHash: `${target ? "2" : "1"}${item.name}`.padEnd(64, "0"),
      symbols: [], imports: [], diagnostics: [],
    })),
    diagnostics: [], metrics: {
      indexedSymbols: symbols.length,
      indexedRelationships: relationships.length, indexingDurationMs: 1,
      graphRebuilds: 1, incrementalUpdates: 0, recoveryOperations: 0,
    }, createdAt: timestamp, updatedAt: timestamp,
    publishedAt: target ? timestamp : null,
  };
}

function repositoryGraph(target: boolean): RepositorySymbolGraph {
  const semanticGraph = semantic(target);
  const version = target ? "graph-target" : "graph-base";
  const nodes: RepositoryGraphNode[] = semanticGraph.symbols.map((item) => ({
    nodeId: item.symbolId, symbolId: item.symbolId, graphVersion: version,
    repositoryId: "acme/widgets",
    repositoryRevision: semanticGraph.repositoryRevision,
    repositoryVersion: semanticGraph.repositoryRevision,
    parserVersion: "typescript-compiler-v1", name: item.name,
    qualifiedName: item.qualifiedName,
    kind: item.kind as RepositoryGraphNode["kind"],
    language: item.language, file: item.file, line: item.line,
    endLine: item.endLine, column: item.column, endColumn: item.endColumn,
    exported: true, defaultExport: false, metadata: {},
  }));
  return {
    graphVersion: version, repositoryId: "acme/widgets",
    repositoryRevision: semanticGraph.repositoryRevision,
    repositoryVersion: semanticGraph.repositoryRevision,
    parserVersion: "typescript-compiler-v1",
    status: target ? "published" : "superseded",
    createdAt: timestamp, publishedAt: target ? timestamp : null, nodes,
    edges: target ? [{
      edgeId: "graph-edge-target", graphVersion: version,
      repositoryId: "acme/widgets",
      repositoryRevision: semanticGraph.repositoryRevision,
      parserVersion: "typescript-compiler-v1",
      fromNodeId: nodes[1]!.nodeId, toNodeId: nodes[0]!.nodeId,
      fromSymbolId: nodes[1]!.nodeId, toSymbolId: nodes[0]!.nodeId,
      kind: "implements", distance: 1, metadata: {},
    }] : [],
    diagnostics: {
      parsedFileCount: nodes.length, parserFailureCount: 0,
      unresolvedImportCount: 0, importCount: target ? 1 : 0,
      unresolvedFileRatio: 0, parserFailureRatio: 0,
      orphanSymbolCount: 0, duplicateNodeIdCount: 0,
      duplicateEdgeIdCount: 0, missingEndpointCount: 0,
      impossibleSelfEdgeCount: 0, graphBytes: 100,
      durationMs: 1, failures: [],
    },
  };
}

function intelligence(target: boolean): RepositoryIntelligenceRecord {
  const revision = target ? targetRevision : baseRevision;
  const graphVersion = target ? "graph-target" : "graph-base";
  const intelligenceVersion = target
    ? "intelligence-target" : "intelligence-base";
  return {
    intelligenceVersion, repositoryId: "acme/widgets",
    repositoryRevision: revision, graphVersion,
    embeddingVersion: target ? "embedding-target" : "embedding-base",
    parserVersion: "typescript-compiler-v1",
    analysisVersion: "repository-intelligence-v1",
    schemaVersion: "repository-intelligence-schema-v1",
    status: target ? "published" : "superseded",
    createdAt: timestamp, validatedAt: timestamp,
    publishedAt: target ? timestamp : null,
    publicationMetadata: {
      repositoryRevision: revision, graphVersion,
      embeddingVersion: target ? "embedding-target" : "embedding-base",
      previousIntelligenceVersion: target ? "intelligence-base" : null,
    },
    architecture: {
      subsystemIds: target ? ["payments", "fraud"] : ["payments", "legacy"],
      packageHierarchy: ["src"], layers: [],
      dependencyGraph: target
        ? [{ from: "payments", to: "fraud", count: 4 }] : [],
      hotspots: [{ path: "src/payments/charge.ts",
        value: target ? 12 : 2 }],
    },
    codeOrganization: {
      largestModules: [], mostImportedFiles: [], highestFanIn: [],
      highestFanOut: [], utilityClusters: [],
      cyclicDependencies: target
        ? [["payments", "fraud", "payments"]] : [],
    },
    symbols: {
      publicApis: [], internalApis: [], orphanSymbols: [],
      deadExports: [], entrypoints: [], sharedAbstractions: [],
    },
    quality: {
      duplicateImplementations: [], oversizedFiles: [],
      oversizedFunctions: [], todoFixmeDensity: 0,
      generatedCodeRatio: 0, documentationCoverage: 1,
    },
    evolution: {
      changedHotspots: [], stableAreas: [], architecturalDrift: [],
      growth: {
        files: target ? 3 : 2, symbols: 2,
        dependencyEdges: target ? 4 : 0,
        fileDelta: target ? 1 : 0, symbolDelta: 0,
        dependencyEdgeDelta: target ? 4 : 0,
      },
    },
    subsystems: [
      {
        subsystemId: "payments", name: "Payments",
        rootPath: "src/payments", layer: "application",
        files: target
          ? ["src/payments/port.ts", "src/payments/charge.ts"]
          : ["src/payments/port.ts", "src/payments/legacy.ts"],
        dependencies: target ? ["fraud"] : [], publicApis: [],
        entrypoints: [], summary: "Payments.",
        metrics: {
          files: 2, symbols: 2,
          incomingDependencies: target ? 3 : 0,
          outgoingDependencies: target ? 2 : 1,
        },
      },
      ...(target ? [{
        subsystemId: "fraud", name: "Fraud", rootPath: "src/fraud",
        layer: "application", files: ["src/fraud/index.ts"],
        dependencies: ["payments"], publicApis: [], entrypoints: [],
        summary: "Fraud checks.", metrics: {
          files: 1, symbols: 0, incomingDependencies: 1,
          outgoingDependencies: 1,
        },
      }] : [{
        subsystemId: "legacy", name: "Legacy", rootPath: "src/legacy",
        layer: "application", files: ["src/legacy/index.ts"],
        dependencies: [], publicApis: [], entrypoints: [],
        summary: "Legacy payments.", metrics: {
          files: 1, symbols: 0, incomingDependencies: 0,
          outgoingDependencies: 0,
        },
      }]),
    ],
    metrics: {
      filesAnalyzed: target ? 3 : 2, symbolsAnalyzed: 2,
      dependencyEdgesAnalyzed: target ? 4 : 0,
      generatedSubsystems: target ? 2 : 1,
      qualityFindings: 0, hotspots: 1,
    },
  };
}

function featureGraph(target: boolean): FeatureGraph {
  const semanticGraph = semantic(target);
  const revision = semanticGraph.repositoryRevision;
  const version = target ? "feature-target" : "feature-base";
  const payments = {
    featureId: target ? "feature-payments-target" : "feature-payments-base",
    graphVersion: version, tenantId: "tenant-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    name: "Payments", description: "Payments.",
    confidence: 0.95, primaryEntryPoint: semanticGraph.symbols[0]!.symbolId,
    primaryExitPoint: semanticGraph.symbols[0]!.symbolId,
    entryPoints: [semanticGraph.symbols[0]!.symbolId],
    exitPoints: [semanticGraph.symbols[0]!.symbolId],
    owningModules: target ? ["src/payments", "src/fraud"] : ["src/payments"],
    files: semanticGraph.symbols.map((item) => item.file),
    symbolIds: semanticGraph.symbols.map((item) => item.symbolId),
    lifecycle: "active" as const, createdAt: timestamp, updatedAt: timestamp,
  };
  const features = target ? [payments, {
    ...payments, featureId: "feature-fraud", name: "Fraud",
    description: "Fraud checks.", owningModules: ["src/fraud"],
    files: ["src/fraud/index.ts"], symbolIds: [],
  }] : [payments, {
    ...payments, featureId: "feature-legacy", name: "Legacy",
    description: "Legacy payments.", owningModules: ["src/legacy"],
    files: ["src/legacy/index.ts"], symbolIds: [],
  }];
  return {
    graphVersion: version, schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligenceVersion: target
      ? "intelligence-target" : "intelligence-base",
    semanticGraphVersion: semanticGraph.graphVersion,
    lifecycle: target ? "published" : "superseded",
    features, relationships: target ? [{
      relationshipId: "feature-relation-target", graphVersion: version,
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision,
      fromFeatureId: payments.featureId, toFeatureId: "feature-fraud",
      kind: "depends_on_feature", target: "Fraud", createdAt: timestamp,
    }] : [], flows: [], diagnostics: [],
    metrics: {
      featuresDiscovered: features.length, averageFeatureSize: 2,
      dependencyDensity: target ? 0.5 : 0, rebuildDurationMs: 1,
      incrementalRebuildCount: 0, recoveryCount: 0,
    }, createdAt: timestamp, updatedAt: timestamp,
    publishedAt: target ? timestamp : null,
  };
}

function workflow(target: boolean): AutonomousWorkflow {
  const revision = target ? targetRevision : baseRevision;
  return {
    workflowId: "workflow-payments",
    schemaVersion: "autonomous-workflow-schema-v1",
    persistenceVersion: 1, tenantId: "tenant-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    executionId: "execution-payments", ownerId: "user-1",
    workflowVersion: target ? 2 : 1,
    lifecycle: target ? "completed" : "analysing",
    currentStage: target ? null : "intelligence",
    checkpoints: [], approvals: [], diagnostics: [],
    lifecycleHistory: [], attemptHistory: [], recoveryHistory: [],
    versions: [], retryCounts: {
      intelligence: 0, planning: 0, execution: 0, agent_runtime: 0,
      tool_invocation: 0, collaboration: 0, workspace: 0, patch: 0,
      artifact: 0, review: 0, proposal: 0, apply: 0, knowledge: 0,
    },
    failureCount: 0, recoveryCount: 0, resumeCount: target ? 1 : 0,
    inFlight: null, archiveMetadata: null, createdAt: timestamp,
    updatedAt: timestamp, completedAt: target ? timestamp : null,
  };
}

function knowledge(target: boolean): KnowledgeRetrievalResult {
  return {
    knowledgeId: target ? "knowledge-target" : "knowledge-base",
    namespace: "architecture", subject: "Payment architecture",
    repositoryRevision: target ? targetRevision : baseRevision,
    version: target ? 2 : 1, confidence: 0.9, score: 0.9, rank: 1,
    contentHash: (target ? "9" : "8").repeat(64),
    content: {
      schemaVersion: "repository-knowledge-schema-v1",
      summary: target ? "Current payments." : "Original payments.",
      facts: [], tags: ["payments"],
    }, executionId: null,
  };
}

function sources(): RepositoryEvolutionSources {
  return {
    base: {
      repositoryIntelligence: intelligence(false),
      repositoryGraph: repositoryGraph(false),
      semanticGraph: semantic(false), featureGraph: featureGraph(false),
      workflows: [workflow(false)], knowledge: [knowledge(false)],
    },
    target: {
      repositoryIntelligence: intelligence(true),
      repositoryGraph: repositoryGraph(true),
      semanticGraph: semantic(true), featureGraph: featureGraph(true),
      workflows: [workflow(true)], knowledge: [knowledge(true)],
    },
  };
}

function dependencies() {
  const data = sources();
  return {
    repositories: { getRepository: async () => ({
      repositoryId: "acme/widgets", ownerUserId: "user-1",
      deletionState: "active", currentRevision: targetRevision,
      indexedRevision: targetRevision,
    }) },
    repositoryGraph: {
      loadPublished: async (_repositoryId: string, revision: string) =>
        revision === baseRevision ? data.base.repositoryGraph :
          data.target.repositoryGraph,
      verify: async () => {},
    },
    repositoryIntelligence: {
      getPublishedSnapshot: async (_repositoryId: string, revision: string) =>
        revision === baseRevision ? data.base.repositoryIntelligence :
          data.target.repositoryIntelligence,
      verify: async () => {},
    },
    semantic: {
      get: async (_tenant: string, _owner: string, _repository: string,
        revision: string) => revision === baseRevision
        ? data.base.semanticGraph : data.target.semanticGraph,
      verify: async () => {},
    },
    features: {
      get: async (_tenant: string, _owner: string, _repository: string,
        revision: string) => revision === baseRevision
        ? data.base.featureGraph : data.target.featureGraph,
      verify: async () => {},
    },
    auxiliary: new MemoryRepositoryEvolutionSourceReader({
      baseWorkflows: data.base.workflows,
      targetWorkflows: data.target.workflows,
      baseKnowledge: data.base.knowledge,
      targetKnowledge: data.target.knowledge,
    }),
    verifyAuxiliaryEngines: async () => {},
  };
}

function input(ownerId = "user-1") {
  return {
    tenantId: "tenant-1", ownerId, repositoryOwnerId: ownerId,
    repositoryId: "acme/widgets", baseRevision, targetRevision,
    comparisonTimestamp: timestamp,
  };
}

test("revision comparison and deterministic IDs cover every evolution domain", () => {
  const first = compareRepositoryEvolution(sources());
  const second = compareRepositoryEvolution(sources());
  assert.deepEqual(first, second);
  assert.equal(first.features.added[0]?.name, "Fraud");
  assert.equal(first.features.removed[0]?.name, "Legacy");
  assert.equal(first.features.modified[0]?.name, "Payments");
  assert.equal(first.architecture.newModules[0]?.name, "src/fraud");
  assert.equal(first.architecture.removedModules[0]?.name, "src/legacy");
  assert.equal(first.architecture.introducedCycles.length, 1);
  assert.equal(first.dependencies.added.length, 1);
  assert.equal(first.semantic.symbolAdditions[0]?.name,
    "class:ChargeService");
  assert.equal(first.semantic.symbolRemovals[0]?.name,
    "function:legacyCharge");
  assert.equal(first.semantic.interfaceChanges.length, 1);
  assert.equal(first.semantic.inheritanceChanges.length, 1);
  assert.equal(first.semantic.apiEvolution.length, 3);
  assert.equal(first.workflows.modified.length, 1);
  assert.equal(first.knowledge.modified.length, 1);
  validateEvolutionSources(sources());
});

test("timelines, trends, and history navigation are deterministic", () => {
  const comparison = compareRepositoryEvolution(sources());
  const evolutionId = "evolution-deterministic";
  const timelines = buildEvolutionTimelines(
    evolutionId, baseRevision, targetRevision, timestamp, comparison);
  const trends = generateEvolutionTrends(
    evolutionId, comparison, sources());
  assert.ok(timelines.some((item) => item.kind === "file"));
  assert.ok(timelines.some((item) => item.kind === "module"));
  assert.ok(timelines.some((item) => item.kind === "feature"));
  assert.ok(timelines.some((item) => item.kind === "api"));
  assert.deepEqual(new Set(trends.map((item) => item.type)), new Set([
    "increasing coupling", "expanding features", "unstable APIs",
    "growing dependency chains",
  ]));
  const record = {
    ...recordFixture(), evolutionId, comparison, timelines, trends,
  };
  const featureHistory = navigateEvolutionHistory([record], {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", kind: "feature",
  });
  assert.ok(featureHistory.length >= 2);
  assert.ok(featureHistory.every((item) => item.kind === "feature"));
});

function recordFixture(): RepositoryEvolutionRecord {
  const comparison = compareRepositoryEvolution(sources());
  const evolutionId = "evolution-deterministic";
  return {
    evolutionId, schemaVersion: REPOSITORY_EVOLUTION_SCHEMA_VERSION,
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", baseRevision, targetRevision,
    comparisonTimestamp: timestamp,
    analysisVersion: REPOSITORY_EVOLUTION_ANALYSIS_VERSION,
    sourceFingerprint: "f".repeat(64),
    sourceVersions: {
      baseRepositoryIntelligence: "intelligence-base",
      targetRepositoryIntelligence: "intelligence-target",
      baseRepositoryGraph: "graph-base", targetRepositoryGraph: "graph-target",
      baseSemanticGraph: "semantic-base", targetSemanticGraph: "semantic-target",
      baseFeatureGraph: "feature-base", targetFeatureGraph: "feature-target",
      workflows: "workflow-sources", knowledge: "knowledge-sources",
    },
    lifecycle: "published", comparison,
    timelines: buildEvolutionTimelines(
      evolutionId, baseRevision, targetRevision, timestamp, comparison),
    trends: generateEvolutionTrends(evolutionId, comparison, sources()),
    diagnostics: [], reusedCount: 0, comparisonLatencyMs: 12,
    recoveryCount: 0, createdAt: timestamp, updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

test("engine fences ownership and incrementally reuses exact comparisons", async () => {
  const store = new MemoryRepositoryEvolutionStore();
  const engine = new RepositoryEvolutionIntelligenceEngine(
    store, dependencies() as never, () => new Date(timestamp));
  const first = await engine.compare(input());
  const second = await engine.compare(input());
  assert.equal(first.evolutionId, second.evolutionId);
  assert.deepEqual(first, second);
  assert.equal((await engine.metrics("tenant-1")).reuseRate, 0.5);
  await assert.rejects(() => engine.compare(input("other-user")),
    (error: unknown) => error instanceof RepositoryEvolutionError &&
      error.code === "repository_evolution_access_denied");
  await assert.rejects(() => engine.compare({
    ...input(), baseRevision: targetRevision,
  }), (error: unknown) => error instanceof RepositoryEvolutionError &&
      error.code === "repository_evolution_revision_lineage_invalid");
});

test("validation catches graph, feature, semantic, and history corruption", () => {
  const invalidGraph = structuredClone(sources());
  invalidGraph.target.repositoryGraph.edges[0]!.toNodeId = "missing";
  assert.throws(() => validateEvolutionSources(invalidGraph),
    /orphan dependency endpoint/);
  const invalidFeature = structuredClone(sources());
  const invalidFeatureSources = {
    ...invalidFeature,
    target: {
      ...invalidFeature.target,
      featureGraph: {
        ...invalidFeature.target.featureGraph,
        features: invalidFeature.target.featureGraph.features.map(
          (item, index) => index === 0
            ? { ...item, symbolIds: ["missing-symbol"] } : item),
      },
    },
  };
  assert.throws(() => validateEvolutionSources(invalidFeatureSources),
    /orphan semantic/);
  const invalidRecord = {
    ...recordFixture(),
    timelines: recordFixture().timelines.map((item, index) =>
      index === 0 ? { ...item, evidence: [] } : item),
  };
  assert.throws(() => validateEvolutionRecord(invalidRecord),
    /integrity is invalid/);
});

test("recovery, metrics, retention, and startup validation are complete", async () => {
  const store = new MemoryRepositoryEvolutionStore();
  store.hydrate({ ...recordFixture(), lifecycle: "comparing",
    publishedAt: null });
  assert.equal(await store.recover(), 1);
  assert.equal((await store.metrics()).recoveryCount, 1);
  const verified: string[] = [];
  const deps = dependencies();
  const engine = new RepositoryEvolutionIntelligenceEngine(store, {
    ...deps,
    repositoryGraph: { ...deps.repositoryGraph,
      verify: async () => { verified.push("graph"); } },
    repositoryIntelligence: { ...deps.repositoryIntelligence,
      verify: async () => { verified.push("intelligence"); } },
    semantic: { ...deps.semantic,
      verify: async () => { verified.push("semantic"); } },
    features: { ...deps.features,
      verify: async () => { verified.push("feature"); } },
    auxiliary: { ...deps.auxiliary,
      load: deps.auxiliary.load.bind(deps.auxiliary),
      verify: async () => { verified.push("source"); } },
    verifyAuxiliaryEngines: async () => { verified.push("auxiliary"); },
  } as never);
  await engine.verify();
  assert.deepEqual(new Set(verified), new Set([
    "graph", "intelligence", "semantic", "feature", "source", "auxiliary",
  ]));
  assert.equal(await store.collect("tenant-1", 1), 0);
});

test("PostgreSQL adapters preserve memory shapes and reject invalid startup", async () => {
  const expected = recordFixture();
  const calls: string[] = [];
  const database = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "save_repository_evolution_record" ||
          name === "get_repository_evolution_record") {
        return { data: [{ record: expected }], error: null };
      }
      if (name === "list_repository_evolution_records") {
        return { data: [{ record: expected }], error: null };
      }
      if (name === "repository_evolution_metrics") return {
        data: [{ metrics: {
          comparisons: 1, timelines: expected.timelines.length,
          trends: expected.trends.length, reuseRate: 0,
          recoveryCount: 0, averageComparisonLatencyMs: 12,
        } }], error: null,
      };
      if (name === "recover_repository_evolution_records" ||
          name === "collect_repository_evolution_records") {
        return { data: [{ recovered_count: 0, deleted_count: 0 }], error: null };
      }
      return { data: [{ valid: true, problems: [] }], error: null };
    },
  };
  const postgres = new PostgresRepositoryEvolutionStore(database as never);
  assert.deepEqual(await postgres.save(expected), expected);
  assert.deepEqual(await postgres.get(
    "tenant-1", "user-1", "acme/widgets",
    baseRevision, targetRevision), expected);
  assert.deepEqual(await postgres.list(
    "tenant-1", "user-1", "acme/widgets"), [expected]);
  await postgres.verify();
  assert.ok(calls.includes("verify_repository_evolution_contract"));

  const reader = new PostgresRepositoryEvolutionSourceReader({
    rpc: async (name: string) => name ===
      "get_repository_evolution_revision_source"
      ? { data: [{ revision_source: sources().base }], error: null }
      : name === "get_repository_evolution_auxiliary_sources"
        ? { data: [{ sources: {
          baseWorkflows: [], targetWorkflows: [],
          baseKnowledge: [], targetKnowledge: [],
        } }], error: null }
        : { data: [{ valid: true, problems: [] }], error: null },
  } as never);
  assert.deepEqual(await reader.loadRevision!(
    "tenant-1", "user-1", "acme/widgets", baseRevision), sources().base);
  await reader.verify();
});

test("migration defines durable lineage, RLS, grants, recovery, and retention", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260826000000_add_repository_evolution_intelligence.sql",
    import.meta.url), "utf8");
  for (const token of [
    "repository_evolution_records", "repository_revision_comparisons",
    "repository_evolution_timelines", "repository_evolution_trend_summaries",
    "repository_evolution_diagnostics", "repository_evolution_retention",
    "repository_evolution_base_snapshot_fk",
    "repository_evolution_timeline_record_fk",
    "repository_evolution_history_navigation_idx",
    "get_repository_evolution_revision_source",
    "recover_repository_evolution_records",
    "collect_repository_evolution_records",
    "enable row level security", "grant execute", "service_role",
  ]) assert.match(migration, new RegExp(token));
});
