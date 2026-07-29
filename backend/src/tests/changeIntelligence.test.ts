import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MetricsRegistry } from "../observability/metrics.js";
import {
  analyzeChange,
  deterministicChangeId,
} from "../services/changeIntelligence/engine.js";
import { ChangeIntelligenceService } from "../services/changeIntelligence/service.js";
import {
  MemoryChangeIntelligenceStore,
  PostgresChangeIntelligenceStore,
} from "../services/changeIntelligence/store.js";
import {
  ChangeIntelligenceError,
  type AnalyzeChangeInput,
  type ChangeAnalysis,
} from "../services/changeIntelligence/types.js";
import { validateChangeAnalysis } from "../services/changeIntelligence/validation.js";
import { buildFeatureGraph } from "../services/featureIntelligence/engine.js";
import type { RepositoryIntelligenceRecord } from "../services/repositoryIntelligence/types.js";
import { buildSemanticGraph } from "../services/semanticCodeIntelligence/engine.js";

const revision = "a".repeat(40);
const timestamp = "2026-08-23T00:00:00.000Z";

function repository(): RepositoryIntelligenceRecord {
  const subsystem = (subsystemId: string, rootPath: string, files: string[],
    dependencies: string[] = []) => ({
    subsystemId, name: subsystemId, rootPath, layer: "application", files,
    dependencies, publicApis: [], entrypoints: [], summary: subsystemId,
    metrics: { files: files.length, symbols: files.length,
      incomingDependencies: 0, outgoingDependencies: dependencies.length },
  });
  return {
    intelligenceVersion: "intelligence-v1", repositoryId: "acme/widgets",
    repositoryRevision: revision, graphVersion: "repository-graph-v1",
    embeddingVersion: "embedding-v1", parserVersion: "parser-v1",
    analysisVersion: "repository-intelligence-v1",
    schemaVersion: "repository-intelligence-schema-v1", status: "published",
    createdAt: timestamp, validatedAt: timestamp, publishedAt: timestamp,
    publicationMetadata: { repositoryRevision: revision,
      graphVersion: "repository-graph-v1", embeddingVersion: "embedding-v1",
      previousIntelligenceVersion: null },
    architecture: {
      subsystemIds: ["routes", "services", "repositories"],
      packageHierarchy: ["src"], dependencyGraph: [
        { from: "routes", to: "services", count: 1 },
        { from: "services", to: "repositories", count: 1 },
      ], layers: [], hotspots: [],
    },
    codeOrganization: { largestModules: [], mostImportedFiles: [],
      highestFanIn: [], highestFanOut: [], cyclicDependencies: [],
      utilityClusters: [] },
    symbols: { publicApis: [], internalApis: [], orphanSymbols: [],
      deadExports: [], entrypoints: ["src/routes/auth/login.ts"],
      sharedAbstractions: [] },
    quality: { duplicateImplementations: [], oversizedFiles: [],
      oversizedFunctions: [], todoFixmeDensity: 0, generatedCodeRatio: 0,
      documentationCoverage: 0 },
    evolution: { changedHotspots: [], stableAreas: [],
      architecturalDrift: [], growth: { files: 4, symbols: 5,
        dependencyEdges: 4, fileDelta: 0, symbolDelta: 0,
        dependencyEdgeDelta: 0 } },
    subsystems: [
      subsystem("routes", "src/routes/auth", ["src/routes/auth/login.ts"],
        ["services"]),
      subsystem("services", "src/services", [
        "src/services/auth/service.ts",
        "src/services/notifications/service.ts",
      ], ["repositories"]),
      subsystem("repositories", "src/repositories/auth",
        ["src/repositories/auth/session.ts"]),
    ],
    metrics: { filesAnalyzed: 4, symbolsAnalyzed: 5,
      dependencyEdgesAnalyzed: 4, generatedSubsystems: 3,
      qualityFindings: 0, hotspots: 0 },
  };
}

function dependencies() {
  const semanticGraph = buildSemanticGraph({
    tenantId: "tenant-1", ownerId: "user-1", repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotRevision: revision, indexedAt: timestamp,
    files: [
      { file: "src/routes/auth/login.ts", content: `
        import { authenticate } from "../../services/auth/service.js";
        export function loginRoute(): void { authenticate(); }` },
      { file: "src/services/auth/service.ts", content: `
        import { saveSession } from "../../repositories/auth/session.js";
        import { notify } from "../notifications/service.js";
        export function authenticate(): void { saveSession(); notify(); }` },
      { file: "src/repositories/auth/session.ts",
        content: "export function saveSession(): void {}" },
      { file: "src/services/notifications/service.ts",
        content: "export function notify(): void {}" },
    ],
  });
  const repositoryIntelligence = repository();
  const featureGraph = buildFeatureGraph({
    tenantId: "tenant-1", ownerId: "user-1", repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligence, semanticGraph, indexedAt: timestamp,
  });
  return { repositoryIntelligence, semanticGraph, featureGraph };
}

function input(overrides: Partial<AnalyzeChangeInput> = {}): AnalyzeChangeInput {
  return {
    tenantId: "tenant-1", ownerId: "user-1",
    repositoryOwnerId: "user-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, workflowId: "workflow-1",
    requestedTarget: { kind: "file", value: "src/routes/auth/login.ts" },
    changeType: "modify", rationale: "Harden login validation.",
    requestedAt: timestamp, ...dependencies(), ...overrides,
  };
}

test("change IDs and complete analyses are deterministic", () => {
  const first = analyzeChange(input());
  const second = analyzeChange(input());
  assert.deepEqual(second, first);
  assert.equal(first.request.changeId, deterministicChangeId(input()));
  assert.ok(first.impact.directlyAffectedFiles.includes(
    "src/routes/auth/login.ts"));
  assert.ok(first.impact.indirectlyAffectedFiles.length > 0);
  assert.ok(first.impact.affectedSymbolIds.length > 0);
  assert.ok(first.impact.affectedFeatureIds.length > 0);
  assert.ok(first.impact.affectedApis.includes("/auth/login"));
  assert.ok(first.impact.affectedWorkflowIds.includes("workflow-1"));
  validateChangeAnalysis(first);
});

test("all supported targets resolve through deterministic graph metadata", () => {
  const targets: AnalyzeChangeInput["requestedTarget"][] = [
    { kind: "feature", value: "Authentication" },
    { kind: "module", value: "routes" },
    { kind: "file", value: "src/routes/auth/login.ts" },
    { kind: "symbol", value: "loginRoute" },
    { kind: "api_endpoint", value: "/auth/login" },
    { kind: "route", value: "/auth/login" },
    { kind: "service", value: "authenticate" },
    { kind: "repository_component", value: "saveSession" },
  ];
  for (const requestedTarget of targets) {
    const analysis = analyzeChange(input({ requestedTarget }));
    assert.ok(analysis.impact.affectedSymbolIds.length > 0,
      requestedTarget.kind);
  }
});

test("dependency tracing, risk classification, and explanations are metadata-only", () => {
  const analysis = analyzeChange(input({
    requestedTarget: { kind: "route", value: "/auth/login" },
    changeType: "remove",
  }));
  assert.ok(analysis.impact.dependencyChains.length > 0);
  assert.ok(analysis.impact.maximumDependencyDepth > 0);
  assert.ok(["high", "critical"].includes(analysis.risk.level));
  assert.ok(analysis.risk.score >= 50);
  assert.ok(analysis.risk.reasons.includes("destructiveChange:15"));
  assert.ok(analysis.risk.reasons.includes("publicTarget:10"));

  const isolated = dependencies();
  const semanticGraph = {
    ...isolated.semanticGraph,
    relationships: [],
  };
  const featureGraph = buildFeatureGraph({
    tenantId: "tenant-1", ownerId: "user-1", repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligence: isolated.repositoryIntelligence,
    semanticGraph, indexedAt: timestamp,
  });
  const low = analyzeChange(input({
    semanticGraph, featureGraph,
    requestedTarget: {
      kind: "file", value: "src/services/notifications/service.ts",
    },
    changeType: "fix",
  }));
  assert.equal(low.risk.level, "low");
  assert.ok(low.risk.score < 25);
});

test("roadmaps preserve ordered preparation, dependency, implementation, validation, and review phases", () => {
  const steps = analyzeChange(input()).implementationPlan.steps;
  assert.deepEqual([...new Set(steps.map((item) => item.phase))], [
    "preparation", "dependencies", "implementation", "validation", "review",
  ]);
  assert.ok(steps.every((item, position) => item.position === position));
  assert.ok(steps.every((item) => !/```|function\s|class\s/iu.test(item.action)));
});

test("ownership, revision, feature lineage, and graph integrity fail closed", () => {
  assert.throws(() => analyzeChange(input({ repositoryOwnerId: "user-2" })),
    (error: unknown) => error instanceof ChangeIntelligenceError &&
      error.code === "change_intelligence_lineage_invalid");
  const graph = dependencies().semanticGraph;
  assert.throws(() => analyzeChange(input({
    semanticGraph: { ...graph, relationships: [{
      ...graph.relationships[0]!, toSymbolId: "orphan",
    }] },
  })), (error: unknown) => error instanceof ChangeIntelligenceError &&
    error.code === "change_intelligence_graph_integrity_invalid");
  assert.throws(() => analyzeChange(input({
    requestedTarget: { kind: "file", value: "missing.ts" },
  })), (error: unknown) => error instanceof ChangeIntelligenceError &&
    error.code === "change_target_not_found");
});

test("unchanged repository and graph lineage reuses the previous analysis", async () => {
  const store = new MemoryChangeIntelligenceStore();
  const service = new ChangeIntelligenceService(store);
  const first = await service.analyze(input());
  const second = await service.analyze(input());
  assert.deepEqual(second, first);
  assert.equal((await store.metrics()).reuseRate, 0.5);
});

test("recovery fences interrupted, orphan, and stale analyses", async () => {
  const valid = analyzeChange(input());
  for (const broken of [
    { ...valid, lifecycle: "building" as const, publishedAt: null },
    { ...valid, impact: { ...valid.impact, changeId: "orphan" } },
    { ...valid, impact: { ...valid.impact, dependencyChains: [{
      ...valid.impact.dependencyChains[0]!,
      steps: valid.impact.dependencyChains[0]!.steps.map((item) =>
        ({ ...item, position: item.position + 1 })),
    }] } },
  ]) {
    const store = new MemoryChangeIntelligenceStore();
    store.hydrate(broken);
    assert.equal(await store.recover(), 1);
    assert.equal(await store.get("tenant-1", "user-1",
      valid.request.changeId), null);
    assert.equal((await store.metrics()).recoveryCount, 1);
  }
});

class FakeDatabase {
  analysis: ChangeAnalysis | null = null;
  calls: string[] = [];
  async rpc(name: string, parameters: Record<string, unknown> = {}) {
    this.calls.push(name);
    let data: unknown = 0;
    if (name === "save_change_intelligence_analysis") {
      this.analysis = structuredClone(parameters.input_analysis as ChangeAnalysis);
      data = this.analysis;
    } else if (name === "get_change_intelligence_analysis") {
      data = this.analysis;
    } else if (name === "verify_change_intelligence_contract") {
      data = [{ valid: true, problems: [] }];
    }
    return { data, error: null };
  }
}

test("memory and PostgreSQL adapters preserve equivalent deterministic analysis state", async () => {
  const analysis = analyzeChange(input());
  const memory = new MemoryChangeIntelligenceStore();
  const database = new FakeDatabase();
  const postgres = new PostgresChangeIntelligenceStore(database as never);
  assert.deepEqual(await postgres.save(analysis), await memory.save(analysis));
  assert.deepEqual(await postgres.get("tenant-1", "user-1",
    analysis.request.changeId), await memory.get("tenant-1", "user-1",
    analysis.request.changeId));
  await assert.doesNotReject(() => postgres.verify());
});

test("metrics expose analyses, impact, depth, risk, reuse, and recovery", () => {
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0, uptimeSeconds: () => 1,
  });
  registry.recordChangeIntelligence({
    analyses: 2, averageImpactSize: 4, averageDependencyDepth: 3,
    riskDistribution: { low: 1, medium: 0, high: 1, critical: 0 },
    reuseRate: 0.5, recoveryCount: 1,
  });
  const rendered = registry.render();
  for (const name of [
    "giro_change_intelligence_analyses",
    "giro_change_intelligence_average_impact_size",
    "giro_change_intelligence_average_dependency_depth",
    "giro_change_intelligence_risk_distribution",
    "giro_change_intelligence_reuse_rate",
    "giro_change_intelligence_recoveries_total",
  ]) assert.match(rendered, new RegExp(name));
});

test("migration, startup, retention, grants, RLS, and safety contracts are complete", async () => {
  const [migration, startup, sources] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260823000000_add_change_intelligence.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    Promise.all(["engine.ts", "service.ts", "store.ts", "validation.ts"]
      .map((file) => readFile(new URL(
        `../services/changeIntelligence/${file}`, import.meta.url), "utf8"))),
  ]);
  for (const table of [
    "change_requests", "change_analyses", "change_impact_graphs",
    "change_risk_assessments", "change_implementation_plans",
    "change_diagnostics", "change_intelligence_retention",
  ]) assert.match(migration,
    new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "change_requests_target_idx", "change_analyses_lineage_idx",
    "change_analysis_request_fk", "change_impact_analysis_fk",
    "recover_change_intelligence_analyses",
    "collect_change_intelligence_analyses",
    "verify_change_intelligence_contract", "enable row level security",
    "grant execute on function public.save_change_intelligence_analysis",
    "on delete cascade",
  ]) assert.match(migration, new RegExp(contract));
  assert.ok(startup.indexOf("runtimeChangeIntelligenceService.verify") <
    startup.indexOf("server = serve"));
  assert.doesNotMatch(sources.join("\n"),
    /child_process|simple-git|spawn\(|execFile|fetch\(|writeFile|rm\(|generateCode/iu);
});
