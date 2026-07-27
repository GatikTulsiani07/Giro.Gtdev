import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  AdvanceWorkflowInput,
  ApproveWorkflowInput,
  AutonomousWorkflow,
  CancelWorkflowInput,
  CreateWorkflowInput,
  ResumeWorkflowInput,
  WorkflowCheckpoint,
  WorkflowDiagnostic,
  WorkflowInFlightAttempt,
  WorkflowLifecycle,
  WorkflowLifecycleEvent,
  WorkflowMetrics,
  WorkflowQuotas,
  WorkflowRecoveryRecord,
  WorkflowStage,
  WorkflowStageResult,
  WorkflowAttemptEvent,
  WorkflowVersionRecord,
} from "./types.js";
import {
  AUTONOMOUS_WORKFLOW_ENGINE_VERSION,
  AUTONOMOUS_WORKFLOW_SCHEMA_VERSION,
  AutonomousWorkflowError,
  WORKFLOW_STAGES,
} from "./types.js";
import {
  STAGE_LIFECYCLE,
  emptyRetryCounts,
  isTerminalWorkflow,
  lifecycleAfterStage,
  nextStage,
  validateCreateWorkflow,
  validateStageRequest,
  validateWorkflowIntegrity,
  workflowIdentity,
} from "./validation.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
const clone = <T>(value: T): T => deepFreeze(structuredClone(value));

export interface AutonomousWorkflowStore {
  create(
    input: CreateWorkflowInput,
    quotas: WorkflowQuotas,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  get(
    tenantId: string,
    workflowId: string,
    ownerId: string,
  ): Promise<AutonomousWorkflow | null>;
  beginStage(
    input: AdvanceWorkflowInput,
    quotas: WorkflowQuotas,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  completeStage(
    tenantId: string,
    workflowId: string,
    ownerId: string,
    expectedWorkflowVersion: number,
    result: WorkflowStageResult,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  failStage(
    tenantId: string,
    workflowId: string,
    ownerId: string,
    expectedWorkflowVersion: number,
    code: string,
    message: string,
    quotas: WorkflowQuotas,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  approve(
    input: ApproveWorkflowInput,
    executionReferenceId: string,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  cancel(
    input: CancelWorkflowInput,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  resume(
    input: ResumeWorkflowInput,
    quotas: WorkflowQuotas,
    now?: Date,
  ): Promise<AutonomousWorkflow>;
  recover(now?: Date, quotas?: WorkflowQuotas): Promise<number>;
  collect(tenantId: string, quotas: WorkflowQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<WorkflowMetrics>;
  verify(quotas?: WorkflowQuotas): Promise<void>;
}

function lifecycleEvent(
  workflow: Pick<AutonomousWorkflow, "workflowId" | "workflowVersion">,
  from: WorkflowLifecycle | null,
  to: WorkflowLifecycle,
  stage: WorkflowStage | null,
  reason: string,
  createdAt: string,
): WorkflowLifecycleEvent {
  return {
    eventId: stableId("workflow_lifecycle", {
      workflowId: workflow.workflowId,
      workflowVersion: workflow.workflowVersion,
      from, to, stage, reason,
    }),
    workflowVersion: workflow.workflowVersion,
    from, to, stage, reason, createdAt,
  };
}

function attemptEvent(
  workflowId: string,
  workflowVersion: number,
  attempt: WorkflowInFlightAttempt,
  event: WorkflowAttemptEvent["event"],
  createdAt: string,
): WorkflowAttemptEvent {
  return {
    eventId: stableId("workflow_attempt_event", {
      workflowId, workflowVersion, attemptId: attempt.attemptId, event,
    }),
    workflowId,
    workflowVersion,
    attemptId: attempt.attemptId,
    stage: attempt.stage,
    requestHash: attempt.requestHash,
    attempt: attempt.attempt,
    event,
    createdAt,
  };
}

function stateHash(workflow: Omit<AutonomousWorkflow, "versions">): string {
  return stableHash({
    workflowId: workflow.workflowId,
    workflowVersion: workflow.workflowVersion,
    lifecycle: workflow.lifecycle,
    currentStage: workflow.currentStage,
    checkpoints: workflow.checkpoints.map((checkpoint) =>
      checkpoint.checkpointId),
    approvals: workflow.approvals.map((approval) => approval.approvalId),
    attemptHistory: workflow.attemptHistory.map((event) => event.eventId),
    diagnostics: workflow.diagnostics.map((diagnostic) =>
      diagnostic.diagnosticId),
    retryCounts: workflow.retryCounts,
    failureCount: workflow.failureCount,
    recoveryCount: workflow.recoveryCount,
    resumeCount: workflow.resumeCount,
    inFlight: workflow.inFlight?.attemptId ?? null,
  });
}

function withVersion(
  previous: AutonomousWorkflow,
  changes: Partial<AutonomousWorkflow>,
  reason: string,
  createdAt: string,
): AutonomousWorkflow {
  const workflowVersion = previous.workflowVersion + 1;
  const current = {
    ...previous,
    ...changes,
    workflowVersion,
    updatedAt: createdAt,
  };
  const withoutVersions = { ...current, versions: undefined } as unknown as
    Omit<AutonomousWorkflow, "versions">;
  const version: WorkflowVersionRecord = {
    workflowId: current.workflowId,
    workflowVersion,
    lifecycle: current.lifecycle,
    currentStage: current.currentStage,
    checkpointCount: current.checkpoints.length,
    retryCount: Object.values(current.retryCounts)
      .reduce((total, count) => total + count, 0),
    failureCount: current.failureCount,
    recoveryCount: current.recoveryCount,
    reason,
    stateHash: stateHash(withoutVersions),
    createdAt,
  };
  return {
    ...current,
    versions: [...previous.versions, version],
  };
}

const active = (workflow: AutonomousWorkflow): boolean =>
  !isTerminalWorkflow(workflow.lifecycle);

export class MemoryAutonomousWorkflowStore
implements AutonomousWorkflowStore {
  private readonly workflows = new Map<string, AutonomousWorkflow>();

  private key(tenantId: string, workflowId: string): string {
    return `${tenantId}\0${workflowId}`;
  }

  hydrate(workflow: AutonomousWorkflow): void {
    this.workflows.set(
      this.key(workflow.tenantId, workflow.workflowId), clone(workflow));
  }

  private save(workflow: AutonomousWorkflow): AutonomousWorkflow {
    const key = this.key(workflow.tenantId, workflow.workflowId);
    const current = this.workflows.get(key);
    const saved = clone({
      ...workflow,
      persistenceVersion: (current?.persistenceVersion ?? 0) + 1,
    });
    this.workflows.set(key, saved);
    return clone(saved);
  }

  private require(
    tenantId: string,
    workflowId: string,
    ownerId: string,
  ): AutonomousWorkflow {
    const workflow = this.workflows.get(this.key(tenantId, workflowId));
    if (!workflow) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_not_found", "Workflow was not found.");
    }
    if (workflow.ownerId !== ownerId) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_ownership_conflict",
        "Workflow belongs to another owner.");
    }
    return workflow;
  }

  async create(
    input: CreateWorkflowInput,
    quotas: WorkflowQuotas,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflowId = workflowIdentity(input);
    const existing = this.workflows.get(this.key(input.tenantId, workflowId));
    if (existing) {
      if (existing.repositoryRevision !== input.repositoryRevision) {
        throw new AutonomousWorkflowError(
          "autonomous_workflow_revision_conflict",
          "Workflow identity is fenced to its repository revision.");
      }
      return clone(existing);
    }
    const activeCount = [...this.workflows.values()].filter((workflow) =>
      workflow.tenantId === input.tenantId &&
      workflow.ownerId === input.ownerId && active(workflow)).length;
    validateCreateWorkflow(input, activeCount, quotas);
    const timestamp = now.toISOString();
    const base = {
      workflowId,
      schemaVersion: AUTONOMOUS_WORKFLOW_SCHEMA_VERSION,
      persistenceVersion: 0,
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      executionId: input.executionId,
      ownerId: input.ownerId,
      workflowVersion: 1,
      lifecycle: "created" as const,
      currentStage: "intelligence" as const,
      checkpoints: [],
      approvals: [],
      diagnostics: [],
      lifecycleHistory: [],
      attemptHistory: [],
      recoveryHistory: [],
      versions: [],
      retryCounts: emptyRetryCounts(),
      failureCount: 0,
      recoveryCount: 0,
      resumeCount: 0,
      inFlight: null,
      archiveMetadata: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    const withoutVersions = { ...base, versions: undefined } as unknown as
      Omit<AutonomousWorkflow, "versions">;
    const version: WorkflowVersionRecord = {
      workflowId,
      workflowVersion: 1,
      lifecycle: "created",
      currentStage: "intelligence",
      checkpointCount: 0,
      retryCount: 0,
      failureCount: 0,
      recoveryCount: 0,
      reason: "workflow_created",
      stateHash: stateHash(withoutVersions),
      createdAt: timestamp,
    };
    const workflow: AutonomousWorkflow = {
      ...base,
      lifecycleHistory: [lifecycleEvent(
        base, null, "created", "intelligence", "workflow_created", timestamp)],
      versions: [version],
    };
    validateWorkflowIntegrity(workflow);
    return this.save(workflow);
  }

  async get(tenantId: string, workflowId: string, ownerId: string) {
    const workflow = this.workflows.get(this.key(tenantId, workflowId));
    if (workflow && workflow.ownerId !== ownerId) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_ownership_conflict",
        "Workflow belongs to another owner.");
    }
    return workflow ? clone(workflow) : null;
  }

  async beginStage(
    input: AdvanceWorkflowInput,
    quotas: WorkflowQuotas,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflow = this.require(
      input.tenantId, input.workflowId, input.ownerId);
    if (now.getTime() - Date.parse(workflow.createdAt) >
        quotas.workflowDurationMs) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_duration_exceeded",
        "Workflow exceeded its maximum coordination duration.");
    }
    const requestHash = validateStageRequest(
      workflow, input.request.stage, input.request.payload,
      input.expectedWorkflowVersion, quotas);
    const timestamp = now.toISOString();
    const lifecycle = STAGE_LIFECYCLE[input.request.stage];
    const attempt = workflow.retryCounts[input.request.stage] + 1;
    const inFlight: WorkflowInFlightAttempt = {
      attemptId: stableId("workflow_attempt", {
        workflowId: workflow.workflowId,
        stage: input.request.stage,
        requestHash,
        attempt,
      }),
      stage: input.request.stage,
      requestHash,
      attempt,
      startedAt: timestamp,
      leaseExpiresAt: new Date(
        now.getTime() + quotas.stageLeaseMs).toISOString(),
    };
    const changed = withVersion(workflow, {
      lifecycle,
      inFlight,
      lifecycleHistory: lifecycle === workflow.lifecycle
        ? workflow.lifecycleHistory
        : [...workflow.lifecycleHistory, lifecycleEvent(
          { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
          workflow.lifecycle, lifecycle, input.request.stage,
          "stage_started", timestamp)],
      attemptHistory: [...workflow.attemptHistory, attemptEvent(
        workflow.workflowId, workflow.workflowVersion + 1,
        inFlight, "started", timestamp)],
    }, "stage_started", timestamp);
    return this.save(changed);
  }

  async completeStage(
    tenantId: string,
    workflowId: string,
    ownerId: string,
    expectedWorkflowVersion: number,
    result: WorkflowStageResult,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflow = this.require(tenantId, workflowId, ownerId);
    if (workflow.workflowVersion !== expectedWorkflowVersion ||
        !workflow.inFlight ||
        workflow.inFlight.stage !== result.stage ||
        workflow.currentStage !== result.stage) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_stale_completion",
        "Workflow stage completion fence is stale.");
    }
    const scope = result.metadata;
    for (const [key, expected] of [
      ["repositoryId", workflow.repositoryId],
      ["repositoryRevision", workflow.repositoryRevision],
      ["executionId", workflow.executionId],
      ["ownerId", workflow.ownerId],
    ] as const) {
      const received = scope[key];
      if (received !== undefined && received !== expected) {
        throw new AutonomousWorkflowError(
          "autonomous_workflow_service_scope_conflict",
          "Existing service result does not match workflow scope.", {
            field: key,
          });
      }
    }
    if (result.stage === "execution" &&
        result.referenceId !== workflow.executionId) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_execution_identity_conflict",
        "Execution service result does not match workflow execution.");
    }
    const timestamp = now.toISOString();
    const durationMs = Math.max(
      0, now.getTime() - Date.parse(workflow.inFlight.startedAt));
    const checkpoint: WorkflowCheckpoint = {
      checkpointId: stableId("workflow_checkpoint", {
        workflowId,
        sequence: workflow.checkpoints.length + 1,
        stage: result.stage,
        requestHash: workflow.inFlight.requestHash,
        outputHash: result.outputHash,
      }),
      workflowId,
      sequence: workflow.checkpoints.length + 1,
      stage: result.stage,
      requestHash: workflow.inFlight.requestHash,
      result,
      startedAt: workflow.inFlight.startedAt,
      completedAt: timestamp,
      durationMs,
    };
    const lifecycle = lifecycleAfterStage(result.stage);
    const currentStage = nextStage(result.stage);
    const completed = lifecycle === "completed";
    const changed = withVersion(workflow, {
      lifecycle,
      currentStage,
      checkpoints: [...workflow.checkpoints, checkpoint],
      attemptHistory: [...workflow.attemptHistory, attemptEvent(
        workflow.workflowId, workflow.workflowVersion + 1,
        workflow.inFlight, "succeeded", timestamp)],
      inFlight: null,
      completedAt: completed ? timestamp : null,
      lifecycleHistory: lifecycle === workflow.lifecycle
        ? workflow.lifecycleHistory
        : [...workflow.lifecycleHistory, lifecycleEvent(
          { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
          workflow.lifecycle, lifecycle, currentStage,
          completed ? "workflow_completed" : "stage_completed", timestamp)],
    }, completed ? "workflow_completed" : "stage_completed", timestamp);
    validateWorkflowIntegrity(changed);
    return this.save(changed);
  }

  async failStage(
    tenantId: string,
    workflowId: string,
    ownerId: string,
    expectedWorkflowVersion: number,
    code: string,
    message: string,
    quotas: WorkflowQuotas,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflow = this.require(tenantId, workflowId, ownerId);
    if (workflow.workflowVersion !== expectedWorkflowVersion ||
        !workflow.inFlight) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_stale_failure",
        "Workflow stage failure fence is stale.");
    }
    const timestamp = now.toISOString();
    const stage = workflow.inFlight.stage;
    const retryCounts = {
      ...workflow.retryCounts,
      [stage]: workflow.retryCounts[stage] + 1,
    };
    const exhausted = retryCounts[stage] > quotas.retriesPerStage;
    const diagnostic: WorkflowDiagnostic = {
      diagnosticId: stableId("workflow_diagnostic", {
        workflowId, workflowVersion: workflow.workflowVersion + 1,
        stage, code, attempt: retryCounts[stage],
      }),
      workflowId,
      workflowVersion: workflow.workflowVersion + 1,
      stage,
      severity: "error",
      code,
      message,
      retryable: !exhausted,
      createdAt: timestamp,
    };
    const diagnostics = [...workflow.diagnostics, diagnostic];
    if (diagnostics.length > quotas.diagnosticsPerWorkflow) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_quota_exceeded",
        "Workflow diagnostic quota was exceeded.");
    }
    const lifecycle = exhausted ? "failed" : workflow.lifecycle;
    const changed = withVersion(workflow, {
      lifecycle,
      retryCounts,
      failureCount: workflow.failureCount + 1,
      diagnostics,
      attemptHistory: [...workflow.attemptHistory, attemptEvent(
        workflow.workflowId, workflow.workflowVersion + 1,
        workflow.inFlight, "failed", timestamp)],
      inFlight: null,
      completedAt: exhausted ? timestamp : null,
      lifecycleHistory: exhausted
        ? [...workflow.lifecycleHistory, lifecycleEvent(
          { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
          workflow.lifecycle, "failed", stage, "retry_exhausted", timestamp)]
        : workflow.lifecycleHistory,
    }, exhausted ? "retry_exhausted" : "stage_retry_scheduled", timestamp);
    return this.save(changed);
  }

  async approve(
    input: ApproveWorkflowInput,
    executionReferenceId: string,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflow = this.require(
      input.tenantId, input.workflowId, input.ownerId);
    const replay = workflow.approvals.find((approval) =>
      approval.idempotencyKey === input.idempotencyKey);
    if (replay) return clone(workflow);
    if (workflow.workflowVersion !== input.expectedWorkflowVersion ||
        workflow.lifecycle !== "awaiting_approval" ||
        workflow.currentStage !== "agent_runtime" ||
        workflow.inFlight) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_approval_conflict",
        "Workflow is not awaiting this approval.");
    }
    const timestamp = now.toISOString();
    const approval = {
      approvalId: stableId("workflow_approval", {
        workflowId: workflow.workflowId,
        workflowVersion: workflow.workflowVersion,
        ownerId: input.ownerId,
        executionReferenceId,
        idempotencyKey: input.idempotencyKey,
      }),
      workflowId: workflow.workflowId,
      workflowVersion: workflow.workflowVersion + 1,
      decision: "approved" as const,
      ownerId: input.ownerId,
      executionReferenceId,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    };
    const changed = withVersion(workflow, {
      lifecycle: "executing",
      approvals: [...workflow.approvals, approval],
      lifecycleHistory: [...workflow.lifecycleHistory, lifecycleEvent(
        { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
        "awaiting_approval", "executing", "agent_runtime",
        "execution_approved", timestamp)],
    }, "execution_approved", timestamp);
    return this.save(changed);
  }

  async cancel(
    input: CancelWorkflowInput,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflow = this.require(
      input.tenantId, input.workflowId, input.ownerId);
    if (workflow.lifecycle === "cancelled") return clone(workflow);
    if (workflow.workflowVersion !== input.expectedWorkflowVersion ||
        workflow.lifecycle === "completed") {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_cancellation_conflict",
        "Workflow cannot be cancelled from its current version.");
    }
    const timestamp = now.toISOString();
    const changed = withVersion(workflow, {
      lifecycle: "cancelled",
      currentStage: null,
      inFlight: null,
      completedAt: timestamp,
      attemptHistory: workflow.inFlight
        ? [...workflow.attemptHistory, attemptEvent(
          workflow.workflowId, workflow.workflowVersion + 1,
          workflow.inFlight, "cancelled", timestamp)]
        : workflow.attemptHistory,
      lifecycleHistory: [...workflow.lifecycleHistory, lifecycleEvent(
        { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
        workflow.lifecycle, "cancelled", workflow.currentStage,
        "workflow_cancelled", timestamp)],
    }, "workflow_cancelled", timestamp);
    return this.save(changed);
  }

  async resume(
    input: ResumeWorkflowInput,
    quotas: WorkflowQuotas,
    now = new Date(),
  ): Promise<AutonomousWorkflow> {
    const workflow = this.require(
      input.tenantId, input.workflowId, input.ownerId);
    if (workflow.workflowVersion !== input.expectedWorkflowVersion ||
        workflow.lifecycle !== "failed" || !workflow.currentStage ||
        workflow.resumeCount >= quotas.resumesPerWorkflow) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_resume_conflict",
        "Workflow cannot be resumed from its current state.");
    }
    const timestamp = now.toISOString();
    const lifecycle = STAGE_LIFECYCLE[workflow.currentStage];
    const changed = withVersion(workflow, {
      lifecycle,
      resumeCount: workflow.resumeCount + 1,
      completedAt: null,
      lifecycleHistory: [...workflow.lifecycleHistory, lifecycleEvent(
        { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
        "failed", lifecycle, workflow.currentStage,
        "workflow_resumed", timestamp)],
    }, "workflow_resumed", timestamp);
    return this.save(changed);
  }

  async recover(
    now = new Date(),
    quotas?: WorkflowQuotas,
  ): Promise<number> {
    let count = 0;
    const timestamp = now.toISOString();
    for (const workflow of [...this.workflows.values()]) {
      if (!workflow.inFlight ||
          Date.parse(workflow.inFlight.leaseExpiresAt) > now.getTime()) {
        continue;
      }
      const stage = workflow.inFlight.stage;
      const retryCounts = {
        ...workflow.retryCounts,
        [stage]: workflow.retryCounts[stage] + 1,
      };
      const exhausted = retryCounts[stage] >
        (quotas?.retriesPerStage ?? Number.MAX_SAFE_INTEGER);
      const recovery: WorkflowRecoveryRecord = {
        recoveryId: stableId("workflow_recovery", {
          workflowId: workflow.workflowId,
          attemptId: workflow.inFlight.attemptId,
          stage,
        }),
        workflowVersion: workflow.workflowVersion + 1,
        stage,
        attemptId: workflow.inFlight.attemptId,
        reason: "expired_stage_lease",
        resumedFromCheckpoint: workflow.checkpoints.length,
        createdAt: timestamp,
      };
      const lifecycle = exhausted ? "failed" : STAGE_LIFECYCLE[stage];
      const changed = withVersion(workflow, {
        lifecycle,
        retryCounts,
        failureCount: workflow.failureCount + (exhausted ? 1 : 0),
        recoveryCount: workflow.recoveryCount + 1,
        recoveryHistory: [...workflow.recoveryHistory, recovery],
        attemptHistory: [...workflow.attemptHistory, attemptEvent(
          workflow.workflowId, workflow.workflowVersion + 1,
          workflow.inFlight, "recovered", timestamp)],
        inFlight: null,
        completedAt: exhausted ? timestamp : null,
        lifecycleHistory: lifecycle === workflow.lifecycle
          ? workflow.lifecycleHistory
          : [...workflow.lifecycleHistory, lifecycleEvent(
            { ...workflow, workflowVersion: workflow.workflowVersion + 1 },
            workflow.lifecycle, lifecycle, stage,
            exhausted ? "recovery_retry_exhausted" : "workflow_recovered",
            timestamp)],
      }, exhausted ? "recovery_retry_exhausted" : "workflow_recovered",
      timestamp);
      this.save(changed);
      count += 1;
    }
    return count;
  }

  async collect(
    tenantId: string,
    quotas: WorkflowQuotas,
  ): Promise<number> {
    const terminal = [...this.workflows.values()]
      .filter((workflow) =>
        workflow.tenantId === tenantId &&
        isTerminalWorkflow(workflow.lifecycle))
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.workflowId.localeCompare(right.workflowId));
    let removed = 0;
    for (const workflow of terminal.slice(quotas.retainedWorkflows)) {
      this.workflows.delete(this.key(tenantId, workflow.workflowId));
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string): Promise<WorkflowMetrics> {
    const workflows = [...this.workflows.values()].filter((workflow) =>
      !tenantId || workflow.tenantId === tenantId);
    const stageDurationsMs = Object.fromEntries(
      WORKFLOW_STAGES.map((stage) => [stage, 0])) as
      Record<WorkflowStage, number>;
    for (const workflow of workflows) {
      for (const checkpoint of workflow.checkpoints) {
        stageDurationsMs[checkpoint.stage] += checkpoint.durationMs;
      }
    }
    return clone({
      activeWorkflows: workflows.filter(active).length,
      stageDurationsMs,
      retries: workflows.reduce((total, workflow) =>
        total + Object.values(workflow.retryCounts)
          .reduce((sum, value) => sum + value, 0), 0),
      failures: workflows.reduce(
        (total, workflow) => total + workflow.failureCount, 0),
      recoveryCount: workflows.reduce(
        (total, workflow) => total + workflow.recoveryCount, 0),
      completionLatencyMs: workflows.reduce((total, workflow) =>
        total + (workflow.completedAt
          ? Math.max(0,
            Date.parse(workflow.completedAt) - Date.parse(workflow.createdAt))
          : 0), 0),
    });
  }

  async verify(quotas?: WorkflowQuotas): Promise<void> {
    if (quotas && Object.values(quotas).some((value) =>
      !Number.isSafeInteger(value) || value < 1)) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_startup_validation_failed",
        "Workflow quota and retention policy is invalid.");
    }
    for (const workflow of this.workflows.values()) {
      validateWorkflowIntegrity(workflow);
    }
  }
}

interface RpcQuery extends PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> {}
interface DatabaseClient {
  rpc(name: string, parameters?: Record<string, unknown>): RpcQuery;
}
const first = (value: unknown): Record<string, unknown> | undefined =>
  Array.isArray(value)
    ? value[0] as Record<string, unknown> | undefined : undefined;

export class PostgresAutonomousWorkflowStore
implements AutonomousWorkflowStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code =
        error.message?.match(/autonomous_workflow_[a-z_]+/u)?.[0] ??
        "autonomous_workflow_persistence_failed";
      throw new AutonomousWorkflowError(
        code, error.message ?? "Workflow persistence failed.");
    }
    return data;
  }

  private async load(tenantId: string, workflowId: string) {
    const data = await this.call("get_autonomous_workflow", {
      input_tenant_id: tenantId,
      input_workflow_id: workflowId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.workflow ?? data) as AutonomousWorkflow);
  }

  private async persist(
    workflow: AutonomousWorkflow,
    expectedPersistenceVersion: number | null,
  ) {
    const data = await this.call("save_autonomous_workflow", {
      input_workflow: workflow,
      input_expected_version: expectedPersistenceVersion === null
        ? null : String(expectedPersistenceVersion),
    });
    return clone((first(data)?.workflow ?? data) as AutonomousWorkflow);
  }

  private async mutate(
    tenantId: string,
    workflowId: string,
    operation: (
      memory: MemoryAutonomousWorkflowStore,
      existing: AutonomousWorkflow,
    ) => Promise<unknown>,
  ) {
    const existing = await this.load(tenantId, workflowId);
    if (!existing) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_not_found", "Workflow was not found.");
    }
    const memory = new MemoryAutonomousWorkflowStore();
    memory.hydrate(existing);
    await operation(memory, existing);
    const updated = await memory.get(
      tenantId, workflowId, existing.ownerId);
    if (!updated) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_not_found", "Workflow was not found.");
    }
    return this.persist(updated, existing.persistenceVersion);
  }

  async create(input: CreateWorkflowInput, quotas: WorkflowQuotas, now?: Date) {
    const id = workflowIdentity(input);
    const existing = await this.load(input.tenantId, id);
    if (existing) {
      if (existing.repositoryRevision !== input.repositoryRevision) {
        throw new AutonomousWorkflowError(
          "autonomous_workflow_revision_conflict",
          "Workflow identity is fenced to its repository revision.");
      }
      return existing;
    }
    const countData = await this.call("count_active_autonomous_workflows", {
      input_tenant_id: input.tenantId,
      input_owner_id: input.ownerId,
    });
    const activeCount = Number(first(countData)?.active_count ?? countData ?? 0);
    validateCreateWorkflow(input, activeCount, quotas);
    const memory = new MemoryAutonomousWorkflowStore();
    const workflow = await memory.create(input, quotas, now);
    return this.persist(workflow, null);
  }

  async get(tenantId: string, workflowId: string, ownerId: string) {
    const workflow = await this.load(tenantId, workflowId);
    if (workflow && workflow.ownerId !== ownerId) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_ownership_conflict",
        "Workflow belongs to another owner.");
    }
    return workflow;
  }

  beginStage(input: AdvanceWorkflowInput, quotas: WorkflowQuotas, now?: Date) {
    return this.mutate(input.tenantId, input.workflowId,
      (memory) => memory.beginStage(input, quotas, now));
  }

  completeStage(
    tenantId: string,
    workflowId: string,
    ownerId: string,
    expectedWorkflowVersion: number,
    result: WorkflowStageResult,
    now?: Date,
  ) {
    return this.mutate(tenantId, workflowId,
      (memory) => memory.completeStage(
        tenantId, workflowId, ownerId, expectedWorkflowVersion, result, now));
  }

  failStage(
    tenantId: string,
    workflowId: string,
    ownerId: string,
    expectedWorkflowVersion: number,
    code: string,
    message: string,
    quotas: WorkflowQuotas,
    now?: Date,
  ) {
    return this.mutate(tenantId, workflowId,
      (memory) => memory.failStage(
        tenantId, workflowId, ownerId, expectedWorkflowVersion,
        code, message, quotas, now));
  }

  approve(
    input: ApproveWorkflowInput,
    executionReferenceId: string,
    now?: Date,
  ) {
    return this.mutate(input.tenantId, input.workflowId,
      (memory) => memory.approve(input, executionReferenceId, now));
  }

  cancel(input: CancelWorkflowInput, now?: Date) {
    return this.mutate(input.tenantId, input.workflowId,
      (memory) => memory.cancel(input, now));
  }

  resume(input: ResumeWorkflowInput, quotas: WorkflowQuotas, now?: Date) {
    return this.mutate(input.tenantId, input.workflowId,
      (memory) => memory.resume(input, quotas, now));
  }

  async recover(now = new Date(), quotas?: WorkflowQuotas) {
    const data = await this.call("list_recoverable_autonomous_workflows", {
      input_now: now.toISOString(),
    });
    const workflows = (first(data)?.workflows ?? data ?? []) as
      AutonomousWorkflow[];
    let count = 0;
    for (const workflow of workflows) {
      const memory = new MemoryAutonomousWorkflowStore();
      memory.hydrate(workflow);
      const recovered = await memory.recover(now, quotas);
      if (recovered) {
        const updated = await memory.get(
          workflow.tenantId, workflow.workflowId, workflow.ownerId);
        if (updated) {
          await this.persist(updated, workflow.persistenceVersion);
        }
      }
      count += recovered;
    }
    return count;
  }

  async collect(tenantId: string, quotas: WorkflowQuotas) {
    const data = await this.call("collect_autonomous_workflows", {
      input_tenant_id: tenantId,
      input_workflow_retention: quotas.retainedWorkflows,
      input_version_retention: quotas.retainedVersions,
      input_diagnostic_retention: quotas.retainedDiagnostics,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("autonomous_workflow_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as WorkflowMetrics);
  }

  async verify() {
    const data = await this.call("verify_autonomous_workflow_contract", {
      input_engine_version: AUTONOMOUS_WORKFLOW_ENGINE_VERSION,
      input_schema_version: AUTONOMOUS_WORKFLOW_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_startup_validation_failed",
        "Autonomous workflow database contract is invalid.",
        { problems: row.problems ?? [] });
    }
  }
}

export const runtimeAutonomousWorkflowStore: AutonomousWorkflowStore =
  new PostgresAutonomousWorkflowStore(supabase as unknown as SupabaseClient);
