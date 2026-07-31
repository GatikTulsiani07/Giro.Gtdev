export const REPOSITORY_API_GATEWAY_SCHEMA_VERSION =
  "repository-api-gateway-schema-v1";

export const REPOSITORY_GATEWAY_SERVICES = [
  "repository-overview",
  "repository-query",
  "repository-insights",
  "feature-navigation",
  "semantic-navigation",
  "change-impact",
  "task-planning",
  "engineering-specification",
  "execution-coordination",
  "repository-evolution",
] as const;

export type RepositoryGatewayService =
  (typeof REPOSITORY_GATEWAY_SERVICES)[number];
export type RepositoryGatewayStatus = "ok" | "partial" | "error";

export interface RepositoryGatewayDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly service?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RepositoryGatewayTimestamps {
  readonly receivedAt: string;
  readonly completedAt: string;
}

export interface RepositoryGatewayResponse<T = unknown> {
  readonly requestId: string;
  readonly repositoryId: string;
  readonly revision: string;
  readonly service: RepositoryGatewayService;
  readonly status: RepositoryGatewayStatus;
  readonly payload: T | null;
  readonly diagnostics: readonly RepositoryGatewayDiagnostic[];
  readonly timestamps: RepositoryGatewayTimestamps;
}

export interface RepositoryGatewayRequest {
  readonly requestId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly revision: string;
  readonly service: RepositoryGatewayService;
  readonly input: Readonly<Record<string, unknown>>;
  readonly receivedAt?: string;
}

export interface RepositoryGatewayCacheRecord {
  readonly cacheKey: string;
  readonly schemaVersion: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly ownershipFingerprint: string;
  readonly service: RepositoryGatewayService;
  readonly requestFingerprint: string;
  readonly status: Exclude<RepositoryGatewayStatus, "error">;
  readonly payload: unknown;
  readonly diagnostics: readonly RepositoryGatewayDiagnostic[];
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly hitCount: number;
}

export interface RepositoryGatewayMetricSample {
  readonly ownerId: string;
  readonly endpoint: RepositoryGatewayService;
  readonly service: RepositoryGatewayService;
  readonly latencyMs: number;
  readonly cacheHit: boolean;
  readonly failed: boolean;
}

export interface RepositoryGatewayMetrics {
  readonly endpointUsage: Readonly<Record<string, number>>;
  readonly serviceDistribution: Readonly<Record<string, number>>;
  readonly totalLatencyMs: number;
  readonly cacheHits: number;
  readonly failures: number;
}

export type RepositoryGatewayErrorCode =
  | "gateway_validation_failed"
  | "gateway_authorization_failed"
  | "gateway_stale_revision"
  | "gateway_intelligence_unavailable"
  | "gateway_partial_orchestration_failure"
  | "gateway_rate_limited"
  | "gateway_dependency_unavailable";

export class RepositoryGatewayError extends Error {
  constructor(
    readonly code: RepositoryGatewayErrorCode,
    message: string,
    readonly httpStatus: 400 | 403 | 409 | 424 | 503,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryGatewayError";
  }
}
