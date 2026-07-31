/** Stable TypeScript entry point for frontend-facing backend contracts. */
export type {
  PublicRepositoryMetadata,
  RepositoryMetadataLifecycle,
} from "../repositoryMetadataApi/contracts.js";
export type {
  PublicRepositorySession,
  PublicRepositorySessionDiagnostic,
  PublicRepositorySessionRecord,
  PublicRepositorySessionSummary,
  RepositorySessionApiFailure,
  RepositorySessionApiSuccess,
} from "../repositorySessionApi/contracts.js";
export type {
  RepositoryGatewayDiagnostic,
  RepositoryGatewayResponse,
  RepositoryGatewayService,
  RepositoryGatewayStatus,
  RepositoryGatewayTimestamps,
} from "../repositoryApiGateway/types.js";
export type { PublicWorkflowResource } from "./service.js";

export interface RevisionFencedRequest {
  readonly revision: string;
}

export interface RepositoryQueryRequest extends RevisionFencedRequest {
  readonly query: string;
  readonly workflowId?: string;
  readonly sessionId?: string;
}

export interface InsightRequest extends RevisionFencedRequest {
  readonly filters?: Readonly<{
    limit?: number;
    featureId?: string;
    module?: string;
    file?: string;
    category?: "architectural hotspots" | "duplicated logic" |
      "dependency issues" | "documentation issues";
  }>;
}

export interface FeatureNavigationRequest extends RevisionFencedRequest {
  readonly operation: "feature" | "entry-points" | "exit-points" |
    "files" | "symbols" | "dependencies" | "upstream" | "downstream";
  readonly name: string;
}

export interface SemanticNavigationRequest extends RevisionFencedRequest {
  readonly operation: "definition" | "references" | "implementations" |
    "callers" | "callees" | "inheritance" | "dependencies";
  readonly query: string;
}

export interface ChangeImpactRequest extends RevisionFencedRequest {
  readonly workflowId: string;
  readonly target: Readonly<{
    kind: "feature" | "module" | "file" | "symbol" | "api_endpoint" |
      "route" | "service" | "repository_component";
    value: string;
  }>;
  readonly changeType: "add" | "modify" | "remove" | "refactor" |
    "fix" | "migrate";
  readonly rationale: string;
}

export interface TaskPlanRequest extends RevisionFencedRequest {
  readonly objective: string;
  readonly workflowId?: string;
}

export interface SpecificationRequest extends RevisionFencedRequest {
  readonly objective: string;
  readonly taskId?: string;
  readonly workflowId?: string;
}

export interface ExecutionRequest extends RevisionFencedRequest {
  readonly objective: string;
  readonly workflowId: string;
}

export interface EvolutionRequest extends RevisionFencedRequest {
  readonly baseRevision: string;
}

export interface FileTreeRequest { readonly repositoryId: string }
export interface FileReadRequest {
  readonly repositoryId: string;
  readonly relativePath: string;
}
export interface SymbolLookupRequest {
  readonly repositoryId: string;
  readonly symbol: string;
}
export interface GrepRequest {
  readonly repositoryId: string;
  readonly query: string;
}

export type RepositoryQueryResponse = Readonly<Record<string, unknown>>;
export type InsightResponse = Readonly<Record<string, unknown>>;
export type FeatureNavigationResponse = Readonly<Record<string, unknown>>;
export type SemanticNavigationResponse = Readonly<Record<string, unknown>>;
export type ChangeImpactResponse = Readonly<Record<string, unknown>>;
export type TaskPlanResponse = Readonly<Record<string, unknown>>;
export type SpecificationResponse = Readonly<Record<string, unknown>>;
export type ExecutionResponse = Readonly<Record<string, unknown>>;
export type EvolutionResponse = Readonly<Record<string, unknown>>;
