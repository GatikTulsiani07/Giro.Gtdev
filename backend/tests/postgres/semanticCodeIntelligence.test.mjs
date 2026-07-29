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
const graphVersion = "b".repeat(64);
const moduleId = "c".repeat(64);
const functionId = "d".repeat(64);
const timestamp = "2099-08-21T00:00:00.000Z";
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function symbol(symbolId, kind, name, line) {
  return {
    symbolId,
    graphVersion,
    tenantId: "tenant-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    file: "src/a.ts",
    language: "typescript",
    kind,
    name,
    qualifiedName: name,
    visibility: "public",
    signature: `${kind} ${name}`,
    documentationHash: "e".repeat(64),
    line,
    column: 1,
    endLine: line,
    endColumn: 10,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function edge(relationshipId, fromSymbolId, toSymbolId, kind) {
  return {
    relationshipId,
    graphVersion,
    tenantId: "tenant-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    fromSymbolId,
    toSymbolId,
    kind,
    createdAt: timestamp,
  };
}

function graph() {
  return {
    graphVersion,
    schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1,
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    snapshotFingerprint: "f".repeat(64),
    adapterVersions: ["typescript:typescript-semantic-adapter-v1"],
    lifecycle: "published",
    symbols: [
      symbol(moduleId, "module", "src/a.ts", 1),
      symbol(functionId, "function", "run", 2),
    ],
    relationships: [
      edge("1".repeat(64), functionId, moduleId, "references"),
      edge("2".repeat(64), moduleId, functionId, "referenced_by"),
    ],
    fileAnalyses: [{
      file: "src/a.ts",
      language: "typescript",
      adapterVersion: "typescript-semantic-adapter-v1",
      contentHash: "3".repeat(64),
      symbols: [],
      imports: [],
      diagnostics: [],
    }],
    diagnostics: [{
      code: "semantic_test",
      message: "durable diagnostic",
      file: "src/a.ts",
      severity: "info",
    }],
    metrics: {
      indexedSymbols: 2,
      indexedRelationships: 2,
      indexingDurationMs: 4,
      graphRebuilds: 1,
      incrementalUpdates: 0,
      recoveryOperations: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

test("PostgreSQL semantic graph enforces persistence, isolation, recovery, metrics, grants, RLS, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      const state = graph();
      const saved = JSON.parse(scalar(url, `
        select graph from public.save_semantic_code_graph(${json(state)},null)
      `));
      assert.equal(saved.graphVersion, graphVersion);
      assert.equal(scalar(url, "select count(*) from public.semantic_symbols"), "2");
      assert.equal(scalar(url, "select count(*) from public.semantic_edges"), "2");
      assert.equal(scalar(url,
        "select count(*) from public.semantic_language_metadata"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.semantic_indexing_diagnostics"), "1");
      assert.equal(scalar(url, `
        select graph is null from public.get_semantic_code_graph(
          'tenant-2','user-1','acme/widgets','${revision}'
        )
      `), "");
      assert.equal(scalar(url, `
        select graph is null from public.get_semantic_code_graph(
          'tenant-1','user-2','acme/widgets','${revision}'
        )
      `), "");

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.semantic_code_graph_metrics('tenant-1')
      `));
      assert.equal(metrics.indexedSymbols, 2);
      assert.equal(metrics.indexedRelationships, 2);
      assert.equal(metrics.graphRebuilds, 1);

      psql(url, `
        update public.semantic_graph_versions set lifecycle='building',
          state=jsonb_set(state,'{lifecycle}','"building"'::jsonb)
        where graph_version='${graphVersion}'
      `);
      assert.equal(scalar(url,
        "select recovered_count from public.recover_semantic_code_graphs()"), "1");
      assert.equal(scalar(url, `
        select lifecycle||':'||recovery_operations
        from public.semantic_graph_versions
      `), "failed:1");
      assert.equal(scalar(url, `
        select valid from public.verify_semantic_code_graph_contract(
          'semantic-code-intelligence-v1','semantic-code-graph-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.semantic_graph_versions'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.semantic_symbols','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role','public.save_semantic_code_graph(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_semantic_code_graphs('tenant-1',1)
      `), "0");
    });
  });
