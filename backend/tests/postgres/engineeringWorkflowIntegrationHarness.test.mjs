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
const stages = [
  "intelligence", "planning", "execution", "agent_runtime",
  "tool_invocation", "collaboration", "workspace", "patch", "artifact",
  "review", "proposal", "apply", "knowledge",
];
const revision = "d".repeat(40);
const timestamp = "2099-08-19T00:00:00.000Z";
const workflowId = `autonomous_workflow_${"8".repeat(24)}`;
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function completedWorkflow() {
  const checkpoints = stages.map((stage, index) => ({
    checkpointId: `workflow_checkpoint_${
      String(index + 1).padStart(24, "0")}`,
    workflowId,
    sequence: index + 1,
    stage,
    requestHash: String(index + 1).repeat(64).slice(0, 64),
    result: {
      stage,
      referenceId: stage === "execution"
        ? "execution-integration-1"
        : `${stage}_integration_reference`,
      referenceVersion: `${stage}-v1`,
      status: stage === "knowledge" ? "active" : "validated",
      outputHash: String(index + 2).repeat(64).slice(0, 64),
      metadata: {
        repositoryId: "acme/integration",
        repositoryRevision: revision,
        executionId: "execution-integration-1",
        ownerId: "tenant-1",
      },
    },
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: index + 1,
  }));
  const retryCounts = Object.fromEntries(stages.map((stage) => [stage, 0]));
  return {
    workflowId,
    schemaVersion: "autonomous-workflow-schema-v1",
    persistenceVersion: 1,
    tenantId: "tenant-1",
    repositoryId: "acme/integration",
    repositoryRevision: revision,
    executionId: "execution-integration-1",
    ownerId: "tenant-1",
    workflowVersion: 27,
    lifecycle: "completed",
    currentStage: null,
    checkpoints,
    approvals: [],
    diagnostics: [],
    lifecycleHistory: [],
    attemptHistory: [],
    recoveryHistory: [],
    versions: Array.from({ length: 27 }, (_, index) => ({
      workflowId,
      workflowVersion: index + 1,
      lifecycle: index === 26 ? "completed" : "executing",
      currentStage: index === 26 ? null : stages[
        Math.min(Math.floor(index / 2), stages.length - 1)],
      checkpointCount: Math.min(Math.floor(index / 2), stages.length),
      retryCount: 0,
      failureCount: 0,
      recoveryCount: 0,
      reason: index === 26 ? "workflow_completed" : "stage_progress",
      stateHash: (index + 1).toString(16).repeat(64).slice(0, 64),
      createdAt: timestamp,
    })),
    retryCounts,
    failureCount: 0,
    recoveryCount: 0,
    resumeCount: 0,
    inFlight: null,
    archiveMetadata: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  };
}

test("PostgreSQL preserves the complete harness checkpoint contract and ordering",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/integration", "tenant-1"));
      psql(url, `
        update public.repositories set status='indexed',
          current_revision='${revision}', indexed_revision='${revision}'
        where repository_id='acme/integration'
      `);
      const state = completedWorkflow();
      const saved = JSON.parse(scalar(url, `
        select workflow from public.save_autonomous_workflow(
          ${json(state)}, null
        )
      `));
      assert.equal(saved.lifecycle, "completed");
      assert.deepEqual(
        saved.checkpoints.map(({ stage }) => stage), stages);
      assert.equal(scalar(url, `
        select count(*) from public.autonomous_workflow_checkpoints
        where workflow_id='${workflowId}'
      `), String(stages.length));
      assert.deepEqual(JSON.parse(scalar(url, `
        select jsonb_agg(stage order by sequence)
        from public.autonomous_workflow_checkpoints
        where workflow_id='${workflowId}'
      `)), stages);
      const metrics = JSON.parse(scalar(url, `
        select metrics from public.autonomous_workflow_metrics('tenant-1')
      `));
      assert.equal(metrics.activeWorkflows, 0);
      assert.equal(metrics.stageDurationsMs.knowledge, stages.length);
      assert.equal(scalar(url, `
        select (
          select workflow from public.get_autonomous_workflow(
            'other-tenant','${workflowId}'
          )
        ) is null
      `), "t");
      assert.equal(scalar(url, `
        select valid from public.verify_autonomous_workflow_contract(
          'autonomous-workflow-orchestrator-v1',
          'autonomous-workflow-schema-v1'
        )
      `), "t");
    });
  });
