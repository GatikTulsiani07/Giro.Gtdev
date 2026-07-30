import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations,
  createJobSql,
  postgresAvailability,
  psql,
  scalar,
  seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const timestamp = "2099-08-25T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function generation(lifecycle = "published") {
  const evidence = {
    evidenceId: "evidence_deterministic",
    kind: "file",
    reference: "src/auth/service.ts",
    sourceEngine: "Repository Intelligence",
    sourceVersion: "intelligence-v1",
    details: { reason: "central module" },
  };
  const insight = {
    insightId: "insight_deterministic",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    type: "architectural hotspot",
    title: "Authentication is an architectural hotspot",
    summary: "Authentication has high graph centrality.",
    severity: "high",
    confidence: 0.9,
    supportingEvidence: [evidence],
    relatedFeatures: ["feature-auth"],
    relatedSymbols: ["symbol-auth"],
    relatedFiles: ["src/auth/service.ts"],
    score: {
      total: 0.88,
      dependencyDepth: 0.8,
      featureImpact: 0.9,
      coupling: 0.85,
      usageFrequency: 0.7,
      queryFrequency: 0.75,
      architecturalCentrality: 0.95,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    generationId: lifecycle === "published"
      ? "generation_deterministic"
      : "generation_interrupted",
    schemaVersion: "repository-insight-schema-v1",
    persistenceVersion: 1,
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    sourceFingerprint: "f".repeat(64),
    sourceVersions: {
      repositoryIntelligence: "intelligence-v1",
      repositoryGraph: "graph-v1",
      semanticGraph: "semantic-v1",
      featureGraph: "feature-v1",
      changes: "change-source-v1",
      workflows: "workflow-source-v1",
      knowledge: "knowledge-source-v1",
      queries: "query-source-v1",
    },
    lifecycle,
    insights: lifecycle === "published" ? [insight] : [],
    diagnostics: [],
    generatedCount: lifecycle === "published" ? 1 : 0,
    reusedCount: 0,
    generationLatencyMs: lifecycle === "published" ? 14 : 0,
    recoveryCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: lifecycle === "published" ? timestamp : null,
  };
}

function seedPublishedSources(url) {
  psql(url, seedRepositorySql("acme/widgets"));
  const jobId = scalar(url, createJobSql("acme/widgets"));
  psql(url, `
    insert into public.repository_snapshots(
      repository_id,revision,commit_sha,job_id,status,indexed_at
    ) values(
      'acme/widgets','${revision}','${revision}','${jobId}',
      'published','${timestamp}'
    );
    insert into public.embedding_index_versions(
      embedding_version,repository_id,repository_revision,
      embedding_provider,embedding_model,embedding_dimension,
      chunking_strategy_version,status,published_at
    ) values(
      'embedding-v1','acme/widgets','${revision}',
      'test','test',3,'test-v1','published','${timestamp}'
    );
    insert into public.repository_graph_versions(
      graph_version,repository_id,repository_revision,parser_version,
      status,published_at
    ) values(
      'graph-v1','acme/widgets','${revision}','parser-v1',
      'published','${timestamp}'
    );
    insert into public.repository_intelligence_versions(
      intelligence_version,repository_id,repository_revision,graph_version,
      embedding_version,parser_version,analysis_version,status,published_at
    ) values(
      'intelligence-v1','acme/widgets','${revision}','graph-v1',
      'embedding-v1','parser-v1','analysis-v1','published','${timestamp}'
    );
    insert into public.semantic_graph_versions(
      tenant_id,graph_version,schema_version,persistence_version,owner_id,
      repository_id,repository_revision,snapshot_fingerprint,lifecycle,
      adapter_versions,state,indexed_symbols,indexed_relationships,
      indexing_duration_ms,graph_rebuilds,incremental_updates,
      recovery_operations,created_at,updated_at,published_at
    ) values(
      'tenant-1','semantic-v1','semantic-code-graph-v1',1,'user-1',
      'acme/widgets','${revision}','snapshot-v1','published','[]','{}',
      0,0,1,1,0,0,'${timestamp}','${timestamp}','${timestamp}'
    );
    insert into public.feature_graph_versions(
      tenant_id,graph_version,schema_version,persistence_version,owner_id,
      repository_id,repository_revision,repository_intelligence_version,
      semantic_graph_version,lifecycle,state,features_discovered,
      average_feature_size,dependency_density,rebuild_duration_ms,
      incremental_rebuild_count,recovery_count,created_at,updated_at,published_at
    ) values(
      'tenant-1','feature-v1','feature-graph-v1',1,'user-1',
      'acme/widgets','${revision}','intelligence-v1','semantic-v1',
      'published','{}',0,0,0,1,0,0,
      '${timestamp}','${timestamp}','${timestamp}'
    );
    update public.repositories set
      status='indexed',current_revision='${revision}',
      indexed_revision='${revision}'
    where repository_id='acme/widgets';
  `);
}

test("PostgreSQL repository insights match the memory contract and enforce lineage, ownership, recovery, metrics, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seedPublishedSources(url);

      const expected = generation();
      const saved = JSON.parse(scalar(url, `
        select generation from public.save_repository_insight_generation(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.deepEqual(JSON.parse(scalar(url, `
        select generation from public.get_repository_insight_generation(
          'tenant-1','user-1','acme/widgets','${revision}')
      `)), expected);
      assert.equal(scalar(url, `
        select count(*) from public.get_repository_insight_generation(
          'tenant-1','other','acme/widgets','${revision}')
      `), "0");
      assert.equal(scalar(url,
        "select count(*) from public.repository_insight_evidence"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_insight_scores"), "1");

      psql(url, `select public.record_repository_insight_reuse(
        'tenant-1','user-1','generation_deterministic',2)`);
      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_insight_metrics('tenant-1')
      `));
      assert.equal(metrics.insightsGenerated, 1);
      assert.equal(metrics.incrementalReuse, 2);
      assert.equal(Number(metrics.averageGenerationLatencyMs), 14);
      assert.equal(metrics.insightCategories["architectural hotspot"], 1);
      assert.equal(metrics.severityDistribution.high, 1);

      const verification = JSON.parse(scalar(url, `
        select row_to_json(contract) from (
          select * from public.verify_repository_insight_contract(
            'repository-insight-engine-v1','repository-insight-schema-v1')
        ) contract
      `));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(scalar(url, `select count(*) from pg_class where relname in(
        'repository_insight_generation_metadata','repository_insights',
        'repository_insight_evidence','repository_insight_scores',
        'repository_insight_diagnostics','repository_insight_retention'
      ) and relrowsecurity`), "6");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_insights','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_repository_insight_generation(jsonb,text)','execute')
      `), "t");

      scalar(url, `
        select generation from public.save_repository_insight_generation(
          ${json(generation("generating"))},null)
      `);
      assert.equal(scalar(url, `
        select recovered_count
        from public.recover_repository_insight_generations()
      `), "1");
      assert.equal(JSON.parse(scalar(url, `
        select generation from public.get_repository_insight_generation(
          'tenant-1','user-1','acme/widgets','${revision}')
      `)).lifecycle, "published");
      assert.equal(JSON.parse(scalar(url, `
        select metrics from public.repository_insight_metrics('tenant-1')
      `)).recoveryCount, 1);

      const extra = {
        ...generation("generating"),
        generationId: "generation_extra",
      };
      scalar(url, `
        select generation from public.save_repository_insight_generation(
          ${json(extra)},null)
      `);
      scalar(url, `
        select recovered_count
        from public.recover_repository_insight_generations()
      `);
      psql(url, `update public.repositories set
        current_revision='${"b".repeat(40)}',
        indexed_revision='${"b".repeat(40)}'
        where repository_id='acme/widgets'`);
      const stale = {
        ...generation(),
        generationId: "generation_stale",
      };
      assert.notEqual(psql(url, `
        select generation from public.save_repository_insight_generation(
          ${json(stale)},null)
      `, { allowFailure: true }).status, 0);
      assert.equal(scalar(url, `
        select deleted_count from public.collect_repository_insight_generations(
          'tenant-1',1)
      `), "1");
      assert.equal(scalar(url, `
        select retained_generations
        from public.repository_insight_retention
        where tenant_id='tenant-1'
      `), "1");
    });
  });
