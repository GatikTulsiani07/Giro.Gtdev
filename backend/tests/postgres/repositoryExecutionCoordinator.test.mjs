import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations, createJobSql, postgresAvailability, psql, scalar,
  seedRepositorySql, withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const timestamp = "2099-08-29T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function execution(status = "completed", executionId = "execution-1") {
  const stages = [
    "query", "task planning", "specification generation",
    "impact verification", "review preparation", "execution readiness",
    "completion",
  ];
  const stageHistory = status === "completed"
    ? stages.map((stage, position) => ({
      transitionId: `transition-${position}`, position,
      fromStage: position === 0 ? null : stages[position - 1],
      stage, outcome: "completed", referenceId: `reference-${position}`,
      startedAt: timestamp, completedAt: timestamp, durationMs: position + 1,
    })) : [];
  const readiness = status === "completed" ? {
    reportId: "readiness-1", status: "ready",
    checks: [{
      name: "ownership", passed: true, evidence: ["user-1"],
    }], createdAt: timestamp,
  } : null;
  const phases = [
    "preparation", "implementation", "verification", "testing", "review",
    "rollout", "post-deployment validation",
  ].map((kind, position) => ({
    phaseId: `phase-${position}`, position, kind, title: kind,
    objective: `Complete ${kind}.`, actions: [`Validate ${kind}.`],
    evidenceReferences: ["intelligence-target"],
    dependsOn: position === 0 ? [] : [`phase-${position - 1}`],
  }));
  const risk = (summary) => ({
    score: 20, level: "low", summary, evidence: [],
  });
  return {
    execution: {
      executionId,
      schemaVersion: "repository-execution-coordinator-schema-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      taskId: "task-1", specificationId: "specification-1",
      workflowId: "workflow-1", objective: "Fix payment authentication",
      ownershipFingerprint: "ownership-1", status,
      createdAt: timestamp, updatedAt: timestamp,
      completedAt: status === "completed" ? timestamp : null,
    },
    stageHistory,
    readiness,
    summary: status === "completed" ? {
      repository: {
        repositoryId: "acme/widgets", revision,
      },
      affectedFeatures: ["payments"], affectedModules: ["payment-api"],
      implementationPhases: phases,
      risks: {
        architectural: risk("Architectural risk."),
        dependency: risk("Dependency risk."),
        regression: risk("Regression risk."),
        rollout: risk("Rollout risk."),
      },
      validationChecklist: ["Verify authentication."],
      testingStrategy: {
        unitTestingPlan: ["Run unit tests."],
        integrationTestingPlan: ["Run integration tests."],
        regressionTestingPlan: ["Run regression tests."],
        validationSteps: ["Validate results."],
      },
      readinessStatus: "ready",
    } : null,
    diagnostics: [], cacheHit: false, orchestrationLatencyMs: 12,
    recoveryCount: 0,
  };
}

function seedLineage(url) {
  psql(url, seedRepositorySql("acme/widgets"));
  const jobId = scalar(url, createJobSql("acme/widgets"));
  const task = {
    task: {
      taskId: "task-1", schemaVersion: "repository-task-plan-schema-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      lifecycle: "published",
    },
  };
  const specification = {
    specification: {
      specificationId: "specification-1",
      schemaVersion: "repository-engineering-specification-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      taskId: "task-1", workflowId: "workflow-1",
      ownershipFingerprint: "ownership-1", lifecycle: "published",
    },
  };
  psql(url, `
    insert into public.repository_snapshots(
      repository_id,revision,commit_sha,job_id,status,indexed_at
    ) values(
      'acme/widgets','${revision}','${revision}','${jobId}',
      'published','${timestamp}'
    );
    update public.repositories set status='indexed',
      current_revision='${revision}',indexed_revision='${revision}'
    where repository_id='acme/widgets';
    insert into public.autonomous_workflows(
      tenant_id,workflow_id,schema_version,repository_id,
      repository_revision,execution_id,owner_id,workflow_version,
      lifecycle,current_stage,state,created_at,updated_at
    ) values(
      'tenant-1','workflow-1','autonomous-workflow-schema-v1',
      'acme/widgets','${revision}','workflow-execution-1','user-1',1,
      'planning',null,'{}','${timestamp}','${timestamp}'
    );
    insert into public.repository_task_plans(
      tenant_id,task_id,owner_id,repository_id,repository_revision,
      schema_version,persistence_version,category,confidence,lifecycle,
      source_versions,orchestration_latency_ms,accuracy_input_count,
      recovery_count,plan,created_at,updated_at,completed_at
    ) values(
      'tenant-1','task-1','user-1','acme/widgets','${revision}',
      'repository-task-plan-schema-v1',1,'bug fix',0.8,'published',
      '{}',0,0,0,${json(task)},'${timestamp}','${timestamp}','${timestamp}'
    );
    insert into public.repository_engineering_specifications(
      tenant_id,specification_id,owner_id,repository_id,
      repository_revision,task_id,workflow_id,schema_version,
      persistence_version,specification_type,confidence,
      ownership_fingerprint,lifecycle,source_versions,
      orchestration_latency_ms,recovery_count,specification,
      created_at,updated_at,completed_at
    ) values(
      'tenant-1','specification-1','user-1','acme/widgets','${revision}',
      'task-1','workflow-1','repository-engineering-specification-v1',
      1,'bug-fix',0.8,'ownership-1','published','{}',0,0,
      ${json(specification)},'${timestamp}','${timestamp}','${timestamp}'
    );
  `);
}

test("PostgreSQL execution coordinator matches memory serialization and enforces lifecycle durability",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seedLineage(url);
      const expected = execution();
      const saved = JSON.parse(scalar(url, `
        select execution from public.save_repository_coordinated_execution(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.deepEqual(JSON.parse(scalar(url, `
        select execution from public.get_repository_coordinated_execution(
          'tenant-1','user-1','execution-1')
      `)), expected);
      assert.equal(scalar(url, `
        select count(*) from public.get_repository_coordinated_execution(
          'tenant-1','other','execution-1')
      `), "0");
      assert.equal(scalar(url,
        "select count(*) from public.repository_execution_stage_history"),
      "7");
      assert.equal(scalar(url, `
        select count(*) from public.repository_execution_readiness_reports
      `), "1");
      psql(url, `
        select public.record_repository_execution_coordination_cache_hit(
          'tenant-1','user-1','execution-1')
      `);
      const metrics = JSON.parse(scalar(url, `
        select public.repository_execution_coordinator_metrics('tenant-1')
      `));
      assert.equal(Number(metrics.executions), 1);
      assert.equal(Number(metrics.cacheHits), 1);
      assert.equal(Number(metrics.averageOrchestrationLatencyMs), 12);
      assert.equal(Number(metrics.stageDurations.query), 1);
      assert.equal(Number(metrics.readinessOutcomes.ready), 1);
      const verification = JSON.parse(scalar(url,
        "select public.verify_repository_execution_coordinator_contract()"));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(verification.registered, true);
      assert.equal(scalar(url, `
        select count(*) from pg_class where relname in(
          'repository_coordinated_executions',
          'repository_execution_stage_history',
          'repository_execution_readiness_reports',
          'repository_execution_coordinator_diagnostics',
          'repository_execution_coordinator_cache',
          'repository_execution_coordinator_metrics',
          'repository_execution_coordinator_retention'
        ) and relrowsecurity
      `), "7");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_coordinated_executions','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'service_role','public.repository_coordinated_executions','select')
      `), "t");
      psql(url, `
        update public.repositories set current_revision=null,
          indexed_revision=null where repository_id='acme/widgets'
      `);
      assert.throws(() => psql(url, `
        select public.save_repository_coordinated_execution(
          ${json({ ...expected, execution: {
            ...expected.execution, executionId: "stale",
          } })},null)
      `), /repository_execution_revision_or_ownership_invalid/);
      psql(url, `
        update public.repositories set current_revision='${revision}',
          indexed_revision='${revision}' where repository_id='acme/widgets'
      `);
      const interrupted = execution("coordinating", "interrupted");
      psql(url, `
        select public.save_repository_coordinated_execution(
          ${json(interrupted)},null)
      `);
      assert.equal(scalar(url,
        "select public.recover_repository_coordinated_executions()"), "1");
      assert.equal(scalar(url, `
        select status from public.repository_coordinated_executions
        where execution_id='interrupted'
      `), "failed");
      assert.equal(scalar(url, `
        select public.collect_repository_coordinated_executions('tenant-1',1)
      `), "0");
    });
  });
