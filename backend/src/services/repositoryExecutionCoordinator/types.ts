import type {
  RepositoryEngineeringSpecification,
  SpecificationRiskAnalysis,
  SpecificationTestStrategy,
} from "../repositorySpecification/types.js";

export const REPOSITORY_EXECUTION_COORDINATOR_VERSION =
  "repository-execution-coordinator-v1";
export const REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION =
  "repository-execution-coordinator-schema-v1";

export const EXECUTION_COORDINATOR_STAGES = [
  "query", "task planning", "specification generation",
  "impact verification", "review preparation", "execution readiness",
  "completion",
] as const;
export type ExecutionCoordinatorStage =
  (typeof EXECUTION_COORDINATOR_STAGES)[number];
export type CoordinatedExecutionStatus =
  "coordinating" | "completed" | "partial" | "failed" | "stale";
export type StageOutcome = "completed" | "partial" | "failed";
export type ExecutionReadinessStatus = "ready" | "partial" | "not_ready";

export interface CoordinatedExecutionRecord {
  readonly executionId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly taskId: string;
  readonly specificationId: string;
  readonly workflowId: string;
  readonly objective: string;
  readonly ownershipFingerprint: string;
  readonly status: CoordinatedExecutionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface ExecutionStageTransition {
  readonly transitionId: string;
  readonly position: number;
  readonly fromStage: ExecutionCoordinatorStage | null;
  readonly stage: ExecutionCoordinatorStage;
  readonly outcome: StageOutcome;
  readonly referenceId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface ExecutionReadinessCheck {
  readonly name:
    "ownership" | "repository revision" | "published intelligence" |
    "specification availability" | "task validity" | "graph integrity" |
    "semantic consistency" | "feature lineage" | "workflow validity";
  readonly passed: boolean;
  readonly evidence: readonly string[];
}

export interface ExecutionReadinessReport {
  readonly reportId: string;
  readonly status: ExecutionReadinessStatus;
  readonly checks: readonly ExecutionReadinessCheck[];
  readonly createdAt: string;
}

export interface ExecutionSummary {
  readonly repository: {
    readonly repositoryId: string;
    readonly revision: string;
  };
  readonly affectedFeatures: readonly string[];
  readonly affectedModules: readonly string[];
  readonly implementationPhases:
    RepositoryEngineeringSpecification["implementationPhases"];
  readonly risks: SpecificationRiskAnalysis;
  readonly validationChecklist: readonly string[];
  readonly testingStrategy: SpecificationTestStrategy;
  readonly readinessStatus: ExecutionReadinessStatus;
}

export interface ExecutionCoordinatorDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly stage?: ExecutionCoordinatorStage;
}

export interface RepositoryCoordinatedExecution {
  readonly execution: CoordinatedExecutionRecord;
  readonly stageHistory: readonly ExecutionStageTransition[];
  readonly readiness: ExecutionReadinessReport | null;
  readonly summary: ExecutionSummary | null;
  readonly diagnostics: readonly ExecutionCoordinatorDiagnostic[];
  readonly cacheHit: boolean;
  readonly orchestrationLatencyMs: number;
  readonly recoveryCount: number;
}

export interface CoordinateRepositoryExecutionInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly workflowId: string;
  readonly objective: string;
  readonly requestedAt?: string;
}

export interface RepositoryExecutionCoordinatorMetrics {
  readonly executions: number;
  readonly stageDurations: Readonly<Record<ExecutionCoordinatorStage, number>>;
  readonly cacheHits: number;
  readonly averageOrchestrationLatencyMs: number;
  readonly recoveryCount: number;
  readonly readinessOutcomes: Readonly<Record<ExecutionReadinessStatus, number>>;
}

export class RepositoryExecutionCoordinatorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryExecutionCoordinatorError";
  }
}
