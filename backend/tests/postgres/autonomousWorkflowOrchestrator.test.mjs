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
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const revision = "b".repeat(40);
const timestamp = "2099-08-18T00:00:00.000Z";
const workflowId = `autonomous_workflow_${"1".repeat(24)}`;
const stages = [
  "intelligence", "planning", "execution", "agent_runtime",
  "tool_invocation", "collaboration", "workspace", "patch", "artifact",
  "review", "proposal", "apply", "knowledge",
];
const retryCounts = Object.fromEntries(stages.map((stage) => [stage, 0]));

function version(workflowVersion, lifecycle, currentStage, reason) {
  return {
    workflowId,
    workflowVersion,
    lifecycle,
    currentStage,
    checkpointCount: currentStage === "planning" ? 1 : 0,
    retryCount: 0,
    failureCount: 0,
    recoveryCount: 0,
    reason,
    stateHash: String(workflowVersion).repeat(64).slice(0, 64),
    createdAt: timestamp,
  };
}

function state(overrides = {}) {
  return {
    workflowId,
    schemaVersion: "autonomous-workflow-schema-v1",
    persistenceVersion: 1,
    tenantId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    executionId: "execution-workflow-1",
    ownerId: "user-1",
    workflowVersion: 1,
    lifecycle: "created",
    currentStage: "intelligence",
    checkpoints: [],
    approvals: [],
    diagnostics: [],
    lifecycleHistory: [],
    attemptHistory: [],
    recoveryHistory: [],
    versions: [version(1, "created", "intelligence", "workflow_created")],
    retryCounts,
    failureCount: 0,
    recoveryCount: 0,
    resumeCount: 0,
    inFlight: null,
    archiveMetadata: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    ...overrides,
  };
}

test("PostgreSQL workflow persistence enforces CAS, immutable checkpoints, recovery, metrics, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set status='indexed',
          current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);

      const created = state();
      const saved = JSON.parse(scalar(url, `
        select workflow from public.save_autonomous_workflow(
          ${json(created)},null
        )
      `));
      assert.equal(saved.workflowId, workflowId);
      assert.equal(scalar(url,
        "select count(*) from public.autonomous_workflow_versions"), "1");
      assert.equal(scalar(url, `
        select active_count from public.count_active_autonomous_workflows(
          'user-1','user-1'
        )
      `), "1");

      const attempt = {
        attemptId: `workflow_attempt_${"2".repeat(24)}`,
        stage: "intelligence",
        requestHash: "3".repeat(64),
        attempt: 1,
        startedAt: timestamp,
        leaseExpiresAt: "2099-08-18T00:00:01.000Z",
      };
      const startedAttemptEvent = {
        eventId: `workflow_attempt_event_${"6".repeat(24)}`,
        workflowId,
        workflowVersion: 2,
        attemptId: attempt.attemptId,
        stage: "intelligence",
        requestHash: attempt.requestHash,
        attempt: 1,
        event: "started",
        createdAt: timestamp,
      };
      const analysing = state({
        persistenceVersion: 2,
        workflowVersion: 2,
        lifecycle: "analysing",
        inFlight: attempt,
        attemptHistory: [startedAttemptEvent],
        versions: [
          created.versions[0],
          version(2, "analysing", "intelligence", "stage_started"),
        ],
      });
      scalar(url, `
        select workflow from public.save_autonomous_workflow(
          ${json(analysing)},'1'
        )
      `);
      assert.equal(scalar(url, `
        select jsonb_array_length(workflows)
        from public.list_recoverable_autonomous_workflows(
          '2099-08-18T00:00:02.000Z'::timestamptz
        )
      `), "1");

      const checkpoint = {
        checkpointId: `workflow_checkpoint_${"4".repeat(24)}`,
        workflowId,
        sequence: 1,
        stage: "intelligence",
        requestHash: attempt.requestHash,
        result: {
          stage: "intelligence",
          referenceId: "acme/widgets",
          referenceVersion: revision,
          status: "published",
          outputHash: "5".repeat(64),
          metadata: {},
        },
        startedAt: timestamp,
        completedAt: "2099-08-18T00:00:01.000Z",
        durationMs: 1000,
      };
      const succeededAttemptEvent = {
        ...startedAttemptEvent,
        eventId: `workflow_attempt_event_${"7".repeat(24)}`,
        workflowVersion: 3,
        event: "succeeded",
        createdAt: checkpoint.completedAt,
      };
      const planning = state({
        persistenceVersion: 3,
        workflowVersion: 3,
        lifecycle: "planning",
        currentStage: "planning",
        checkpoints: [checkpoint],
        attemptHistory: [startedAttemptEvent, succeededAttemptEvent],
        inFlight: null,
        updatedAt: checkpoint.completedAt,
        versions: [
          created.versions[0],
          analysing.versions[1],
          version(3, "planning", "planning", "stage_completed"),
        ],
      });
      scalar(url, `
        select workflow from public.save_autonomous_workflow(
          ${json(planning)},'2'
        )
      `);
      assert.equal(scalar(url,
        "select count(*) from public.autonomous_workflow_checkpoints"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.autonomous_workflow_attempt_events"), "2");
      assert.equal(scalar(url, `
        select reference_id from public.autonomous_workflow_checkpoints
        where workflow_id='${workflowId}'
      `), "acme/widgets");

      const stale = psql(url, `
        select workflow from public.save_autonomous_workflow(
          ${json({ ...planning, persistenceVersion: 4 })},'2'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /autonomous_workflow_version_conflict/);

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.autonomous_workflow_metrics('user-1')
      `));
      assert.equal(metrics.activeWorkflows, 1);
      assert.equal(metrics.stageDurationsMs.intelligence, 1000);
      assert.equal(metrics.retries, 0);
      assert.equal(scalar(url, `
        select valid from public.verify_autonomous_workflow_contract(
          'autonomous-workflow-orchestrator-v1',
          'autonomous-workflow-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.autonomous_workflows'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.autonomous_workflows','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_autonomous_workflow(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count from public.collect_autonomous_workflows(
          'user-1',1,100,20
        )
      `), "0");
    });
  });
