import type { RepositoryTaskPlan } from "../repositoryTaskPlanner/types.js";

export const REPOSITORY_SPECIFICATION_ENGINE_VERSION =
  "repository-specification-engine-v1";
export const REPOSITORY_SPECIFICATION_SCHEMA_VERSION =
  "repository-engineering-specification-v1";

export const SPECIFICATION_TYPES = [
  "feature", "bug-fix", "refactor", "api", "architecture", "migration",
  "security", "performance", "testing",
] as const;
export type RepositorySpecificationType =
  (typeof SPECIFICATION_TYPES)[number];
export type SpecificationLifecycle =
  "generating" | "published" | "partial" | "failed" | "superseded";
export type SpecificationPhaseKind =
  "preparation" | "implementation" | "verification" | "testing" |
  "review" | "rollout" | "post-deployment validation";

export interface EngineeringSpecificationRecord {
  readonly specificationId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly taskId: string | null;
  readonly workflowId: string | null;
  readonly type: RepositorySpecificationType;
  readonly title: string;
  readonly objective: string;
  readonly scope: readonly string[];
  readonly assumptions: readonly string[];
  readonly constraints: readonly string[];
  readonly confidence: number;
  readonly ownershipFingerprint: string;
  readonly lifecycle: SpecificationLifecycle;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface SpecificationContext {
  readonly sourceVersions: RepositoryTaskPlan["sourceVersions"];
  readonly repository: readonly string[];
  readonly semantic: readonly string[];
  readonly featureOwnership: readonly string[];
  readonly architecture: readonly string[];
  readonly workflows: readonly string[];
  readonly knowledge: readonly string[];
  readonly evolution: readonly string[];
  readonly insights: readonly string[];
}

export interface SpecificationImpactSummary {
  readonly affectedFeatures: readonly string[];
  readonly affectedModules: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly dependencyChain: readonly string[];
  readonly downstreamImpact: readonly string[];
}

export interface SpecificationImplementationPhase {
  readonly phaseId: string;
  readonly position: number;
  readonly kind: SpecificationPhaseKind;
  readonly title: string;
  readonly objective: string;
  readonly actions: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface SpecificationRisk {
  readonly score: number;
  readonly level: "low" | "medium" | "high" | "critical";
  readonly summary: string;
  readonly evidence: readonly string[];
}

export interface SpecificationRiskAnalysis {
  readonly architectural: SpecificationRisk;
  readonly dependency: SpecificationRisk;
  readonly regression: SpecificationRisk;
  readonly rollout: SpecificationRisk;
}

export interface SpecificationAcceptanceCriteria {
  readonly functionalRequirements: readonly string[];
  readonly nonFunctionalRequirements: readonly string[];
  readonly validationChecklist: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface SpecificationTestStrategy {
  readonly unitTestingPlan: readonly string[];
  readonly integrationTestingPlan: readonly string[];
  readonly regressionTestingPlan: readonly string[];
  readonly validationSteps: readonly string[];
}

export interface SpecificationDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
}

export interface RepositoryEngineeringSpecification {
  readonly specification: EngineeringSpecificationRecord;
  readonly context: SpecificationContext;
  readonly impact: SpecificationImpactSummary;
  readonly implementationPhases: readonly SpecificationImplementationPhase[];
  readonly risks: SpecificationRiskAnalysis;
  readonly acceptanceCriteria: SpecificationAcceptanceCriteria;
  readonly testStrategy: SpecificationTestStrategy;
  readonly diagnostics: readonly SpecificationDiagnostic[];
  readonly cacheHit: boolean;
  readonly orchestrationLatencyMs: number;
  readonly recoveryCount: number;
}

export interface CreateRepositorySpecificationInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly objective: string;
  readonly taskId?: string;
  readonly workflowId?: string;
  readonly requestedAt?: string;
}

export interface RepositorySpecificationMetrics {
  readonly specificationsCreated: number;
  readonly cacheHits: number;
  readonly averageOrchestrationLatencyMs: number;
  readonly reuseRate: number;
  readonly recoveryCount: number;
}

export class RepositorySpecificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositorySpecificationError";
  }
}
