export const REPOSITORY_SESSION_SCHEMA_VERSION =
  "repository-session-schema-v1";
export const REPOSITORY_SESSION_ENGINE_VERSION =
  "repository-session-engine-v1";

export type RepositorySessionLifecycle =
  "active" | "interrupted" | "stale" | "recovered" | "archived";
export type RepositorySessionEventKind =
  | "query" | "answer" | "feature" | "symbol" | "file" | "insight"
  | "plan" | "specification" | "execution_summary";

export interface RepositorySession {
  readonly sessionId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly ownerId: string;
  readonly userId: string;
  readonly workflowId: string | null;
  readonly workflowAttachedAt?: string | null;
  readonly lifecycle: RepositorySessionLifecycle;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly archivedAt: string | null;
}

export interface RepositorySessionEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly kind: RepositorySessionEventKind;
  readonly referenceId: string;
  readonly summary: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface RepositorySessionContext {
  readonly sessionId: string;
  readonly contextVersion: number;
  readonly activeFeature: string | null;
  readonly activeModule: string | null;
  readonly activeWorkflow: string | null;
  readonly activeArchitecture: string | null;
  readonly activeChangeAnalysis: string | null;
  readonly previousQuestions: readonly string[];
  readonly previousAnswers: readonly string[];
  readonly recentFiles: readonly string[];
  readonly recentSymbols: readonly string[];
  readonly recentFeatures: readonly string[];
  readonly viewedInsights: readonly string[];
  readonly viewedPlans: readonly string[];
  readonly viewedSpecifications: readonly string[];
  readonly viewedExecutionSummaries: readonly string[];
  readonly updatedAt: string;
}

export interface RepositorySessionDiagnostic {
  readonly diagnosticId: string;
  readonly sessionId: string;
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly createdAt: string;
}

export interface RepositorySessionRecord {
  readonly session: RepositorySession;
  readonly events: readonly RepositorySessionEvent[];
  readonly context: RepositorySessionContext;
  readonly diagnostics: readonly RepositorySessionDiagnostic[];
  readonly reuseCount: number;
  readonly recoveryCount: number;
}

export interface CreateRepositorySessionInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly userId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly workflowId?: string;
  readonly requestedAt?: string;
}

export interface RepositorySessionViewInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly kind: Extract<
    RepositorySessionEventKind,
    "feature" | "symbol" | "file" | "insight" | "plan" |
    "specification" | "execution_summary"
  >;
  readonly referenceId: string;
  readonly summary?: string;
  readonly module?: string;
  readonly architecture?: string;
  readonly changeAnalysis?: string;
}

export interface RepositorySessionLimits {
  readonly maximumHistory: number;
  readonly expirationMs: number;
}

export interface RepositorySessionMetrics {
  readonly activeSessions: number;
  readonly averageSessionDurationMs: number;
  readonly averageContextSize: number;
  readonly recoveryCount: number;
  readonly sessionReuse: number;
}

export class RepositorySessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositorySessionError";
  }
}
