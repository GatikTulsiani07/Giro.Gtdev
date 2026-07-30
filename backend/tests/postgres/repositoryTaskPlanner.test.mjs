import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations, createJobSql, postgresAvailability, psql, scalar,
  seedRepositorySql, withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const timestamp = "2099-08-27T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function plan(lifecycle = "published", taskId = "task-deterministic") {
  const kinds = [
    "preparation", "investigation", "implementation", "validation",
    "testing", "review", "deployment readiness",
  ];
  const phases = lifecycle === "published" ? kinds.map((kind, position) => ({
    phaseId: `phase-${position}`, position, kind, title: kind,
    objective: `Plan ${kind}.`, targets: [], actions: [`Review ${kind}.`],
    dependsOn: position === 0 ? [] : [`phase-${position - 1}`],
    evidenceReferences: ["intelligence-target"],
  })) : [];
  return {
    task: {
      taskId, schemaVersion: "repository-task-plan-schema-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      userRequest: "Fix payment bug",
      normalizedObjective: "fix payment bug", category: "bug fix",
      confidence: 0.86, lifecycle, createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: lifecycle === "published" ? timestamp : null,
    },
    sourceVersions: {
      repositoryIntelligence: "intelligence-target",
      repositoryGraph: "graph-target", semanticGraph: "semantic-target",
      featureGraph: "feature-target",
    },
    orchestrationPlan: [{
      position: 0, engine: "Repository Intelligence", required: true,
      reason: "bug fix planning evidence",
    }],
    impact: {
      affectedFeatures: [], affectedModules: [], affectedFiles: [],
      affectedSymbols: [], dependencies: [], downstreamImpact: [],
    },
    phases,
    risk: {
      implementationComplexity: 0, architecturalRisk: 0,
      dependencyRisk: 0, regressionRisk: 0, overallRisk: 0, level: "low",
      inputs: { affectedFiles: 0 },
    },
    validationChecklist: {
      requiredTests: ["Focused tests"], verificationSteps: ["Verify revision"],
      affectedWorkflows: [], reviewChecklist: ["Review scope"],
    },
    changeRoadmap: null, changeRisk: null, diagnostics: [],
    engineUsage: ["Repository Intelligence"], cacheHit: false,
    orchestrationLatencyMs: 12, accuracyInputCount: 4, recoveryCount: 0,
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

test("PostgreSQL task planner matches memory serialization and enforces ownership, revision fencing, cache, recovery, metrics, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seedSources(url);
      const expected = plan();
      const saved = JSON.parse(scalar(url, `
        select plan from public.save_repository_task_plan(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.deepEqual(JSON.parse(scalar(url, `
        select plan from public.get_repository_task_plan(
          'tenant-1','user-1','task-deterministic')
      `)), expected);
      assert.equal(scalar(url, `
        select count(*) from public.get_repository_task_plan(
          'tenant-1','other','task-deterministic')
      `), "0");
      assert.equal(scalar(url,
        "select count(*) from public.repository_task_execution_phases"), "7");
      psql(url, `select public.record_repository_task_plan_cache_hit(
        'tenant-1','user-1','task-deterministic')`);
      const metrics = JSON.parse(scalar(url, `
        select public.repository_task_planner_metrics('tenant-1')
      `));
      assert.equal(Number(metrics.plansCreated), 1);
      assert.equal(Number(metrics.cacheHits), 1);
      assert.equal(Number(metrics.averageOrchestrationLatencyMs), 12);
      assert.equal(Number(metrics.averageAccuracyInputs), 4);
      const verification = JSON.parse(scalar(url,
        "select public.verify_repository_task_planner_contract()"));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(scalar(url, `
        select count(*) from pg_class where relname in(
          'repository_task_plans','repository_task_execution_phases',
          'repository_task_planning_diagnostics','repository_task_plan_cache',
          'repository_task_planner_metrics',
          'repository_task_planner_retention'
        ) and relrowsecurity
      `), "6");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_task_plans','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'service_role','public.repository_task_plans','select')
      `), "t");
      psql(url, `
        update public.repositories set current_revision=null,
          indexed_revision=null where repository_id='acme/widgets'
      `);
      assert.throws(() => psql(url, `
        select public.save_repository_task_plan(
          ${json({ ...expected, task: {
            ...expected.task, taskId: "revision-stale",
          } })},null)
      `), /repository_task_revision_or_ownership_invalid/);
      psql(url, `
        update public.repositories set current_revision='${revision}',
          indexed_revision='${revision}' where repository_id='acme/widgets'
      `);
      const interrupted = plan("planning", "interrupted-task");
      interrupted.task.userRequest = "Interrupted task";
      interrupted.task.normalizedObjective = "interrupted task";
      psql(url, `select public.save_repository_task_plan(
        ${json(interrupted)},null)`);
      assert.equal(scalar(url,
        "select public.recover_repository_task_plans()"), "1");
      assert.equal(scalar(url, `
        select lifecycle from public.repository_task_plans
        where task_id='interrupted-task'
      `), "failed");
      assert.equal(scalar(url, `
        select public.collect_repository_task_plans('tenant-1',1)
      `), "0");
    });
  });
