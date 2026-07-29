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
const timestamp = "2099-08-22T00:00:00.000Z";
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function semanticGraph() {
  return {
    graphVersion: semanticVersion,
    schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1,
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    snapshotFingerprint: "f".repeat(64),
    adapterVersions: ["typescript:typescript-semantic-adapter-v1"],
    lifecycle: "published",
    symbols: [{
      symbolId: semanticSymbolId,
      graphVersion: semanticVersion,
      tenantId: "tenant-1",
      repositoryId: "acme/widgets",
      repositoryRevision: revision,
      file: "src/routes/auth/login.ts",
      language: "typescript",
      kind: "function",
      name: "loginRoute",
      qualifiedName: "loginRoute",
      visibility: "public",
      signature: "function loginRoute()",
      documentationHash: "1".repeat(64),
      line: 1,
      column: 1,
      endLine: 2,
      endColumn: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    relationships: [],
    fileAnalyses: [{
      file: "src/routes/auth/login.ts",
      language: "typescript",
      adapterVersion: "typescript-semantic-adapter-v1",
      contentHash: "2".repeat(64),
      symbols: [],
      imports: [],
      diagnostics: [],
    }],
    diagnostics: [],
    metrics: {
      indexedSymbols: 1,
      indexedRelationships: 0,
      indexingDurationMs: 1,
      graphRebuilds: 1,
      incrementalUpdates: 0,
      recoveryOperations: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

function featureGraph() {
  const feature = {
    featureId,
    graphVersion: featureVersion,
    tenantId: "tenant-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    name: "Authentication",
    description: "Authentication spans one route.",
    confidence: 0.9,
    primaryEntryPoint: semanticSymbolId,
    primaryExitPoint: semanticSymbolId,
    entryPoints: [semanticSymbolId],
    exitPoints: [semanticSymbolId],
    owningModules: ["subsystem:auth"],
    files: ["src/routes/auth/login.ts"],
    symbolIds: [semanticSymbolId],
    lifecycle: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    graphVersion: featureVersion,
    schemaVersion: "feature-graph-v1",
    persistenceVersion: 1,
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    repositoryIntelligenceVersion: "intelligence-v1",
    semanticGraphVersion: semanticVersion,
    lifecycle: "published",
    features: [feature],
    relationships: [{
      relationshipId: "3".repeat(64),
      graphVersion: featureVersion,
      tenantId: "tenant-1",
      repositoryId: "acme/widgets",
      repositoryRevision: revision,
      fromFeatureId: featureId,
      toFeatureId: null,
      kind: "exposes_endpoint",
      target: "/auth/login",
      createdAt: timestamp,
    }],
    flows: [{
      flowId: "4".repeat(64),
      graphVersion: featureVersion,
      featureId,
      entryPoint: semanticSymbolId,
      exitPoint: semanticSymbolId,
      steps: [{
        position: 0,
        kind: "http_route",
        symbolId: semanticSymbolId,
        file: "src/routes/auth/login.ts",
        label: "loginRoute",
      }, {
        position: 1,
        kind: "response",
        symbolId: null,
        file: "src/routes/auth/login.ts",
        label: "Response",
      }],
      createdAt: timestamp,
    }],
    diagnostics: [{
      code: "feature_test",
      message: "durable feature diagnostic",
      featureId,
      severity: "info",
    }],
    metrics: {
      featuresDiscovered: 1,
      averageFeatureSize: 1,
      dependencyDensity: 0,
      rebuildDurationMs: 2,
      incrementalRebuildCount: 0,
      recoveryCount: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

test("PostgreSQL feature intelligence enforces normalized state, isolation, recovery, metrics, grants, RLS, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      scalar(url, `
        select graph from public.save_semantic_code_graph(
          ${json(semanticGraph())},null
        )
      `);
      const saved = JSON.parse(scalar(url, `
        select graph from public.save_feature_intelligence_graph(
          ${json(featureGraph())},null
        )
      `));
      assert.equal(saved.graphVersion, featureVersion);
      assert.equal(scalar(url, "select count(*) from public.features"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.feature_relationships"), "1");
      assert.equal(scalar(url, "select count(*) from public.feature_flows"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.feature_diagnostics"), "1");
      assert.equal(scalar(url, `
        select graph is null from public.get_feature_intelligence_graph(
          'tenant-2','user-1','acme/widgets','${revision}'
        )
      `), "");
      assert.equal(scalar(url, `
        select graph is null from public.get_feature_intelligence_graph(
          'tenant-1','user-2','acme/widgets','${revision}'
        )
      `), "");

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.feature_intelligence_metrics('tenant-1')
      `));
      assert.equal(metrics.featuresDiscovered, 1);
      assert.equal(metrics.averageFeatureSize, 1);
      assert.equal(metrics.rebuildDurationMs, 2);

      psql(url, `
        update public.feature_graph_versions set lifecycle='building',
          state=jsonb_set(state,'{lifecycle}','"building"'::jsonb)
        where graph_version='${featureVersion}'
      `);
      assert.equal(scalar(url, `
        select recovered_count
        from public.recover_feature_intelligence_graphs()
      `), "1");
      assert.equal(scalar(url, `
        select lifecycle||':'||recovery_count
        from public.feature_graph_versions
      `), "failed:1");
      assert.equal(scalar(url, `
        select valid from public.verify_feature_intelligence_contract(
          'feature-intelligence-v1','feature-graph-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.feature_graph_versions'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege('anon','public.features','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_feature_intelligence_graph(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_feature_intelligence_graphs('tenant-1',1)
      `), "0");
    });
  });
