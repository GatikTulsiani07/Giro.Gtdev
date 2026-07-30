import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations, createJobSql, postgresAvailability, psql, scalar,
  seedRepositorySql, withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const timestamp = "2099-08-28T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function specification(lifecycle = "published", id = "specification-1") {
  const kinds = [
    "preparation", "implementation", "verification", "testing", "review",
    "rollout", "post-deployment validation",
  ];
  const phases = lifecycle === "published" ? kinds.map((kind, position) => ({
    phaseId: `phase-${position}`, position, kind, title: kind,
    objective: `Complete ${kind}.`, actions: [`Validate ${kind}.`],
    evidenceReferences: ["intelligence-target"],
    dependsOn: position === 0 ? [] : [`phase-${position - 1}`],
  })) : [];
  return {
    specification: {
      specificationId: id,
      schemaVersion: "repository-engineering-specification-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      taskId: null, workflowId: null, type: "bug-fix",
      title: "Bug Fix Specification: Fix payment authentication",
      objective: "Fix payment authentication", scope: ["payments"],
      assumptions: ["Published evidence is current."],
      constraints: ["No source code is generated."], confidence: 0.86,
      ownershipFingerprint: "ownership-target", lifecycle,
      createdAt: timestamp, updatedAt: timestamp,
      completedAt: lifecycle === "published" ? timestamp : null,
    },
    context: {
      sourceVersions: {
        repositoryIntelligence: "intelligence-target",
        repositoryGraph: "graph-target", semanticGraph: "semantic-target",
        featureGraph: "feature-target",
      },
      repository: [], semantic: [], featureOwnership: [],
      architecture: [], workflows: [], knowledge: [], evolution: [],
      insights: [],
    },
    impact: {
      affectedFeatures: [], affectedModules: [], affectedFiles: [],
      affectedSymbols: [], dependencyChain: [], downstreamImpact: [],
    },
    implementationPhases: phases,
    risks: Object.fromEntries([
      "architectural", "dependency", "regression", "rollout",
    ].map((name) => [name, {
      score: 0, level: "low", summary: `${name} risk.`, evidence: [],
    }])),
    acceptanceCriteria: {
      functionalRequirements: ["Behavior is correct."],
      nonFunctionalRequirements: ["Contracts remain stable."],
      validationChecklist: ["Validate revision."],
      successCriteria: ["All checks pass."],
    },
    testStrategy: {
      unitTestingPlan: ["Run unit tests."],
      integrationTestingPlan: ["Run integration tests."],
      regressionTestingPlan: ["Run regression tests."],
      validationSteps: ["Validate results."],
    },
    diagnostics: [], cacheHit: false, orchestrationLatencyMs: 12,
    recoveryCount: 0,
  };
}

function seedSources(url) {
  psql(url, seedRepositorySql("acme/widgets"));
  const jobId = scalar(url, createJobSql("acme/widgets"));
  const snapshot = {
    intelligenceVersion: "intelligence-target",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    graphVersion: "graph-target", embeddingVersion: "embedding-target",
    parserVersion: "parser-v1", analysisVersion: "analysis-v1",
    schemaVersion: "repository-intelligence-schema-v1",
  };
  const semantic = {
    graphVersion: "semantic-target", schemaVersion: "semantic-code-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    snapshotFingerprint: "s".repeat(64), adapterVersions: [],
    lifecycle: "published", symbols: [], relationships: [],
    fileAnalyses: [], diagnostics: [], metrics: {
      indexedSymbols: 0, indexedRelationships: 0, indexingDurationMs: 0,
      graphRebuilds: 1, incrementalUpdates: 0, recoveryOperations: 0,
    }, createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
  const feature = {
    graphVersion: "feature-target", schemaVersion: "feature-graph-v1",
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    repositoryIntelligenceVersion: "intelligence-target",
    semanticGraphVersion: "semantic-target", lifecycle: "published",
    features: [], relationships: [], flows: [], diagnostics: [],
    metrics: {
      featuresDiscovered: 0, averageFeatureSize: 0, dependencyDensity: 0,
      rebuildDurationMs: 0, incrementalRebuildCount: 0, recoveryCount: 0,
    }, createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
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
      'embedding-target','acme/widgets','${revision}',
      'test','test',3,'v1','published','${timestamp}'
    );
    insert into public.repository_graph_versions(
      graph_version,repository_id,repository_revision,parser_version,
      status,published_at
    ) values(
      'graph-target','acme/widgets','${revision}','parser-v1',
      'published','${timestamp}'
    );
    insert into public.repository_graph_diagnostics(
      graph_version,is_valid,validated_at
    ) values('graph-target',true,'${timestamp}');
    insert into public.repository_intelligence_versions(
      intelligence_version,repository_id,repository_revision,graph_version,
      embedding_version,parser_version,analysis_version,status,
      validated_at,published_at
    ) values(
      'intelligence-target','acme/widgets','${revision}','graph-target',
      'embedding-target','parser-v1','analysis-v1','published',
      '${timestamp}','${timestamp}'
    );
    insert into public.repository_intelligence_snapshots(
      intelligence_version,snapshot,publication_metadata
    ) values(
      'intelligence-target',${json(snapshot)},${json({
        repositoryRevision: revision, graphVersion: "graph-target",
        embeddingVersion: "embedding-target",
        previousIntelligenceVersion: null,
      })}
    );
    insert into public.semantic_graph_versions(
      tenant_id,graph_version,schema_version,persistence_version,owner_id,
      repository_id,repository_revision,snapshot_fingerprint,lifecycle,
      adapter_versions,state,indexed_symbols,indexed_relationships,
      indexing_duration_ms,graph_rebuilds,incremental_updates,
      recovery_operations,created_at,updated_at,published_at
    ) values(
      'tenant-1','semantic-target','semantic-code-graph-v1',1,'user-1',
      'acme/widgets','${revision}','fingerprint','published','[]',
      ${json(semantic)},0,0,0,1,0,0,
      '${timestamp}','${timestamp}','${timestamp}'
    );
    insert into public.feature_graph_versions(
      tenant_id,graph_version,schema_version,persistence_version,owner_id,
      repository_id,repository_revision,repository_intelligence_version,
      semantic_graph_version,lifecycle,state,features_discovered,
      average_feature_size,dependency_density,rebuild_duration_ms,
      incremental_rebuild_count,recovery_count,created_at,updated_at,published_at
    ) values(
      'tenant-1','feature-target','feature-graph-v1',1,'user-1',
      'acme/widgets','${revision}','intelligence-target','semantic-target',
      'published',${json(feature)},0,0,0,0,0,0,
      '${timestamp}','${timestamp}','${timestamp}'
    );
    update public.repositories set status='indexed',
      current_revision='${revision}',indexed_revision='${revision}'
    where repository_id='acme/widgets';
  `);
}

test("PostgreSQL specification engine matches memory serialization and enforces durability contracts",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seedSources(url);
      const expected = specification();
      const saved = JSON.parse(scalar(url, `
        select specification
        from public.save_repository_engineering_specification(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.deepEqual(JSON.parse(scalar(url, `
        select specification
        from public.get_repository_engineering_specification(
          'tenant-1','user-1','specification-1')
      `)), expected);
      assert.equal(scalar(url, `
        select count(*) from public.get_repository_engineering_specification(
          'tenant-1','other','specification-1')
      `), "0");
      assert.equal(scalar(url,
        "select count(*) from public.repository_specification_phases"), "7");
      assert.equal(scalar(url, `
        select count(*)
        from public.repository_specification_acceptance_criteria
      `), "4");
      psql(url, `select public.record_repository_specification_cache_hit(
        'tenant-1','user-1','specification-1')`);
      const metrics = JSON.parse(scalar(url, `
        select public.repository_specification_engine_metrics('tenant-1')
      `));
      assert.equal(Number(metrics.specificationsCreated), 1);
      assert.equal(Number(metrics.cacheHits), 1);
      assert.equal(Number(metrics.averageOrchestrationLatencyMs), 12);
      assert.equal(Number(metrics.reuseRate), 0.5);
      const verification = JSON.parse(scalar(url,
        "select public.verify_repository_specification_engine_contract()"));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(scalar(url, `
        select count(*) from pg_class where relname in(
          'repository_engineering_specifications',
          'repository_specification_phases',
          'repository_specification_acceptance_criteria',
          'repository_specification_diagnostics',
          'repository_specification_cache',
          'repository_specification_metrics',
          'repository_specification_retention'
        ) and relrowsecurity
      `), "7");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_engineering_specifications','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'service_role','public.repository_engineering_specifications',
          'select')
      `), "t");
      psql(url, `
        update public.repositories set current_revision=null,
          indexed_revision=null where repository_id='acme/widgets'
      `);
      assert.throws(() => psql(url, `
        select public.save_repository_engineering_specification(
          ${json({ ...expected, specification: {
            ...expected.specification, specificationId: "stale",
          } })},null)
      `), /repository_specification_revision_or_ownership_invalid/);
      psql(url, `
        update public.repositories set current_revision='${revision}',
          indexed_revision='${revision}' where repository_id='acme/widgets'
      `);
      const interrupted = specification("generating", "interrupted");
      interrupted.specification.objective = "Interrupted generation";
      interrupted.specification.title =
        "Feature Specification: Interrupted generation";
      psql(url, `
        select public.save_repository_engineering_specification(
          ${json(interrupted)},null)
      `);
      assert.equal(scalar(url,
        "select public.recover_repository_engineering_specifications()"), "1");
      assert.equal(scalar(url, `
        select lifecycle from public.repository_engineering_specifications
        where specification_id='interrupted'
      `), "failed");
      assert.equal(scalar(url, `
        select public.collect_repository_engineering_specifications(
          'tenant-1',1)
      `), "0");
    });
  });
