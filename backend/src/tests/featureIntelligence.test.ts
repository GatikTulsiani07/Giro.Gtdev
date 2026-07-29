import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MetricsRegistry } from "../observability/metrics.js";
import type {
  RepositoryIntelligenceRecord,
} from "../services/repositoryIntelligence/types.js";
import {
  buildSemanticGraph,
} from "../services/semanticCodeIntelligence/engine.js";
import {
  buildFeatureGraph,
  deterministicFeatureId,
  FeatureNavigator,
} from "../services/featureIntelligence/engine.js";
import {
  MemoryFeatureIntelligenceStore,
  PostgresFeatureIntelligenceStore,
} from "../services/featureIntelligence/store.js";
import {
  FeatureIntelligenceError,
  type BuildFeatureGraphInput,
  type FeatureGraph,
} from "../services/featureIntelligence/types.js";
import { validateFeatureGraph } from "../services/featureIntelligence/validation.js";

const revision = "a".repeat(40);
const timestamp = "2026-08-22T00:00:00.000Z";

function semantic() {
  return buildSemanticGraph({
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    snapshotRevision: revision,
    indexedAt: timestamp,
    files: [
      {
        file: "src/routes/auth/login.ts",
        content: `
          import { saveSession } from "../../repositories/auth/session.js";
          import { sendNotification } from "../../services/notifications/service.js";
          export function loginRoute(): void {
            authenticate();
            saveSession();
            sendNotification();
          }
          function authenticate(): boolean { return true; }
        `,
      },
      {
        file: "src/repositories/auth/session.ts",
        content: "export function saveSession(): void {}",
      },
      {
        file: "src/services/notifications/service.ts",
        content: "export function sendNotification(): void {}",
      },
      {
        file: "src/services/payments/checkout.ts",
        content: `
          import { sendNotification } from "../notifications/service.js";
          export function checkoutPayment(): void { sendNotification(); }
        `,
      },
    ],
  });
}

function repositoryIntelligence(): RepositoryIntelligenceRecord {
  return {
    intelligenceVersion: "intelligence-v1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    graphVersion: "repository-graph-v1",
    embeddingVersion: "embedding-v1",
    parserVersion: "parser-v1",
    analysisVersion: "repository-intelligence-v1",
    schemaVersion: "repository-intelligence-schema-v1",
    status: "published",
    createdAt: timestamp,
    validatedAt: timestamp,
    publishedAt: timestamp,
    publicationMetadata: {
      repositoryRevision: revision,
      graphVersion: "repository-graph-v1",
      embeddingVersion: "embedding-v1",
      previousIntelligenceVersion: null,
    },
    architecture: {
      subsystemIds: ["subsystem:routes", "subsystem:services", "subsystem:repositories"],
      packageHierarchy: ["src"],
      dependencyGraph: [],
      layers: [],
      hotspots: [],
    },
    codeOrganization: {
      largestModules: [],
      mostImportedFiles: [],
      highestFanIn: [],
      highestFanOut: [],
      cyclicDependencies: [],
      utilityClusters: [],
    },
    symbols: {
      publicApis: [],
      internalApis: [],
      orphanSymbols: [],
      deadExports: [],
      entrypoints: ["src/routes/auth/login.ts"],
      sharedAbstractions: [],
    },
    quality: {
      duplicateImplementations: [],
      oversizedFiles: [],
      oversizedFunctions: [],
      todoFixmeDensity: 0,
      generatedCodeRatio: 0,
      documentationCoverage: 0,
    },
    evolution: {
      changedHotspots: [],
      stableAreas: [],
      architecturalDrift: [],
      growth: {
        files: 4,
        symbols: 5,
        dependencyEdges: 4,
        fileDelta: 0,
        symbolDelta: 0,
        dependencyEdgeDelta: 0,
      },
    },
    subsystems: [
      {
        subsystemId: "subsystem:routes",
        name: "routes",
        rootPath: "src/routes/auth",
        layer: "interface",
        files: ["src/routes/auth/login.ts"],
        dependencies: ["subsystem:services", "subsystem:repositories"],
        publicApis: [],
        entrypoints: ["src/routes/auth/login.ts"],
        summary: "authentication routes",
        metrics: {
          files: 1, symbols: 2, incomingDependencies: 0, outgoingDependencies: 2,
        },
      },
      {
        subsystemId: "subsystem:services",
        name: "services",
        rootPath: "src/services",
        layer: "application",
        files: [
          "src/services/notifications/service.ts",
          "src/services/payments/checkout.ts",
        ],
        dependencies: [],
        publicApis: [],
        entrypoints: [],
        summary: "application services",
        metrics: {
          files: 2, symbols: 2, incomingDependencies: 2, outgoingDependencies: 1,
        },
      },
      {
        subsystemId: "subsystem:repositories",
        name: "repositories",
        rootPath: "src/repositories/auth",
        layer: "infrastructure",
        files: ["src/repositories/auth/session.ts"],
        dependencies: [],
        publicApis: [],
        entrypoints: [],
        summary: "authentication persistence",
        metrics: {
          files: 1, symbols: 1, incomingDependencies: 1, outgoingDependencies: 0,
        },
      },
    ],
    metrics: {
      filesAnalyzed: 4,
      symbolsAnalyzed: 5,
      dependencyEdgesAnalyzed: 4,
      generatedSubsystems: 3,
      qualityFindings: 0,
      hotspots: 0,
    },
  };
}

function input(
  overrides: Partial<BuildFeatureGraphInput> = {},
): BuildFeatureGraphInput {
  return {
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    repositoryIntelligence: repositoryIntelligence(),
    semanticGraph: semantic(),
    indexedAt: timestamp,
    ...overrides,
  };
}

test("feature IDs, discovery, descriptions, ownership, and outputs are deterministic", () => {
  const first = buildFeatureGraph(input());
  const second = buildFeatureGraph(input());
  assert.deepEqual(second, first);
  assert.equal(deterministicFeatureId({
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    featureName: "Authentication",
  }), deterministicFeatureId({
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    featureName: "Authentication",
  }));
  assert.deepEqual(
    first.features.map((feature) => feature.name).sort(),
    ["Authentication", "Notifications", "Payments"],
  );
  assert.ok(first.features.every((feature) =>
    feature.description && feature.confidence >= 0 &&
    feature.confidence <= 1 && feature.owningModules.length > 0));
  validateFeatureGraph(first);
});

test("feature graph includes ownership, endpoints, calls, dependencies, and shared components", () => {
  const graph = buildFeatureGraph(input());
  const kinds = new Set(graph.relationships.map((item) => item.kind));
  for (const kind of [
    "owns_module", "exposes_endpoint", "calls_feature", "depends_on_feature",
    "shares_components",
  ]) assert.ok(kinds.has(kind as never), `missing ${kind}`);
  const auth = graph.features.find((item) => item.name === "Authentication")!;
  assert.ok(graph.relationships.some((item) =>
    item.fromFeatureId === auth.featureId &&
    item.kind === "exposes_endpoint" && item.target === "/auth/login"));
});

test("feature flows model route, controller/service/repository work and response", () => {
  const graph = buildFeatureGraph(input());
  const auth = graph.features.find((item) => item.name === "Authentication")!;
  const featureFlows = graph.flows.filter((flow) => flow.featureId === auth.featureId);
  assert.ok(featureFlows.length > 0);
  assert.ok(featureFlows.some((flow) =>
    flow.steps[0]?.kind === "http_route" &&
    flow.steps.some((step) => step.kind === "repository") &&
    flow.steps.at(-1)?.kind === "response"));
});

test("navigation resolves feature surfaces, dependencies, upstream, and downstream", () => {
  const graph = buildFeatureGraph(input());
  const navigation = new FeatureNavigator(graph);
  assert.equal(navigation.byName("authentication").feature?.name, "Authentication");
  assert.ok(navigation.entryPoints("Authentication").length > 0);
  assert.ok(navigation.exitPoints("Authentication").length > 0);
  assert.ok(navigation.files("Authentication").includes(
    "src/routes/auth/login.ts"));
  assert.ok(navigation.symbols("Authentication").length > 0);
  assert.ok(navigation.downstream("Authentication").some(
    (item) => item.name === "Notifications"));
  assert.ok(navigation.upstream("Notifications").some(
    (item) => item.name === "Authentication"));
  assert.ok(navigation.dependencies("Authentication").length > 0);
});

test("change impact returns affected features, lineage, entry points, and risk", () => {
  const graph = buildFeatureGraph(input());
  const impact = new FeatureNavigator(graph).changeImpact({
    file: "src/routes/auth/login.ts",
  });
  assert.deepEqual(impact.affectedFeatures.map((item) => item.name), [
    "Authentication",
  ]);
  assert.ok(impact.dependencyChain.length > 0);
  assert.ok(impact.impactedEntryPoints.length > 0);
  assert.ok(impact.downstreamRisk.downstreamFeatureCount >= 1);
  assert.match(impact.downstreamRisk.reason, /directly affected/u);
});

test("incremental indexing counts only features touched by changed files", () => {
  const previous = buildFeatureGraph(input());
  const next = buildFeatureGraph(input({
    previousGraph: previous,
    changedFiles: ["src/routes/auth/login.ts"],
  }));
  assert.equal(next.metrics.incrementalRebuildCount, 1);
  assert.strictEqual(
    next.features.find((item) => item.name === "Notifications"),
    previous.features.find((item) => item.name === "Notifications"),
  );
  assert.deepEqual(
    next.features.filter((item) => item.name !== "Authentication")
      .map((item) => [item.name, item.files, item.symbolIds]),
    previous.features.filter((item) => item.name !== "Authentication")
      .map((item) => [item.name, item.files, item.symbolIds]),
  );
});

test("ownership, revision, graph lifecycle, and feature lineage fail closed", () => {
  assert.throws(() => buildFeatureGraph(input({
    repositoryOwnerId: "user-2",
  })), (error: unknown) => error instanceof FeatureIntelligenceError &&
    error.code === "feature_repository_access_denied");
  assert.throws(() => buildFeatureGraph(input({
    semanticGraph: { ...semantic(), lifecycle: "failed" },
  })), (error: unknown) => error instanceof FeatureIntelligenceError &&
    error.code === "feature_repository_access_denied");
  const graph = buildFeatureGraph(input());
  assert.throws(() => validateFeatureGraph({
    ...graph,
    flows: [{ ...graph.flows[0]!, featureId: "orphan" }],
  }), (error: unknown) => error instanceof FeatureIntelligenceError &&
    error.code === "feature_graph_integrity_invalid");
});

test("recovery fences interrupted indexing and removes orphan partial state", async () => {
  const graph = buildFeatureGraph(input());
  const interrupted = new MemoryFeatureIntelligenceStore();
  interrupted.hydrate({ ...graph, lifecycle: "building", publishedAt: null });
  assert.equal(await interrupted.recover(), 1);
  assert.equal((await interrupted.metrics()).recoveryCount, 1);
  assert.equal(await interrupted.get(
    "tenant-1", "user-1", "acme/widgets", revision,
  ), null);

  const orphanStore = new MemoryFeatureIntelligenceStore();
  orphanStore.hydrate({
    ...graph,
    features: [...graph.features, {
      ...graph.features[0]!,
      featureId: "orphan",
      files: [],
      symbolIds: [],
      owningModules: [],
    }],
  });
  assert.equal(await orphanStore.recover(), 1);
  const recovered = await orphanStore.get(
    "tenant-1", "user-1", "acme/widgets", revision,
  );
  assert.ok(recovered);
  assert.equal(recovered.features.some((item) => item.featureId === "orphan"), false);
});

class FakeFeatureDatabase {
  graph: FeatureGraph | null = null;
  readonly calls: string[] = [];
  async rpc(name: string, parameters: Record<string, unknown> = {}) {
    this.calls.push(name);
    let data: unknown;
    if (name === "save_feature_intelligence_graph") {
      this.graph = structuredClone(parameters.input_graph as FeatureGraph);
      data = this.graph;
    } else if (name === "get_feature_intelligence_graph") {
      data = this.graph;
    } else if (name === "feature_intelligence_metrics") {
      data = this.graph?.metrics ?? {
        featuresDiscovered: 0, averageFeatureSize: 0, dependencyDensity: 0,
        rebuildDurationMs: 0, incrementalRebuildCount: 0, recoveryCount: 0,
      };
    } else if (name === "verify_feature_intelligence_contract") {
      data = [{ valid: true, problems: [] }];
    } else data = 0;
    return { data, error: null };
  }
}

test("memory and PostgreSQL stores preserve equivalent deterministic graph state", async () => {
  const graph = buildFeatureGraph(input());
  const memory = new MemoryFeatureIntelligenceStore();
  const database = new FakeFeatureDatabase();
  const postgres = new PostgresFeatureIntelligenceStore(database as never);
  assert.deepEqual(await postgres.save(graph), await memory.save(graph));
  assert.deepEqual(await postgres.get(
    "tenant-1", "user-1", "acme/widgets", revision,
  ), await memory.get("tenant-1", "user-1", "acme/widgets", revision));
  await assert.doesNotReject(() => postgres.verify());
  assert.ok(database.calls.includes("verify_feature_intelligence_contract"));
});

test("feature metrics expose all required bounded operational measurements", () => {
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0,
    uptimeSeconds: () => 1,
  });
  registry.recordFeatureIntelligence({
    featuresDiscovered: 3,
    averageFeatureSize: 4,
    dependencyDensity: 0.5,
    rebuildDurationMs: 6,
    incrementalRebuildCount: 1,
    recoveryCount: 2,
  });
  const rendered = registry.render();
  for (const metric of [
    "giro_feature_intelligence_discovered",
    "giro_feature_intelligence_average_size",
    "giro_feature_intelligence_dependency_density",
    "giro_feature_intelligence_rebuild_duration_ms_total",
    "giro_feature_intelligence_incremental_rebuilds_total",
    "giro_feature_intelligence_recoveries_total",
  ]) assert.match(rendered, new RegExp(metric));
});

test("migration defines feature schema, indexes, constraints, RLS, grants, and retention", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260822000000_add_feature_intelligence.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "features", "feature_relationships", "feature_flows",
    "feature_diagnostics", "feature_graph_versions", "feature_graph_retention",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "features_name_idx", "feature_relationships_from_kind_idx",
    "feature_relationship_from_fk", "feature_flow_feature_fk",
    "recover_feature_intelligence_graphs",
    "collect_feature_intelligence_graphs",
    "verify_feature_intelligence_contract",
    "enable row level security",
    "grant execute on function public.save_feature_intelligence_graph",
    "on delete cascade",
  ]) assert.match(migration, new RegExp(contract));
});

test("feature engine cannot execute code, Git, processes, mutations, or networking", async () => {
  const sources = await Promise.all([
    "engine.ts", "service.ts", "store.ts", "validation.ts",
  ].map((file) => readFile(new URL(
    `../services/featureIntelligence/${file}`, import.meta.url,
  ), "utf8")));
  assert.doesNotMatch(
    sources.join("\n"),
    /child_process|simple-git|spawn\(|execFile|fetch\(|writeFile|rm\(/u,
  );
});
