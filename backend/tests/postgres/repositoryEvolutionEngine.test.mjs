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
const baseRevision = "a".repeat(40);
const targetRevision = "b".repeat(40);
const timestamp = "2099-08-26T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

const emptyAuxiliary = () => ({
  added: [], removed: [], modified: [],
});

function record(lifecycle = "published", evolutionId = "evolution-deterministic") {
  const evidence = {
    evidenceId: "evidence-feature",
    sourceEngine: "Feature Intelligence",
    sourceVersion: "feature-target",
    reference: "feature-payments",
    details: { side: "target" },
  };
  const feature = {
    entityId: "feature-entity", name: "Payments", change: "modified",
    before: { size: 2 }, after: { size: 4 }, evidence: [evidence],
  };
  const comparison = {
    features: { added: [], removed: [], modified: [feature] },
    architecture: {
      newModules: [], removedModules: [], couplingChanges: [],
      dependencyGrowth: 0, introducedCycles: [], resolvedCycles: [],
      hotspotChanges: [],
    },
    dependencies: { added: [], removed: [] },
    semantic: {
      symbolAdditions: [], symbolRemovals: [], interfaceChanges: [],
      inheritanceChanges: [], implementationChanges: [], apiEvolution: [],
    },
    workflows: emptyAuxiliary(),
    knowledge: emptyAuxiliary(),
  };
  const timeline = {
    timelineId: "timeline-feature", evolutionId, kind: "feature",
    entityId: "feature-entity", entityName: "Payments", change: "modified",
    baseRevision, targetRevision, evidence: [evidence],
    details: { before: { size: 2 }, after: { size: 4 } },
    occurredAt: timestamp,
  };
  const trend = {
    trendId: "trend-feature", evolutionId, type: "expanding features",
    direction: "increasing", magnitude: 0.2, confidence: 0.9,
    summary: "Published feature size increased.", evidence: [evidence],
  };
  return {
    evolutionId, schemaVersion: "repository-evolution-schema-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", baseRevision, targetRevision,
    comparisonTimestamp: timestamp,
    analysisVersion: "repository-evolution-analysis-v1",
    sourceFingerprint: "f".repeat(64),
    sourceVersions: {
      baseRepositoryIntelligence: "intelligence-base",
      targetRepositoryIntelligence: "intelligence-target",
      baseRepositoryGraph: "graph-base", targetRepositoryGraph: "graph-target",
      baseSemanticGraph: "semantic-base", targetSemanticGraph: "semantic-target",
      baseFeatureGraph: "feature-base", targetFeatureGraph: "feature-target",
      workflows: "workflow-sources", knowledge: "knowledge-sources",
    },
    lifecycle, comparison,
    timelines: lifecycle === "published" ? [timeline] : [],
    trends: lifecycle === "published" ? [trend] : [],
    diagnostics: [], reusedCount: 0,
    comparisonLatencyMs: lifecycle === "published" ? 15 : 0,
    recoveryCount: 0, createdAt: timestamp, updatedAt: timestamp,
    publishedAt: lifecycle === "published" ? timestamp : null,
  };
}

function intelligenceSnapshot(revision, intelligenceVersion, graphVersion,
  embeddingVersion) {
  return {
    intelligenceVersion, repositoryId: "acme/widgets",
    repositoryRevision: revision, graphVersion, embeddingVersion,
    parserVersion: "parser-v1", analysisVersion: "analysis-v1",
    schemaVersion: "repository-intelligence-schema-v1",
    architecture: {
      subsystemIds: [], packageHierarchy: [], dependencyGraph: [],
      layers: [], hotspots: [],
    },
    codeOrganization: {
      largestModules: [], mostImportedFiles: [], highestFanIn: [],
      highestFanOut: [], cyclicDependencies: [], utilityClusters: [],
    },
    symbols: {
      publicApis: [], internalApis: [], orphanSymbols: [], deadExports: [],
      entrypoints: [], sharedAbstractions: [],
    },
    quality: {
      duplicateImplementations: [], oversizedFiles: [],
      oversizedFunctions: [], todoFixmeDensity: 0,
      generatedCodeRatio: 0, documentationCoverage: 1,
    },
    evolution: {
      changedHotspots: [], stableAreas: [], architecturalDrift: [],
      growth: {
        files: 0, symbols: 0, dependencyEdges: 0,
        fileDelta: 0, symbolDelta: 0, dependencyEdgeDelta: 0,
      },
    },
    subsystems: [],
    metrics: {
      filesAnalyzed: 0, symbolsAnalyzed: 0,
      dependencyEdgesAnalyzed: 0, generatedSubsystems: 0,
      qualityFindings: 0, hotspots: 0,
    },
  };
}

function semanticState(revision, graphVersion, lifecycle) {
  return {
    graphVersion, schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: "s".repeat(64), adapterVersions: [],
    lifecycle, symbols: [], relationships: [], fileAnalyses: [],
    diagnostics: [], metrics: {
      indexedSymbols: 0, indexedRelationships: 0, indexingDurationMs: 1,
      graphRebuilds: 1, incrementalUpdates: 0, recoveryOperations: 0,
    }, createdAt: timestamp, updatedAt: timestamp,
    publishedAt: lifecycle === "published" ? timestamp : null,
  };
}

function featureState(revision, graphVersion, lifecycle,
  intelligenceVersion, semanticVersion) {
  return {
    graphVersion, schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligenceVersion: intelligenceVersion,
    semanticGraphVersion: semanticVersion, lifecycle,
    features: [], relationships: [], flows: [], diagnostics: [],
    metrics: {
      featuresDiscovered: 0, averageFeatureSize: 0, dependencyDensity: 0,
      rebuildDurationMs: 1, incrementalRebuildCount: 0, recoveryCount: 0,
    }, createdAt: timestamp, updatedAt: timestamp,
    publishedAt: lifecycle === "published" ? timestamp : null,
  };
}

function seedSources(url) {
  psql(url, seedRepositorySql("acme/widgets"));
  const jobId = scalar(url, createJobSql("acme/widgets"));
  const baseIntel = intelligenceSnapshot(
    baseRevision, "intelligence-base", "graph-base", "embedding-base");
  const targetIntel = intelligenceSnapshot(
    targetRevision, "intelligence-target", "graph-target", "embedding-target");
  psql(url, `
    insert into public.repository_snapshots(
      repository_id,revision,commit_sha,job_id,status,indexed_at
    ) values
      ('acme/widgets','${baseRevision}','${baseRevision}','${jobId}',
       'superseded',null),
      ('acme/widgets','${targetRevision}','${targetRevision}','${jobId}',
       'published','${timestamp}');
    insert into public.embedding_index_versions(
      embedding_version,repository_id,repository_revision,
      embedding_provider,embedding_model,embedding_dimension,
      chunking_strategy_version,status,published_at
    ) values
      ('embedding-base','acme/widgets','${baseRevision}',
       'test','test',3,'v1','superseded',null),
      ('embedding-target','acme/widgets','${targetRevision}',
       'test','test',3,'v1','published','${timestamp}');
    insert into public.repository_graph_versions(
      graph_version,repository_id,repository_revision,parser_version,
      status,published_at
    ) values
      ('graph-base','acme/widgets','${baseRevision}','parser-v1',
       'superseded',null),
      ('graph-target','acme/widgets','${targetRevision}','parser-v1',
       'published','${timestamp}');
    insert into public.repository_graph_diagnostics(
      graph_version,is_valid,validated_at
    ) values
      ('graph-base',true,'${timestamp}'),
      ('graph-target',true,'${timestamp}');
    insert into public.repository_intelligence_versions(
      intelligence_version,repository_id,repository_revision,graph_version,
      embedding_version,parser_version,analysis_version,status,
      validated_at,published_at
    ) values
      ('intelligence-base','acme/widgets','${baseRevision}','graph-base',
       'embedding-base','parser-v1','analysis-v1','superseded',
       '${timestamp}',null),
      ('intelligence-target','acme/widgets','${targetRevision}','graph-target',
       'embedding-target','parser-v1','analysis-v1','published',
       '${timestamp}','${timestamp}');
    insert into public.repository_intelligence_snapshots(
      intelligence_version,snapshot,publication_metadata
    ) values
      ('intelligence-base',${json(baseIntel)},${json({
        repositoryRevision: baseRevision, graphVersion: "graph-base",
        embeddingVersion: "embedding-base", previousIntelligenceVersion: null,
      })}),
      ('intelligence-target',${json(targetIntel)},${json({
        repositoryRevision: targetRevision, graphVersion: "graph-target",
        embeddingVersion: "embedding-target",
        previousIntelligenceVersion: "intelligence-base",
      })});
    insert into public.semantic_graph_versions(
      tenant_id,graph_version,schema_version,persistence_version,owner_id,
      repository_id,repository_revision,snapshot_fingerprint,lifecycle,
      adapter_versions,state,indexed_symbols,indexed_relationships,
      indexing_duration_ms,graph_rebuilds,incremental_updates,
      recovery_operations,created_at,updated_at,published_at
    ) values
      ('tenant-1','semantic-base','semantic-code-graph-v1',1,'user-1',
       'acme/widgets','${baseRevision}','base-fingerprint','superseded',
       '[]',${json(semanticState(baseRevision, "semantic-base", "superseded"))},
       0,0,1,1,0,0,'${timestamp}','${timestamp}',null),
      ('tenant-1','semantic-target','semantic-code-graph-v1',1,'user-1',
       'acme/widgets','${targetRevision}','target-fingerprint','published',
       '[]',${json(semanticState(targetRevision, "semantic-target", "published"))},
       0,0,1,1,0,0,'${timestamp}','${timestamp}','${timestamp}');
    insert into public.feature_graph_versions(
      tenant_id,graph_version,schema_version,persistence_version,owner_id,
      repository_id,repository_revision,repository_intelligence_version,
      semantic_graph_version,lifecycle,state,features_discovered,
      average_feature_size,dependency_density,rebuild_duration_ms,
      incremental_rebuild_count,recovery_count,created_at,updated_at,published_at
    ) values
      ('tenant-1','feature-base','feature-graph-v1',1,'user-1',
       'acme/widgets','${baseRevision}','intelligence-base','semantic-base',
       'superseded',${json(featureState(
         baseRevision, "feature-base", "superseded",
         "intelligence-base", "semantic-base"))},
       0,0,0,1,0,0,'${timestamp}','${timestamp}',null),
      ('tenant-1','feature-target','feature-graph-v1',1,'user-1',
       'acme/widgets','${targetRevision}','intelligence-target','semantic-target',
       'published',${json(featureState(
         targetRevision, "feature-target", "published",
         "intelligence-target", "semantic-target"))},
       0,0,0,1,0,0,'${timestamp}','${timestamp}','${timestamp}');
    update public.repositories set status='indexed',
      current_revision='${targetRevision}',indexed_revision='${targetRevision}'
    where repository_id='acme/widgets';
  `);
}

test("PostgreSQL evolution matches memory serialization and enforces historical lineage, ownership, recovery, metrics, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seedSources(url);

      const historicalBase = JSON.parse(scalar(url, `
        select revision_source
        from public.get_repository_evolution_revision_source(
          'tenant-1','user-1','acme/widgets','${baseRevision}')
      `));
      assert.equal(historicalBase.repositoryIntelligence.status, "superseded");
      assert.equal(historicalBase.repositoryGraph.status, "superseded");
      assert.equal(historicalBase.semanticGraph.lifecycle, "superseded");
      assert.equal(historicalBase.featureGraph.lifecycle, "superseded");

      const expected = record();
      const saved = JSON.parse(scalar(url, `
        select record from public.save_repository_evolution_record(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.deepEqual(JSON.parse(scalar(url, `
        select record from public.get_repository_evolution_record(
          'tenant-1','user-1','acme/widgets',
          '${baseRevision}','${targetRevision}')
      `)), expected);
      assert.equal(scalar(url, `
        select count(*) from public.get_repository_evolution_record(
          'tenant-1','other','acme/widgets',
          '${baseRevision}','${targetRevision}')
      `), "0");
      assert.equal(scalar(url,
        "select count(*) from public.repository_revision_comparisons"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_evolution_timelines"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_evolution_trend_summaries"), "1");

      psql(url, `select public.record_repository_evolution_reuse(
        'tenant-1','user-1','evolution-deterministic')`);
      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_evolution_metrics('tenant-1')
      `));
      assert.equal(metrics.comparisons, 1);
      assert.equal(metrics.timelines, 1);
      assert.equal(metrics.trends, 1);
      assert.equal(Number(metrics.reuseRate), 0.5);
      assert.equal(Number(metrics.averageComparisonLatencyMs), 15);

      const verification = JSON.parse(scalar(url, `
        select row_to_json(contract) from (
          select * from public.verify_repository_evolution_contract(
            'repository-evolution-intelligence-v1',
            'repository-evolution-schema-v1')
        ) contract
      `));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(scalar(url, `select count(*) from pg_class where relname in(
        'repository_evolution_records','repository_revision_comparisons',
        'repository_evolution_timelines',
        'repository_evolution_trend_summaries',
        'repository_evolution_diagnostics','repository_evolution_retention'
      ) and relrowsecurity`), "6");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_evolution_records','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_repository_evolution_record(jsonb,text)','execute')
      `), "t");

      scalar(url, `
        select record from public.save_repository_evolution_record(
          ${json(record("comparing", "evolution-interrupted"))},null)
      `);
      assert.equal(scalar(url, `
        select recovered_count
        from public.recover_repository_evolution_records()
      `), "1");
      assert.equal(JSON.parse(scalar(url, `
        select metrics from public.repository_evolution_metrics('tenant-1')
      `)).recoveryCount, 1);
      assert.equal(scalar(url, `
        select deleted_count from public.collect_repository_evolution_records(
          'tenant-1',1)
      `), "0");
      assert.equal(scalar(url, `
        select retained_records from public.repository_evolution_retention
        where tenant_id='tenant-1'
      `), "1");

      psql(url, `update public.repositories set
        current_revision='${"c".repeat(40)}',
        indexed_revision='${"c".repeat(40)}'
        where repository_id='acme/widgets'`);
      assert.notEqual(psql(url, `
        select record from public.save_repository_evolution_record(
          ${json({ ...expected, evolutionId: "evolution-stale" })},null)
      `, { allowFailure: true }).status, 0);
    });
  });
