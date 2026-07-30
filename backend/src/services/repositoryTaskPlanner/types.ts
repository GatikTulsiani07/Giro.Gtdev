import type { ChangeImplementationPlan, ChangeRiskAssessment } from "../changeIntelligence/types.js";

export const REPOSITORY_TASK_PLANNER_VERSION = "repository-task-planner-v1";
export const REPOSITORY_TASK_PLAN_SCHEMA_VERSION =
  "repository-task-plan-schema-v1";

export const TASK_CATEGORIES = [
  "bug fix", "new feature", "refactor", "performance", "security",
  "documentation", "testing", "dependency update", "API change",
  "architecture improvement",
] as const;
export type RepositoryTaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskPlanLifecycle =
  "planning" | "published" | "partial" | "failed" | "superseded";
export type TaskPlanningEngine =
  "Repository Intelligence" | "Semantic Intelligence" |
  "Feature Intelligence" | "Change Intelligence" | "Query Engine" |
  "Repository Insights" | "Evolution Intelligence" | "Knowledge Engine" |
  "Workflow Engine";
export type TaskPhaseKind =
  "preparation" | "investigation" | "implementation" | "validation" |
  "testing" | "review" | "deployment readiness";

export interface RepositoryTask {
  readonly taskId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly userRequest: string;
  readonly normalizedObjective: string;
  readonly category: RepositoryTaskCategory;
  readonly confidence: number;
  readonly lifecycle: TaskPlanLifecycle;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface TaskEngineStep {
  readonly position: number;
  readonly engine: TaskPlanningEngine;
  readonly required: boolean;
  readonly reason: string;
}

export interface TaskImpact {
  readonly affectedFeatures: readonly string[];
  readonly affectedModules: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly dependencies: readonly string[];
  readonly downstreamImpact: readonly string[];
}

export interface TaskExecutionPhase {
  readonly phaseId: string;
  readonly position: number;
  readonly kind: TaskPhaseKind;
  readonly title: string;
  readonly objective: string;
  readonly targets: readonly string[];
  readonly actions: readonly string[];
  readonly dependsOn: readonly string[];
  readonly evidenceReferences: readonly string[];
}

export interface TaskRiskAssessment {
  readonly implementationComplexity: number;
  readonly architecturalRisk: number;
  readonly dependencyRisk: number;
  readonly regressionRisk: number;
  readonly overallRisk: number;
  readonly level: "low" | "medium" | "high" | "critical";
  readonly inputs: Readonly<Record<string, number>>;
}

export interface TaskValidationChecklist {
  readonly requiredTests: readonly string[];
  readonly verificationSteps: readonly string[];
  readonly affectedWorkflows: readonly string[];
  readonly reviewChecklist: readonly string[];
}

export interface TaskPlanningDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly engine?: TaskPlanningEngine;
}

export interface RepositoryTaskPlan {
  readonly task: RepositoryTask;
  readonly sourceVersions: {
    readonly repositoryIntelligence: string;
    readonly repositoryGraph: string;
    readonly semanticGraph: string;
    readonly featureGraph: string;
  };
  readonly orchestrationPlan: readonly TaskEngineStep[];
  readonly impact: TaskImpact;
  readonly phases: readonly TaskExecutionPhase[];
  readonly risk: TaskRiskAssessment;
  readonly validationChecklist: TaskValidationChecklist;
  readonly changeRoadmap: ChangeImplementationPlan | null;
  readonly changeRisk: ChangeRiskAssessment | null;
  readonly diagnostics: readonly TaskPlanningDiagnostic[];
  readonly engineUsage: readonly TaskPlanningEngine[];
  readonly cacheHit: boolean;
  readonly orchestrationLatencyMs: number;
  readonly accuracyInputCount: number;
  readonly recoveryCount: number;
}

export interface CreateRepositoryTaskPlanInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly userRequest: string;
  readonly workflowId?: string;
  readonly requestedAt?: string;
}

export interface RepositoryTaskPlannerMetrics {
  readonly plansCreated: number;
  readonly cacheHits: number;
  readonly averageOrchestrationLatencyMs: number;
  readonly averageAccuracyInputs: number;
  readonly recoveryCount: number;
}

export class RepositoryTaskPlannerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryTaskPlannerError";
  }
}
