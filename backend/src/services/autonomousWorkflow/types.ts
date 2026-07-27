export const AUTONOMOUS_WORKFLOW_ENGINE_VERSION =
  "autonomous-workflow-orchestrator-v1";
export const AUTONOMOUS_WORKFLOW_SCHEMA_VERSION =
  "autonomous-workflow-schema-v1";

export const WORKFLOW_STAGES = [
  "intelligence",
  "planning",
  "execution",
  "agent_runtime",
  "tool_invocation",
  "collaboration",
  "workspace",
  "patch",
  "artifact",
  "review",
  "proposal",
  "apply",
  "knowledge",
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export type WorkflowLifecycle =
  | "created"
  | "analysing"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "reviewing"
  | "assembling"
  | "preparing_apply"
  | "completed"
  | "cancelled"
  | "failed";

export interface WorkflowStageRequest {
  readonly stage: WorkflowStage;
  readonly payload: unknown;
}

export interface WorkflowStageResult {
  readonly stage: WorkflowStage;
  readonly referenceId: string;
  readonly referenceVersion: string;
  readonly status: string;
  readonly outputHash: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface WorkflowStageExecution {
  readonly result: WorkflowStageResult;
  readonly output: unknown;
}

export interface WorkflowCheckpoint {
  readonly checkpointId: string;
  readonly workflowId: string;
  readonly sequence: number;
  readonly stage: WorkflowStage;
  readonly requestHash: string;
  readonly result: WorkflowStageResult;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface WorkflowInFlightAttempt {
  readonly attemptId: string;
  readonly stage: WorkflowStage;
  readonly requestHash: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly leaseExpiresAt: string;
}

export interface WorkflowAttemptEvent {
  readonly eventId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly attemptId: string;
  readonly stage: WorkflowStage;
  readonly requestHash: string;
  readonly attempt: number;
  readonly event: "started" | "succeeded" | "failed" | "recovered" | "cancelled";
  readonly createdAt: string;
}

export interface WorkflowApproval {
  readonly approvalId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly decision: "approved";
  readonly ownerId: string;
  readonly executionReferenceId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface WorkflowDiagnostic {
  readonly diagnosticId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly stage: WorkflowStage | null;
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly createdAt: string;
}

export interface WorkflowLifecycleEvent {
  readonly eventId: string;
  readonly workflowVersion: number;
  readonly from: WorkflowLifecycle | null;
  readonly to: WorkflowLifecycle;
  readonly stage: WorkflowStage | null;
  readonly reason: string;
  readonly createdAt: string;
}

export interface WorkflowRecoveryRecord {
  readonly recoveryId: string;
  readonly workflowVersion: number;
  readonly stage: WorkflowStage;
  readonly attemptId: string;
  readonly reason: "expired_stage_lease" | "interrupted_stage";
  readonly resumedFromCheckpoint: number;
  readonly createdAt: string;
}

export interface WorkflowVersionRecord {
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly lifecycle: WorkflowLifecycle;
  readonly currentStage: WorkflowStage | null;
  readonly checkpointCount: number;
  readonly retryCount: number;
  readonly failureCount: number;
  readonly recoveryCount: number;
  readonly reason: string;
  readonly stateHash: string;
  readonly createdAt: string;
}

export interface WorkflowArchiveMetadata {
  readonly archivedAt: string;
  readonly reason: "retention";
  readonly finalWorkflowVersion: number;
  readonly finalLifecycle: "completed" | "cancelled" | "failed";
}

export interface AutonomousWorkflow {
  readonly workflowId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly workflowVersion: number;
  readonly lifecycle: WorkflowLifecycle;
  readonly currentStage: WorkflowStage | null;
  readonly checkpoints: readonly WorkflowCheckpoint[];
  readonly approvals: readonly WorkflowApproval[];
  readonly diagnostics: readonly WorkflowDiagnostic[];
  readonly lifecycleHistory: readonly WorkflowLifecycleEvent[];
  readonly attemptHistory: readonly WorkflowAttemptEvent[];
  readonly recoveryHistory: readonly WorkflowRecoveryRecord[];
  readonly versions: readonly WorkflowVersionRecord[];
  readonly retryCounts: Readonly<Record<WorkflowStage, number>>;
  readonly failureCount: number;
  readonly recoveryCount: number;
  readonly resumeCount: number;
  readonly inFlight: WorkflowInFlightAttempt | null;
  readonly archiveMetadata: WorkflowArchiveMetadata | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CreateWorkflowInput {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly idempotencyKey: string;
}

export interface AdvanceWorkflowInput {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly ownerId: string;
  readonly expectedWorkflowVersion: number;
  readonly request: WorkflowStageRequest;
}

export interface ApproveWorkflowInput {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly ownerId: string;
  readonly expectedWorkflowVersion: number;
  readonly idempotencyKey: string;
  readonly executionApproval: unknown;
}

export interface CancelWorkflowInput {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly ownerId: string;
  readonly expectedWorkflowVersion: number;
  readonly idempotencyKey: string;
  readonly executionCancellation?: unknown;
}

export interface ResumeWorkflowInput {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly ownerId: string;
  readonly expectedWorkflowVersion: number;
}

export interface WorkflowQuotas {
  readonly activePerOwner: number;
  readonly retriesPerStage: number;
  readonly resumesPerWorkflow: number;
  readonly diagnosticsPerWorkflow: number;
  readonly requestBytes: number;
  readonly stageLeaseMs: number;
  readonly workflowDurationMs: number;
  readonly retainedWorkflows: number;
  readonly retainedVersions: number;
  readonly retainedDiagnostics: number;
}

export interface WorkflowMetrics {
  readonly activeWorkflows: number;
  readonly stageDurationsMs: Readonly<Record<WorkflowStage, number>>;
  readonly retries: number;
  readonly failures: number;
  readonly recoveryCount: number;
  readonly completionLatencyMs: number;
}

export interface WorkflowDependencyRecovery {
  readonly intelligence: number;
  readonly planning: number;
  readonly execution: number;
  readonly agentRuntime: number;
  readonly toolInvocation: number;
  readonly collaboration: number;
  readonly workspace: number;
  readonly artifact: number;
  readonly review: number;
  readonly proposal: number;
  readonly apply: number;
  readonly knowledge: number;
}

export class AutonomousWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AutonomousWorkflowError";
  }
}
