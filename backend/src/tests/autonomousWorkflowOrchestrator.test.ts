import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  AutonomousWorkflowError,
  AutonomousWorkflowOrchestrator,
  DEFAULT_WORKFLOW_QUOTAS,
  MemoryAutonomousWorkflowStore,
  PostgresAutonomousWorkflowStore,
  WORKFLOW_STAGES,
  workflowIdentity,
  type AutonomousWorkflow,
  type CreateWorkflowInput,
  type WorkflowDependencyRecovery,
  type WorkflowQuotas,
  type WorkflowServiceComposition,
  type WorkflowStage,
} from "../services/autonomousWorkflow/index.js";
import { stableHash } from "../services/repositoryExecution/determinism.js";

const now = new Date("2099-08-18T00:00:00.000Z");
const revision = "b".repeat(40);
const quotas: WorkflowQuotas = {
  ...DEFAULT_WORKFLOW_QUOTAS,
  activePerOwner: 5,
  retriesPerStage: 1,
  resumesPerWorkflow: 2,
  diagnosticsPerWorkflow: 20,
  requestBytes: 10_000,
  stageLeaseMs: 1_000,
  workflowDurationMs: 100_000,
  retainedWorkflows: 1,
  retainedVersions: 100,
  retainedDiagnostics: 20,
};

const createInput = (
  overrides: Partial<CreateWorkflowInput> = {},
): CreateWorkflowInput => ({
  tenantId: "user-1",
  repositoryId: "acme/widgets",
  repositoryRevision: revision,
  executionId: "execution-workflow-1",
  ownerId: "user-1",
  repositoryOwnerId: "user-1",
  idempotencyKey: "workflow-create-1",
  ...overrides,
});

const emptyRecovery = (): WorkflowDependencyRecovery => ({
  intelligence: 0,
  planning: 0,
  execution: 0,
  agentRuntime: 0,
  toolInvocation: 0,
  collaboration: 0,
  workspace: 0,
  artifact: 0,
  review: 0,
  proposal: 0,
  apply: 0,
  knowledge: 0,
});

class FakeComposition implements WorkflowServiceComposition {
  readonly calls: WorkflowStage[] = [];
  approvals = 0;
  cancellations = 0;
  failures = new Map<WorkflowStage, number>();

  async execute(stage: WorkflowStage, payload: unknown) {
    this.calls.push(stage);
    const remaining = this.failures.get(stage) ?? 0;
    if (remaining > 0) {
      this.failures.set(stage, remaining - 1);
      throw new AutonomousWorkflowError(
        `existing_${stage}_rejected`, `${stage} rejected.`);
    }
    const output = { stage, payload, durable: true };
    return {
      result: {
        stage,
        referenceId: stage === "execution"
          ? "execution-workflow-1" : `${stage}-reference`,
        referenceVersion: `${stage}-v1`,
        status: stage === "knowledge" ? "active" : "validated",
        outputHash: stableHash(output),
        metadata: {},
      },
      output,
    };
  }

  async approve() {
    this.approvals += 1;
  }

  async cancel() {
    this.cancellations += 1;
  }

  async recoverDependencies() {
    return emptyRecovery();
  }
}

const logger = {
  info() {}, warn() {}, error() {}, debug() {}, async flush() {},
};

async function completeWorkflow(
  engine: AutonomousWorkflowOrchestrator,
  initial: AutonomousWorkflow,
): Promise<AutonomousWorkflow> {
  let workflow = initial;
  while (workflow.currentStage) {
    const stage = workflow.currentStage;
    if (workflow.lifecycle === "awaiting_approval") {
      workflow = await engine.approve({
        tenantId: workflow.tenantId,
        workflowId: workflow.workflowId,
        ownerId: workflow.ownerId,
        expectedWorkflowVersion: workflow.workflowVersion,
        idempotencyKey: "approve-execution",
        executionApproval: { decision: "approved", input: {} },
      });
      continue;
    }
    const advanced = await engine.advance({
      tenantId: workflow.tenantId,
      workflowId: workflow.workflowId,
      ownerId: workflow.ownerId,
      expectedWorkflowVersion: workflow.workflowVersion,
      request: { stage, payload: { stage, immutable: true } },
    });
    workflow = advanced.workflow;
  }
  return workflow;
}

test("workflow identity and complete orchestration are deterministic", async () => {
  const run = async () => {
    const composition = new FakeComposition();
    const store = new MemoryAutonomousWorkflowStore();
    const engine = new AutonomousWorkflowOrchestrator(
      store, composition, quotas, logger, () => now);
    const created = await store.create(createInput(), quotas, now);
    const completed = await completeWorkflow(engine, created);
    return { completed, calls: composition.calls };
  };
  const left = await run();
  const right = await run();
  assert.deepEqual(left, right);
  assert.equal(left.completed.workflowId, workflowIdentity(createInput()));
  assert.equal(left.completed.lifecycle, "completed");
  assert.equal(left.completed.checkpoints.length, WORKFLOW_STAGES.length);
  assert.deepEqual(left.calls, WORKFLOW_STAGES);
  assert.ok(Object.isFrozen(left.completed));
});

test("stage transitions and approvals fail closed", async () => {
  const store = new MemoryAutonomousWorkflowStore();
  const composition = new FakeComposition();
  const engine = new AutonomousWorkflowOrchestrator(
    store, composition, quotas, logger, () => now);
  const created = await store.create(createInput(), quotas, now);
  await assert.rejects(() => engine.advance({
    tenantId: created.tenantId,
    workflowId: created.workflowId,
    ownerId: created.ownerId,
    expectedWorkflowVersion: created.workflowVersion,
    request: { stage: "planning", payload: {} },
  }), (error: unknown) =>
    error instanceof AutonomousWorkflowError &&
    error.code === "autonomous_workflow_illegal_transition");
  let workflow = created;
  for (const stage of ["intelligence", "planning", "execution"] as const) {
    workflow = (await engine.advance({
      tenantId: workflow.tenantId,
      workflowId: workflow.workflowId,
      ownerId: workflow.ownerId,
      expectedWorkflowVersion: workflow.workflowVersion,
      request: { stage, payload: { stage } },
    })).workflow;
  }
  assert.equal(workflow.lifecycle, "awaiting_approval");
  await assert.rejects(() => engine.advance({
    tenantId: workflow.tenantId,
    workflowId: workflow.workflowId,
    ownerId: workflow.ownerId,
    expectedWorkflowVersion: workflow.workflowVersion,
    request: { stage: "agent_runtime", payload: {} },
  }), /approval is required/i);
  workflow = await engine.approve({
    tenantId: workflow.tenantId,
    workflowId: workflow.workflowId,
    ownerId: workflow.ownerId,
    expectedWorkflowVersion: workflow.workflowVersion,
    idempotencyKey: "approval-1",
    executionApproval: { decision: "approved", input: {} },
  });
  assert.equal(workflow.lifecycle, "executing");
  assert.equal(composition.approvals, 1);
});

test("retries preserve the last committed checkpoint and exhaustion can resume",
  async () => {
    const store = new MemoryAutonomousWorkflowStore();
    const composition = new FakeComposition();
    composition.failures.set("intelligence", 2);
    const engine = new AutonomousWorkflowOrchestrator(
      store, composition, quotas, logger, () => now);
    let workflow = await store.create(createInput(), quotas, now);
    for (let _attempt = 0; _attempt < 2; _attempt += 1) {
      await assert.rejects(() => engine.advance({
        tenantId: workflow.tenantId,
        workflowId: workflow.workflowId,
        ownerId: workflow.ownerId,
        expectedWorkflowVersion: workflow.workflowVersion,
        request: { stage: "intelligence", payload: { stableAttempt: true } },
      }), (error: unknown) =>
        error instanceof AutonomousWorkflowError &&
        error.code === "autonomous_workflow_stage_failed");
      workflow = (await store.get(
        workflow.tenantId, workflow.workflowId, workflow.ownerId))!;
    }
    assert.equal(workflow.lifecycle, "failed");
    assert.equal(workflow.checkpoints.length, 0);
    assert.equal(workflow.retryCounts.intelligence, 2);
    assert.equal(workflow.diagnostics.length, 2);
    workflow = await engine.resume({
      tenantId: workflow.tenantId,
      workflowId: workflow.workflowId,
      ownerId: workflow.ownerId,
      expectedWorkflowVersion: workflow.workflowVersion,
    });
    assert.equal(workflow.lifecycle, "analysing");
    const advanced = await engine.advance({
      tenantId: workflow.tenantId,
      workflowId: workflow.workflowId,
      ownerId: workflow.ownerId,
      expectedWorkflowVersion: workflow.workflowVersion,
      request: { stage: "intelligence", payload: { stableAttempt: true } },
    });
    assert.equal(advanced.workflow.checkpoints.length, 1);
    assert.equal(advanced.workflow.currentStage, "planning");
  });

test("expired in-flight stages recover and resume from the same stage", async () => {
  const store = new MemoryAutonomousWorkflowStore();
  const created = await store.create(createInput(), quotas, now);
  const begun = await store.beginStage({
    tenantId: created.tenantId,
    workflowId: created.workflowId,
    ownerId: created.ownerId,
    expectedWorkflowVersion: created.workflowVersion,
    request: { stage: "intelligence", payload: { immutable: true } },
  }, quotas, now);
  assert.ok(begun.inFlight);
  assert.equal(await store.recover(
    new Date(now.getTime() + 2_000), quotas), 1);
  const recovered = (await store.get(
    begun.tenantId, begun.workflowId, begun.ownerId))!;
  assert.equal(recovered.currentStage, "intelligence");
  assert.equal(recovered.lifecycle, "analysing");
  assert.equal(recovered.inFlight, null);
  assert.equal(recovered.recoveryHistory.length, 1);
  assert.equal(recovered.recoveryHistory[0]?.resumedFromCheckpoint, 0);
});

test("cancellation composes execution cancellation and is terminal", async () => {
  const store = new MemoryAutonomousWorkflowStore();
  const composition = new FakeComposition();
  const engine = new AutonomousWorkflowOrchestrator(
    store, composition, quotas, logger, () => now);
  const created = await store.create(createInput(), quotas, now);
  const cancelled = await engine.cancel({
    tenantId: created.tenantId,
    workflowId: created.workflowId,
    ownerId: created.ownerId,
    expectedWorkflowVersion: created.workflowVersion,
    idempotencyKey: "cancel-1",
  });
  assert.equal(cancelled.lifecycle, "cancelled");
  assert.equal(cancelled.currentStage, null);
  assert.equal(composition.cancellations, 1);
  await assert.rejects(() => engine.advance({
    tenantId: cancelled.tenantId,
    workflowId: cancelled.workflowId,
    ownerId: cancelled.ownerId,
    expectedWorkflowVersion: cancelled.workflowVersion,
    request: { stage: "intelligence", payload: {} },
  }), /Terminal workflows/);
});

test("PostgreSQL adapter matches memory workflow creation and CAS shape",
  async () => {
    let state: AutonomousWorkflow | null = null;
    const client = {
      rpc(name: string, parameters: Record<string, unknown> = {}) {
        let data: unknown;
        if (name === "get_autonomous_workflow") {
          data = state ? [{ workflow: structuredClone(state) }] : [];
        } else if (name === "count_active_autonomous_workflows") {
          data = [{ active_count: state ? 1 : 0 }];
        } else if (name === "save_autonomous_workflow") {
          state = structuredClone(
            parameters.input_workflow as AutonomousWorkflow);
          data = [{ workflow: structuredClone(state) }];
        } else if (name === "verify_autonomous_workflow_contract") {
          data = [{ valid: true, problems: [] }];
        } else data = [];
        return Promise.resolve({ data, error: null });
      },
    };
    const expected = await new MemoryAutonomousWorkflowStore()
      .create(createInput(), quotas, now);
    const postgres = new PostgresAutonomousWorkflowStore(client);
    const actual = await postgres.create(createInput(), quotas, now);
    assert.deepEqual(actual, expected);
    const memory = new MemoryAutonomousWorkflowStore();
    memory.hydrate(expected);
    const advance = {
      tenantId: expected.tenantId,
      workflowId: expected.workflowId,
      ownerId: expected.ownerId,
      expectedWorkflowVersion: expected.workflowVersion,
      request: { stage: "intelligence" as const, payload: { stable: true } },
    };
    assert.deepEqual(
      await postgres.beginStage(advance, quotas, now),
      await memory.beginStage(advance, quotas, now));
    await assert.doesNotReject(() => postgres.verify());
  });

test("metrics, startup, migration, retention, and composition safety contracts are complete",
  async () => {
    const store = new MemoryAutonomousWorkflowStore();
    const composition = new FakeComposition();
    const engine = new AutonomousWorkflowOrchestrator(
      store, composition, quotas, logger, () => now);
    const created = await store.create(createInput(), quotas, now);
    await engine.cancel({
      tenantId: created.tenantId,
      workflowId: created.workflowId,
      ownerId: created.ownerId,
      expectedWorkflowVersion: created.workflowVersion,
      idempotencyKey: "cancel-metrics",
    });
    const metrics = await engine.metrics();
    assert.equal(metrics.activeWorkflows, 0);
    const registry = new MetricsRegistry({
      processStartTimeSeconds: 0, uptimeSeconds: () => 1,
    });
    registry.recordAutonomousWorkflows(metrics);
    for (const metric of [
      "giro_autonomous_workflow_active",
      "giro_autonomous_workflow_stage_duration_ms_total",
      "giro_autonomous_workflow_retries_total",
      "giro_autonomous_workflow_failures_total",
      "giro_autonomous_workflow_recoveries_total",
      "giro_autonomous_workflow_completion_latency_ms_total",
    ]) assert.match(registry.render(), new RegExp(metric));
    await assert.doesNotReject(() => store.verify(quotas));
    assert.equal(await store.collect("user-1", quotas), 0);

    const [migration, startup, compositionSource] = await Promise.all([
      readFile(new URL(
        "../../supabase/migrations/20260818000000_add_autonomous_workflow_orchestrator.sql",
        import.meta.url), "utf8"),
      readFile(new URL("../index.ts", import.meta.url), "utf8"),
      readFile(new URL(
        "../services/autonomousWorkflow/composition.ts", import.meta.url),
      "utf8"),
    ]);
    for (const table of [
      "autonomous_workflows", "autonomous_workflow_versions",
      "autonomous_workflow_checkpoints", "autonomous_workflow_approvals",
      "autonomous_workflow_diagnostics",
      "autonomous_workflow_lifecycle_events",
      "autonomous_workflow_attempt_events",
      "autonomous_workflow_recoveries", "autonomous_workflow_archives",
      "autonomous_workflow_retention",
    ]) assert.match(migration,
      new RegExp(`create table if not exists public\\.${table}`));
    for (const contract of [
      "foreign key", "create index", "check\\(",
      "enable row level security", "grant execute",
      "verify_autonomous_workflow_contract",
      "collect_autonomous_workflows",
    ]) assert.match(migration.toLowerCase(), new RegExp(contract));
    assert.ok(
      startup.indexOf("runtimeAutonomousWorkflowOrchestrator.verify") <
      startup.indexOf("server = serve"));
    for (const service of [
      "runtimeRepositoryIntelligenceService",
      "runtimeRepositoryPlanningService",
      "runtimeRepositoryExecutionOrchestrator",
      "runtimeAgentRuntimeScheduler",
      "runtimeToolInvocationService",
      "runtimeMultiAgentCollaborationEngine",
      "runtimeRepositoryWorkspacePatchEngine",
      "runtimeRepositoryArtifactEngine",
      "runtimeRepositoryReviewEngine",
      "runtimeRepositoryProposalEngine",
      "runtimeRepositoryApplyEngine",
      "runtimeRepositoryKnowledgeEngine",
    ]) assert.match(compositionSource, new RegExp(service));
    for (const forbidden of [
      "node:fs", "child_process", "simple-git", "exec(", "spawn(",
      "writeFile", "fetch(", "axios", "createCommit", "createBranch",
    ]) assert.doesNotMatch(compositionSource,
      new RegExp(forbidden.replace("(", "\\(")));
  });
