import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations,
  postgresAvailability,
  psql,
  scalar,
  seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const semanticVersion = "b".repeat(64);
const semanticSymbolId = "c".repeat(64);
const featureVersion = "d".repeat(64);
const featureId = "e".repeat(64);
const changeId = "f".repeat(64);
const analysisId = "1".repeat(64);
const timestamp = "2099-08-23T00:00:00.000Z";
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function semanticGraph() {
  return {
    graphVersion: semanticVersion, schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: "2".repeat(64),
    adapterVersions: ["typescript:typescript-semantic-adapter-v1"],
    lifecycle: "published",
    symbols: [{
      symbolId: semanticSymbolId, graphVersion: semanticVersion,
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, file: "src/routes/auth/login.ts",
      language: "typescript", kind: "function", name: "loginRoute",
      qualifiedName: "loginRoute", visibility: "public",
      signature: "function loginRoute()", documentationHash: "3".repeat(64),
      line: 1, column: 1, endLine: 2, endColumn: 1,
      createdAt: timestamp, updatedAt: timestamp,
    }],
    relationships: [],
    fileAnalyses: [{
      file: "src/routes/auth/login.ts", language: "typescript",
      adapterVersion: "typescript-semantic-adapter-v1",
      contentHash: "4".repeat(64), symbols: [], imports: [], diagnostics: [],
    }],
    diagnostics: [],
    metrics: { indexedSymbols: 1, indexedRelationships: 0,
      indexingDurationMs: 1, graphRebuilds: 1, incrementalUpdates: 0,
      recoveryOperations: 0 },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}

function featureGraph() {
  return {
    graphVersion: featureVersion, schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligenceVersion: "intelligence-v1",
    semanticGraphVersion: semanticVersion, lifecycle: "published",
    features: [{
      featureId, graphVersion: featureVersion, tenantId: "tenant-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      name: "Authentication", description: "Authentication route.",
      confidence: 0.9, primaryEntryPoint: semanticSymbolId,
      primaryExitPoint: semanticSymbolId, entryPoints: [semanticSymbolId],
      exitPoints: [semanticSymbolId], owningModules: ["routes"],
      files: ["src/routes/auth/login.ts"], symbolIds: [semanticSymbolId],
      lifecycle: "active", createdAt: timestamp, updatedAt: timestamp,
    }],
    relationships: [{
      relationshipId: "5".repeat(64), graphVersion: featureVersion,
      tenantId: "tenant-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, fromFeatureId: featureId,
      toFeatureId: null, kind: "exposes_endpoint", target: "/auth/login",
      createdAt: timestamp,
    }],
    flows: [{
      flowId: "6".repeat(64), graphVersion: featureVersion, featureId,
      entryPoint: semanticSymbolId, exitPoint: semanticSymbolId,
      steps: [
        { position: 0, kind: "http_route", symbolId: semanticSymbolId,
          file: "src/routes/auth/login.ts", label: "loginRoute" },
        { position: 1, kind: "response", symbolId: null,
          file: "src/routes/auth/login.ts", label: "Response" },
      ], createdAt: timestamp,
    }],
    diagnostics: [],
    metrics: { featuresDiscovered: 1, averageFeatureSize: 1,
      dependencyDensity: 0, rebuildDurationMs: 1,
      incrementalRebuildCount: 0, recoveryCount: 0 },
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}

function analysis() {
  const request = {
    changeId, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    workflowId: "workflow-1",
    requestedTarget: { kind: "route", value: "/auth/login" },
    changeType: "modify", rationale: "Harden authentication.",
    createdAt: timestamp, updatedAt: timestamp,
  };
  const impact = {
    impactGraphId: "7".repeat(64), changeId,
    directlyAffectedFiles: ["src/routes/auth/login.ts"],
    indirectlyAffectedFiles: [], affectedSymbolIds: [semanticSymbolId],
    affectedFeatureIds: [featureId], affectedApis: ["/auth/login"],
    affectedWorkflowIds: ["workflow-1", "6".repeat(64)],
    dependencyChains: [{
      chainId: "8".repeat(64), steps: [
        { position: 0, kind: "feature", id: featureId },
        { position: 1, kind: "api", id: "/auth/login" },
      ],
    }], maximumDependencyDepth: 1,
  };
  const risk = {
    riskAssessmentId: "9".repeat(64), changeId, level: "medium", score: 34,
    reasons: ["directFiles:4"], factors: { directFiles: 4 },
  };
  const phases = [
    "preparation", "preparation", "dependencies", "implementation",
    "implementation", "validation", "validation", "review",
  ];
  const steps = phases.map((phase, position) => ({
    stepId: `${position}`.repeat(64), position, phase,
    action: `Metadata step ${position}.`, targets: [changeId],
  }));
  return {
    analysisId, schemaVersion: "change-analysis-v1",
    persistenceVersion: 1, lifecycle: "published", request,
    repositoryIntelligenceVersion: "intelligence-v1",
    semanticGraphVersion: semanticVersion, featureGraphVersion: featureVersion,
    impact, risk, implementationPlan: {
      implementationPlanId: "a".repeat(64), changeId, steps,
    },
    diagnostics: [], createdAt: timestamp, updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

test("PostgreSQL change intelligence preserves state, lineage, reuse, recovery, metrics, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',
          indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      scalar(url, `select graph from public.save_semantic_code_graph(
        ${json(semanticGraph())},null)`);
      scalar(url, `select graph from public.save_feature_intelligence_graph(
        ${json(featureGraph())},null)`);

      const expected = analysis();
      const saved = JSON.parse(scalar(url, `
        select analysis from public.save_change_intelligence_analysis(
          ${json(expected)},null)
      `));
      assert.equal(saved.analysisId, analysisId);
      assert.equal(saved.persistenceVersion, 1);
      assert.deepEqual(saved.impact, expected.impact);
      assert.equal(JSON.parse(scalar(url, `
        select analysis from public.get_change_intelligence_analysis(
          'tenant-1','user-1','${changeId}')
      `)).analysisId, analysisId);
      assert.equal(scalar(url, `
        select count(*) from public.get_change_intelligence_analysis(
          'tenant-1','other','${changeId}')
      `), "0");

      psql(url, `select public.record_change_intelligence_reuse(
        'tenant-1','user-1','${changeId}')`);
      const metrics = JSON.parse(scalar(url, `
        select metrics from public.change_intelligence_metrics('tenant-1')
      `));
      assert.equal(metrics.analyses, 1);
      assert.equal(metrics.averageImpactSize, 3);
      assert.equal(metrics.averageDependencyDepth, 1);
      assert.equal(metrics.riskDistribution.medium, 1);
      assert.equal(metrics.reuseRate, 0.5);

      const verification = JSON.parse(scalar(url, `
        select row_to_json(contract) from (
          select * from public.verify_change_intelligence_contract(
            'change-intelligence-v1','change-analysis-v1')
        ) contract
      `));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(scalar(url, `
        select count(*) from pg_class where relname in(
          'change_requests','change_analyses','change_impact_graphs',
          'change_risk_assessments','change_implementation_plans',
          'change_diagnostics','change_intelligence_retention'
        ) and relrowsecurity
      `), "7");
      assert.equal(scalar(url, `
        select has_table_privilege('anon','public.change_analyses','select')
      `), "f");

      psql(url, `update public.change_analyses set lifecycle='building'
        where tenant_id='tenant-1' and analysis_id='${analysisId}'`);
      assert.equal(scalar(url, `
        select recovered_count
        from public.recover_change_intelligence_analyses()
      `), "1");
      assert.equal(scalar(url, `
        select count(*) from public.get_change_intelligence_analysis(
          'tenant-1','user-1','${changeId}')
      `), "0");
      assert.equal(scalar(url, `
        select deleted_count from public.collect_change_intelligence_analyses(
          'tenant-1',1)
      `), "0");
      assert.equal(scalar(url, `
        select retained_analyses from public.change_intelligence_retention
        where tenant_id='tenant-1'
      `), "1");
    });
  });
