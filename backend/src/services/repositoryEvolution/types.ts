import type { AutonomousWorkflow } from "../autonomousWorkflow/types.js";
import type { FeatureGraph } from "../featureIntelligence/types.js";
import type { KnowledgeRetrievalResult } from "../repositoryKnowledge/types.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import type { RepositorySymbolGraph } from "../repositoryGraph/graphTypes.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";

export const REPOSITORY_EVOLUTION_ENGINE_VERSION =
  "repository-evolution-intelligence-v1";
export const REPOSITORY_EVOLUTION_SCHEMA_VERSION =
  "repository-evolution-schema-v1";
export const REPOSITORY_EVOLUTION_ANALYSIS_VERSION =
  "repository-evolution-analysis-v1";

export type EvolutionLifecycle =
  "comparing" | "published" | "failed" | "superseded";
export type EvolutionChangeKind = "added" | "removed" | "modified";
export type EvolutionTimelineKind =
  "file" | "module" | "feature" | "symbol" | "architecture" |
  "dependency" | "api";
export type EvolutionTrendType =
  "increasing coupling" | "expanding features" | "shrinking modules" |
  "unstable APIs" | "growing dependency chains";

export interface EvolutionEvidence {
  readonly evidenceId: string;
  readonly sourceEngine: string;
  readonly sourceVersion: string;
  readonly reference: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface EntityEvolution {
  readonly entityId: string;
  readonly name: string;
  readonly change: EvolutionChangeKind;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly evidence: readonly EvolutionEvidence[];
}

export interface ArchitectureEvolution {
  readonly newModules: readonly EntityEvolution[];
  readonly removedModules: readonly EntityEvolution[];
  readonly couplingChanges: readonly EntityEvolution[];
  readonly dependencyGrowth: number;
  readonly introducedCycles: readonly string[][];
  readonly resolvedCycles: readonly string[][];
  readonly hotspotChanges: readonly EntityEvolution[];
}

export interface FeatureEvolution {
  readonly added: readonly EntityEvolution[];
  readonly removed: readonly EntityEvolution[];
  readonly modified: readonly EntityEvolution[];
}

export interface DependencyEvolution {
  readonly added: readonly EntityEvolution[];
  readonly removed: readonly EntityEvolution[];
}

export interface SemanticEvolution {
  readonly symbolAdditions: readonly EntityEvolution[];
  readonly symbolRemovals: readonly EntityEvolution[];
  readonly interfaceChanges: readonly EntityEvolution[];
  readonly inheritanceChanges: readonly EntityEvolution[];
  readonly implementationChanges: readonly EntityEvolution[];
  readonly apiEvolution: readonly EntityEvolution[];
}

export interface AuxiliaryEvolution {
  readonly added: readonly EntityEvolution[];
  readonly removed: readonly EntityEvolution[];
  readonly modified: readonly EntityEvolution[];
}

export interface RevisionComparison {
  readonly features: FeatureEvolution;
  readonly architecture: ArchitectureEvolution;
  readonly dependencies: DependencyEvolution;
  readonly semantic: SemanticEvolution;
  readonly workflows: AuxiliaryEvolution;
  readonly knowledge: AuxiliaryEvolution;
}

export interface EvolutionTimelineEntry {
  readonly timelineId: string;
  readonly evolutionId: string;
  readonly kind: EvolutionTimelineKind;
  readonly entityId: string;
  readonly entityName: string;
  readonly change: EvolutionChangeKind;
  readonly baseRevision: string;
  readonly targetRevision: string;
  readonly evidence: readonly EvolutionEvidence[];
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface EvolutionTrend {
  readonly trendId: string;
  readonly evolutionId: string;
  readonly type: EvolutionTrendType;
  readonly direction: "increasing" | "decreasing" | "unstable";
  readonly magnitude: number;
  readonly confidence: number;
  readonly summary: string;
  readonly evidence: readonly EvolutionEvidence[];
}

export interface EvolutionDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
}

export interface EvolutionSourceVersions {
  readonly baseRepositoryIntelligence: string;
  readonly targetRepositoryIntelligence: string;
  readonly baseRepositoryGraph: string;
  readonly targetRepositoryGraph: string;
  readonly baseSemanticGraph: string;
  readonly targetSemanticGraph: string;
  readonly baseFeatureGraph: string;
  readonly targetFeatureGraph: string;
  readonly workflows: string;
  readonly knowledge: string;
}

export interface RepositoryEvolutionRecord {
  readonly evolutionId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly baseRevision: string;
  readonly targetRevision: string;
  readonly comparisonTimestamp: string;
  readonly analysisVersion: string;
  readonly sourceFingerprint: string;
  readonly sourceVersions: EvolutionSourceVersions;
  readonly lifecycle: EvolutionLifecycle;
  readonly comparison: RevisionComparison;
  readonly timelines: readonly EvolutionTimelineEntry[];
  readonly trends: readonly EvolutionTrend[];
  readonly diagnostics: readonly EvolutionDiagnostic[];
  readonly reusedCount: number;
  readonly comparisonLatencyMs: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface EvolutionRevisionSources {
  readonly repositoryIntelligence: RepositoryIntelligenceRecord;
  readonly repositoryGraph: RepositorySymbolGraph;
  readonly semanticGraph: SemanticGraph;
  readonly featureGraph: FeatureGraph;
  readonly workflows: readonly AutonomousWorkflow[];
  readonly knowledge: readonly KnowledgeRetrievalResult[];
}

export interface RepositoryEvolutionSources {
  readonly base: EvolutionRevisionSources;
  readonly target: EvolutionRevisionSources;
}

export interface EvolutionAuxiliarySources {
  readonly baseWorkflows: readonly AutonomousWorkflow[];
  readonly targetWorkflows: readonly AutonomousWorkflow[];
  readonly baseKnowledge: readonly KnowledgeRetrievalResult[];
  readonly targetKnowledge: readonly KnowledgeRetrievalResult[];
}

export interface CompareRepositoryRevisionsInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly baseRevision: string;
  readonly targetRevision: string;
  readonly comparisonTimestamp?: string;
}

export interface EvolutionNavigationQuery {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly baseRevision?: string;
  readonly targetRevision?: string;
  readonly kind?: EvolutionTimelineKind;
  readonly entityId?: string;
  readonly limit?: number;
}

export interface RepositoryEvolutionMetrics {
  readonly comparisons: number;
  readonly timelines: number;
  readonly trends: number;
  readonly reuseRate: number;
  readonly recoveryCount: number;
  readonly averageComparisonLatencyMs: number;
}

export class RepositoryEvolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryEvolutionError";
  }
}
