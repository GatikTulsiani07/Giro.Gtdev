import type { AutonomousWorkflow } from "../autonomousWorkflow/types.js";
import type { ChangeAnalysis } from "../changeIntelligence/types.js";
import type { FeatureGraph } from "../featureIntelligence/types.js";
import type { KnowledgeRetrievalResult } from "../repositoryKnowledge/types.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import type { RepositoryQueryExecution } from "../repositoryQuery/types.js";
import type { RepositorySymbolGraph } from "../repositoryGraph/graphTypes.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";

export const REPOSITORY_INSIGHT_ENGINE_VERSION = "repository-insight-engine-v1";
export const REPOSITORY_INSIGHT_SCHEMA_VERSION = "repository-insight-schema-v1";

export const INSIGHT_TYPES = [
  "architectural hotspot", "highly coupled module", "cyclic dependency",
  "oversized feature", "dead code candidate", "orphan module",
  "duplicated implementation", "high-risk dependency", "complex workflow",
  "feature ownership anomaly", "stale knowledge", "documentation gap",
] as const;
export type RepositoryInsightType = (typeof INSIGHT_TYPES)[number];
export type InsightSeverity = "info" | "low" | "medium" | "high" | "critical";
export type InsightLifecycle =
  "generating" | "published" | "partial" | "failed" | "superseded";
export type InsightEvidenceKind =
  "file" | "symbol" | "module" | "feature" | "dependency_path" | "workflow";

export interface InsightEvidence {
  readonly evidenceId: string;
  readonly kind: InsightEvidenceKind;
  readonly reference: string;
  readonly sourceEngine: string;
  readonly sourceVersion: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface InsightScore {
  readonly total: number;
  readonly dependencyDepth: number;
  readonly featureImpact: number;
  readonly coupling: number;
  readonly usageFrequency: number;
  readonly queryFrequency: number;
  readonly architecturalCentrality: number;
}

export interface RepositoryInsight {
  readonly insightId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly type: RepositoryInsightType;
  readonly title: string;
  readonly summary: string;
  readonly severity: InsightSeverity;
  readonly confidence: number;
  readonly supportingEvidence: readonly InsightEvidence[];
  readonly relatedFeatures: readonly string[];
  readonly relatedSymbols: readonly string[];
  readonly relatedFiles: readonly string[];
  readonly score: InsightScore;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InsightDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly insightId?: string;
}

export interface RepositoryInsightSources {
  readonly repositoryIntelligence: RepositoryIntelligenceRecord;
  readonly repositoryGraph: RepositorySymbolGraph;
  readonly semanticGraph: SemanticGraph;
  readonly featureGraph: FeatureGraph;
  readonly changeAnalyses: readonly ChangeAnalysis[];
  readonly workflows: readonly AutonomousWorkflow[];
  readonly knowledge: readonly KnowledgeRetrievalResult[];
  readonly queryHistory: readonly RepositoryQueryExecution[];
}

export interface InsightSourceVersions {
  readonly repositoryIntelligence: string;
  readonly repositoryGraph: string;
  readonly semanticGraph: string;
  readonly featureGraph: string;
  readonly changes: string;
  readonly workflows: string;
  readonly knowledge: string;
  readonly queries: string;
}

export interface RepositoryInsightGeneration {
  readonly generationId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly sourceVersions: InsightSourceVersions;
  readonly sourceFingerprint: string;
  readonly lifecycle: InsightLifecycle;
  readonly insights: readonly RepositoryInsight[];
  readonly diagnostics: readonly InsightDiagnostic[];
  readonly generatedCount: number;
  readonly reusedCount: number;
  readonly generationLatencyMs: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface GenerateRepositoryInsightsInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly generatedAt?: string;
}

export interface InsightNavigationQuery {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly limit?: number;
  readonly featureId?: string;
  readonly module?: string;
  readonly file?: string;
  readonly category?:
    "architectural hotspots" | "duplicated logic" |
    "dependency issues" | "documentation issues";
}

export interface RepositoryInsightMetrics {
  readonly insightsGenerated: number;
  readonly insightCategories: Readonly<Record<RepositoryInsightType, number>>;
  readonly severityDistribution: Readonly<Record<InsightSeverity, number>>;
  readonly averageGenerationLatencyMs: number;
  readonly incrementalReuse: number;
  readonly recoveryCount: number;
}

export interface RepositoryInsightAuxiliarySources {
  readonly changeAnalyses: readonly ChangeAnalysis[];
  readonly workflows: readonly AutonomousWorkflow[];
  readonly knowledge: readonly KnowledgeRetrievalResult[];
  readonly queryHistory: readonly RepositoryQueryExecution[];
}

export class RepositoryInsightError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryInsightError";
  }
}
