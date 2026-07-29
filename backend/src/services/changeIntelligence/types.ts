import type { FeatureGraph } from "../featureIntelligence/types.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";

export const CHANGE_INTELLIGENCE_ENGINE_VERSION = "change-intelligence-v1";
export const CHANGE_INTELLIGENCE_SCHEMA_VERSION = "change-analysis-v1";

export type ChangeTargetKind =
  | "feature" | "module" | "file" | "symbol" | "api_endpoint" | "route"
  | "service" | "repository_component";
export type ChangeType = "add" | "modify" | "remove" | "refactor" | "fix" | "migrate";
export type ChangeRiskLevel = "low" | "medium" | "high" | "critical";
export type ChangeAnalysisLifecycle =
  | "building" | "validating" | "published" | "failed" | "superseded";

export interface ChangeTarget {
  readonly kind: ChangeTargetKind;
  readonly value: string;
}

export interface ChangeRequest {
  readonly changeId: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly workflowId: string;
  readonly requestedTarget: ChangeTarget;
  readonly changeType: ChangeType;
  readonly rationale: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ImpactNodeKind =
  | "file" | "symbol" | "feature" | "api" | "workflow" | "module";

export interface ImpactDependencyStep {
  readonly position: number;
  readonly kind: ImpactNodeKind;
  readonly id: string;
}

export interface ImpactDependencyChain {
  readonly chainId: string;
  readonly steps: readonly ImpactDependencyStep[];
}

export interface ChangeImpactGraph {
  readonly impactGraphId: string;
  readonly changeId: string;
  readonly directlyAffectedFiles: readonly string[];
  readonly indirectlyAffectedFiles: readonly string[];
  readonly affectedSymbolIds: readonly string[];
  readonly affectedFeatureIds: readonly string[];
  readonly affectedApis: readonly string[];
  readonly affectedWorkflowIds: readonly string[];
  readonly dependencyChains: readonly ImpactDependencyChain[];
  readonly maximumDependencyDepth: number;
}

export interface ChangeRiskAssessment {
  readonly riskAssessmentId: string;
  readonly changeId: string;
  readonly level: ChangeRiskLevel;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly factors: Readonly<Record<string, number>>;
}

export type ImplementationPlanPhase =
  | "preparation" | "dependencies" | "implementation" | "validation" | "review";

export interface ImplementationPlanStep {
  readonly stepId: string;
  readonly position: number;
  readonly phase: ImplementationPlanPhase;
  readonly action: string;
  readonly targets: readonly string[];
}

export interface ChangeImplementationPlan {
  readonly implementationPlanId: string;
  readonly changeId: string;
  readonly steps: readonly ImplementationPlanStep[];
}

export interface ChangeDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
}

export interface ChangeAnalysisMetrics {
  readonly analyses: number;
  readonly averageImpactSize: number;
  readonly averageDependencyDepth: number;
  readonly riskDistribution: Readonly<Record<ChangeRiskLevel, number>>;
  readonly reuseRate: number;
  readonly recoveryCount: number;
}

export interface ChangeAnalysis {
  readonly analysisId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly lifecycle: ChangeAnalysisLifecycle;
  readonly request: ChangeRequest;
  readonly repositoryIntelligenceVersion: string;
  readonly semanticGraphVersion: string;
  readonly featureGraphVersion: string;
  readonly impact: ChangeImpactGraph;
  readonly risk: ChangeRiskAssessment;
  readonly implementationPlan: ChangeImplementationPlan;
  readonly diagnostics: readonly ChangeDiagnostic[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface AnalyzeChangeInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly workflowId: string;
  readonly requestedTarget: ChangeTarget;
  readonly changeType: ChangeType;
  readonly rationale: string;
  readonly repositoryIntelligence: RepositoryIntelligenceRecord;
  readonly semanticGraph: SemanticGraph;
  readonly featureGraph: FeatureGraph;
  readonly requestedAt?: string;
}

export class ChangeIntelligenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ChangeIntelligenceError";
  }
}
