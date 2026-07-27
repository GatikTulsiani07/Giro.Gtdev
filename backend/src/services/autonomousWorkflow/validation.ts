import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import {
  AUTONOMOUS_WORKFLOW_SCHEMA_VERSION,
  AutonomousWorkflowError,
  WORKFLOW_STAGES,
  type AutonomousWorkflow,
  type CreateWorkflowInput,
  type WorkflowLifecycle,
  type WorkflowQuotas,
  type WorkflowStage,
} from "./types.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/;
const terminal = new Set<WorkflowLifecycle>([
  "completed", "cancelled", "failed",
]);

export const STAGE_LIFECYCLE: Readonly<Record<
  WorkflowStage, WorkflowLifecycle
>> = Object.freeze({
  intelligence: "analysing",
  planning: "planning",
  execution: "planning",
  agent_runtime: "executing",
  tool_invocation: "executing",
  collaboration: "executing",
  workspace: "executing",
  patch: "executing",
  artifact: "executing",
  review: "reviewing",
  proposal: "assembling",
  apply: "preparing_apply",
  knowledge: "preparing_apply",
});

export function workflowIdentity(input: Pick<CreateWorkflowInput,
  "tenantId" | "repositoryId" | "executionId" | "ownerId">): string {
  return stableId("autonomous_workflow", {
    tenantId: input.tenantId,
    repositoryId: input.repositoryId,
    executionId: input.executionId,
    ownerId: input.ownerId,
  });
}

export function emptyRetryCounts(): Record<WorkflowStage, number> {
  return Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage, 0])) as
    Record<WorkflowStage, number>;
}

export function nextStage(stage: WorkflowStage): WorkflowStage | null {
  const position = WORKFLOW_STAGES.indexOf(stage);
  return WORKFLOW_STAGES[position + 1] ?? null;
}

export function lifecycleAfterStage(
  stage: WorkflowStage,
): WorkflowLifecycle {
  if (stage === "execution") return "awaiting_approval";
  const next = nextStage(stage);
  return next ? STAGE_LIFECYCLE[next] : "completed";
}

export function validateCreateWorkflow(
  input: CreateWorkflowInput,
  activeCount: number,
  quotas: WorkflowQuotas,
): void {
  for (const [name, value] of Object.entries({
    tenantId: input.tenantId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    executionId: input.executionId,
    ownerId: input.ownerId,
    idempotencyKey: input.idempotencyKey,
  })) {
    if (!identifierPattern.test(value)) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_schema_invalid", `${name} is malformed.`);
    }
  }
  if (input.ownerId !== input.repositoryOwnerId) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_ownership_conflict",
      "Workflow repository belongs to another owner.");
  }
  if (activeCount >= quotas.activePerOwner) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_quota_exceeded",
      "Active workflow quota was exceeded.");
  }
}

export function validateStageRequest(
  workflow: AutonomousWorkflow,
  stage: WorkflowStage,
  payload: unknown,
  expectedVersion: number,
  quotas: WorkflowQuotas,
): string {
  if (workflow.ownerId.length === 0 || workflow.lifecycle === "cancelled" ||
      workflow.lifecycle === "completed") {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_lifecycle_conflict",
      "Terminal workflows cannot advance.");
  }
  if (workflow.lifecycle === "failed") {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_resume_required",
      "Failed workflows must be resumed before advancing.");
  }
  if (workflow.lifecycle === "awaiting_approval") {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_approval_required",
      "Workflow approval is required before advancing.");
  }
  if (workflow.workflowVersion !== expectedVersion) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_stale_version",
      "Workflow version fence is stale.", {
        expectedVersion: workflow.workflowVersion,
        receivedVersion: expectedVersion,
      });
  }
  if (workflow.currentStage !== stage ||
      STAGE_LIFECYCLE[stage] !==
        (workflow.lifecycle === "created" ? "analysing" : workflow.lifecycle)) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_illegal_transition",
      "Requested stage is not the deterministic next workflow stage.", {
        currentStage: workflow.currentStage,
        requestedStage: stage,
        lifecycle: workflow.lifecycle,
      });
  }
  if (workflow.inFlight) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_stage_in_progress",
      "A workflow stage is already in progress.");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(payload);
  } catch {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_request_invalid",
      "Workflow stage request is not serializable.");
  }
  if (encoded === undefined ||
      Buffer.byteLength(encoded) > quotas.requestBytes) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_quota_exceeded",
      "Workflow stage request exceeds its size quota.");
  }
  const requestHash = stableHash(payload);
  const latestAttempt = [...workflow.attemptHistory].reverse().find((event) =>
    event.stage === stage && event.event === "started");
  if (latestAttempt && workflow.checkpoints.every((checkpoint) =>
    checkpoint.stage !== stage) && latestAttempt.requestHash !== requestHash) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_retry_input_conflict",
      "A retried workflow stage must replay its immutable request.");
  }
  return requestHash;
}

export function validateWorkflowIntegrity(
  workflow: AutonomousWorkflow,
): void {
  if (workflow.schemaVersion !== AUTONOMOUS_WORKFLOW_SCHEMA_VERSION ||
      workflow.workflowVersion !== workflow.versions.length ||
      workflow.versions.some((version, index) =>
        version.workflowVersion !== index + 1) ||
      workflow.checkpoints.some((checkpoint, index) =>
        checkpoint.sequence !== index + 1 ||
        WORKFLOW_STAGES[index] !== checkpoint.stage) ||
      (terminal.has(workflow.lifecycle) &&
        workflow.lifecycle !== "failed" && workflow.currentStage !== null)) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_integrity_invalid",
      "Workflow history failed integrity validation.");
  }
}

export const isTerminalWorkflow = (lifecycle: WorkflowLifecycle): boolean =>
  terminal.has(lifecycle);
