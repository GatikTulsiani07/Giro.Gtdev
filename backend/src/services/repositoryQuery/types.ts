import type { ChangeAnalysis } from "../changeIntelligence/types.js";
import type { FeatureFlow, FeatureRecord, FeatureRelationship } from "../featureIntelligence/types.js";
import type { KnowledgeRetrievalResult } from "../repositoryKnowledge/types.js";
import type { RepositoryIntelligenceSnapshot, RepositorySubsystemSummary } from "../repositoryIntelligence/types.js";
import type { SemanticRelationship, SemanticSymbol } from "../semanticCodeIntelligence/types.js";

export const REPOSITORY_QUERY_ENGINE_VERSION = "repository-query-engine-v1";
export const REPOSITORY_QUERY_SCHEMA_VERSION = "repository-query-schema-v1";

export const QUERY_INTENTS = [
  "architecture", "feature", "semantic", "symbol", "dependency",
  "implementation", "navigation", "change impact", "workflow", "knowledge",
  "repository overview",
] as const;
export type QueryIntent = (typeof QUERY_INTENTS)[number];

export const QUERY_ENGINES = [
  "Repository Intelligence", "Semantic Code Intelligence",
  "Feature Intelligence", "Change Intelligence", "Repository Knowledge",
  "Workflow Orchestrator",
] as const;
export type QueryEngineName = (typeof QUERY_ENGINES)[number];
export type QueryLifecycle = "planning" | "running" | "completed" | "partial" | "failed";
export type QueryContextKind =
  "repository" | "feature" | "symbol" | "file" | "module" | "API" | "workflow" | "knowledge";

export interface RepositoryQueryInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly query: string;
  readonly workflowId?: string;
  readonly sessionId?: string;
  readonly requestedAt?: string;
}

export interface RepositoryQuery {
  readonly queryId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly workflowId: string | null;
  readonly sessionId: string | null;
  readonly userId: string;
  readonly originalQuery: string;
  readonly normalizedQuery: string;
  readonly intents: readonly QueryIntent[];
  readonly confidence: number;
  readonly lifecycle: QueryLifecycle;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface QueryContextSelector {
  readonly kind: QueryContextKind;
  readonly value: string;
}

export interface QueryPlanStep {
  readonly position: number;
  readonly engine: QueryEngineName;
  readonly required: boolean;
  readonly reason: string;
}

export interface RepositoryQueryPlan {
  readonly planId: string;
  readonly queryId: string;
  readonly steps: readonly QueryPlanStep[];
  readonly selectors: readonly QueryContextSelector[];
}

export interface QueryDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly engine?: QueryEngineName;
}

export interface RepositoryQueryResponse {
  readonly queryId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly intents: readonly QueryIntent[];
  readonly summary?: string;
  readonly architecture?: {
    readonly overview: RepositoryIntelligenceSnapshot["architecture"];
    readonly subsystems: readonly RepositorySubsystemSummary[];
  };
  readonly relatedFeatures?: readonly FeatureRecord[];
  readonly relevantFiles?: readonly string[];
  readonly relevantSymbols?: readonly SemanticSymbol[];
  readonly dependencyGraph?: {
    readonly semantic: readonly SemanticRelationship[];
    readonly features: readonly FeatureRelationship[];
  };
  readonly featureFlow?: readonly FeatureFlow[];
  readonly changeImpact?: Pick<ChangeAnalysis, "impact" | "risk">;
  readonly implementationRoadmap?: ChangeAnalysis["implementationPlan"];
  readonly knowledgeReferences?: readonly KnowledgeRetrievalResult[];
  readonly workflow?: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly diagnostics?: readonly QueryDiagnostic[];
}

export interface RepositoryQueryExecution {
  readonly query: RepositoryQuery;
  readonly plan: RepositoryQueryPlan;
  readonly response: RepositoryQueryResponse | null;
  readonly diagnostics: readonly QueryDiagnostic[];
  readonly cacheHit: boolean;
  readonly engineUsage: readonly QueryEngineName[];
  readonly latencyMs: number;
}

export interface RepositoryQueryMetrics {
  readonly queries: number;
  readonly cacheHits: number;
  readonly averageLatencyMs: number;
  readonly engineUsage: Readonly<Record<QueryEngineName, number>>;
  readonly intentDistribution: Readonly<Record<QueryIntent, number>>;
  readonly confidenceDistribution: Readonly<{ low: number; medium: number; high: number }>;
  readonly recoveryCount: number;
}

export class RepositoryQueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryQueryError";
  }
}
