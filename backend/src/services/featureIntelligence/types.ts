import type {
  RepositoryIntelligenceRecord,
} from "../repositoryIntelligence/types.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";

export const FEATURE_INTELLIGENCE_ENGINE_VERSION = "feature-intelligence-v1";
export const FEATURE_INTELLIGENCE_SCHEMA_VERSION = "feature-graph-v1";

export type FeatureLifecycle = "active" | "partial" | "deprecated";
export type FeatureGraphLifecycle =
  | "building" | "validating" | "published" | "failed" | "superseded";
export type FeatureRelationshipKind =
  | "depends_on_feature"
  | "owns_module"
  | "calls_feature"
  | "shares_components"
  | "exposes_endpoint";
export type FeatureFlowStepKind =
  | "http_route" | "controller" | "service" | "repository"
  | "database" | "response" | "symbol";

export interface FeatureRecord {
  readonly featureId: string;
  readonly graphVersion: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly name: string;
  readonly description: string;
  readonly confidence: number;
  readonly primaryEntryPoint: string;
  readonly primaryExitPoint: string;
  readonly entryPoints: readonly string[];
  readonly exitPoints: readonly string[];
  readonly owningModules: readonly string[];
  readonly files: readonly string[];
  readonly symbolIds: readonly string[];
  readonly lifecycle: FeatureLifecycle;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FeatureRelationship {
  readonly relationshipId: string;
  readonly graphVersion: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly fromFeatureId: string;
  readonly toFeatureId: string | null;
  readonly kind: FeatureRelationshipKind;
  readonly target: string;
  readonly createdAt: string;
}

export interface FeatureFlowStep {
  readonly position: number;
  readonly kind: FeatureFlowStepKind;
  readonly symbolId: string | null;
  readonly file: string;
  readonly label: string;
}

export interface FeatureFlow {
  readonly flowId: string;
  readonly graphVersion: string;
  readonly featureId: string;
  readonly entryPoint: string;
  readonly exitPoint: string;
  readonly steps: readonly FeatureFlowStep[];
  readonly createdAt: string;
}

export interface FeatureDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly featureId?: string;
  readonly file?: string;
  readonly severity: "info" | "warning" | "error";
}

export interface FeatureMetrics {
  readonly featuresDiscovered: number;
  readonly averageFeatureSize: number;
  readonly dependencyDensity: number;
  readonly rebuildDurationMs: number;
  readonly incrementalRebuildCount: number;
  readonly recoveryCount: number;
}

export interface FeatureGraph {
  readonly graphVersion: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly repositoryIntelligenceVersion: string;
  readonly semanticGraphVersion: string;
  readonly lifecycle: FeatureGraphLifecycle;
  readonly features: readonly FeatureRecord[];
  readonly relationships: readonly FeatureRelationship[];
  readonly flows: readonly FeatureFlow[];
  readonly diagnostics: readonly FeatureDiagnostic[];
  readonly metrics: FeatureMetrics;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface BuildFeatureGraphInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly repositoryIntelligence: RepositoryIntelligenceRecord;
  readonly semanticGraph: SemanticGraph;
  readonly previousGraph?: FeatureGraph | null;
  readonly changedFiles?: readonly string[];
  readonly indexedAt?: string;
}

export interface FeatureNavigationResult {
  readonly feature: FeatureRecord | null;
  readonly features: readonly FeatureRecord[];
  readonly relationships: readonly FeatureRelationship[];
  readonly flows: readonly FeatureFlow[];
}

export interface FeatureChangeImpact {
  readonly query: { readonly file?: string; readonly symbolId?: string; readonly module?: string };
  readonly affectedFeatures: readonly FeatureRecord[];
  readonly dependencyChain: readonly FeatureRelationship[];
  readonly impactedEntryPoints: readonly string[];
  readonly downstreamRisk: {
    readonly level: "low" | "medium" | "high";
    readonly impactedFeatureCount: number;
    readonly downstreamFeatureCount: number;
    readonly reason: string;
  };
}

export class FeatureIntelligenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "FeatureIntelligenceError";
  }
}
