import type {
  RepositoryPatch,
  RepositoryWorkspace,
  WorkspaceSnapshot,
} from "../repositoryWorkspace/types.js";

export const REPOSITORY_ARTIFACT_ENGINE_VERSION = "repository-artifact-engine-v1";
export const REPOSITORY_ARTIFACT_SCHEMA_VERSION = "repository-artifact-schema-v1";
export const REPOSITORY_ARTIFACT_CONTENT_SCHEMA_VERSION =
  "repository-artifact-content-v1";

export type ArtifactType =
  | "source_code"
  | "unit_tests"
  | "integration_tests"
  | "documentation"
  | "configuration"
  | "migration_proposal"
  | "api_contract_update"
  | "refactoring_proposal";

export type ArtifactLifecycle =
  | "created"
  | "generating"
  | "generated"
  | "validated"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "archived"
  | "expired";

export interface ImmutableGenerationSource {
  readonly version: string;
  readonly contentHash: string;
  readonly published: true;
}

export interface ArtifactExecutionMetadata {
  readonly executionId: string;
  readonly workUnitId: string;
  readonly ownerId: string;
  readonly executionVersion: string;
}

export interface ArtifactWorkspaceMetadata {
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly lifecycle: RepositoryWorkspace["lifecycle"];
  readonly snapshotVersion: string;
  readonly patchVersion: number;
}

export interface ArtifactContentOperation {
  readonly operation: string;
  readonly path: string;
  readonly destinationPath?: string;
  readonly symbol?: string;
  readonly content?: string;
  readonly expectedHash?: string;
}

export interface StructuredArtifactContent {
  readonly schemaVersion: string;
  readonly proposalOnly: true;
  readonly artifactType: ArtifactType;
  readonly operations: readonly ArtifactContentOperation[];
  readonly sourceHashes: Readonly<{
    snapshot: string;
    patch: string;
    graph: string;
    intelligence: string;
    planning: string;
  }>;
}

export type ArtifactDiagnosticSeverity =
  | "warning"
  | "blocker"
  | "validation_finding";

export interface ArtifactDiagnostic {
  readonly diagnosticId: string;
  readonly severity: ArtifactDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly createdAt: string;
}

export interface ArtifactGenerationMetadata {
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly deterministicSeed: string;
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly patchVersion: number;
  readonly patchHash: string;
  readonly graphVersion: string;
  readonly intelligenceVersion: string;
  readonly planningVersion: string;
  readonly executionVersion: string;
  readonly generatedAt: string;
  readonly generationLatencyMs: number;
}

export interface ArtifactVersion {
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly contentHash: string;
  readonly structuredContent: StructuredArtifactContent;
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly diagnostics: readonly ArtifactDiagnostic[];
  readonly confidence: number;
  readonly warnings: readonly string[];
  readonly generationMetadata: ArtifactGenerationMetadata;
  readonly createdAt: string;
  readonly generatedAt: string;
  readonly validatedAt: string;
}

export interface ArtifactLifecycleEvent {
  readonly eventId: string;
  readonly artifactVersion: number;
  readonly from: ArtifactLifecycle | null;
  readonly to: ArtifactLifecycle;
  readonly reason: string;
  readonly createdAt: string;
}

export interface ArtifactApproval {
  readonly approvalId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly ownerId: string;
  readonly reviewerId: string;
  readonly decision: "approved" | "rejected";
  readonly findings: readonly string[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface ArtifactRecoveryRecord {
  readonly recoveryId: string;
  readonly reason:
    | "abandoned_generation"
    | "incomplete_artifact"
    | "stale_workspace"
    | "expired_lease";
  readonly previousLifecycle: ArtifactLifecycle;
  readonly recoveredLifecycle: ArtifactLifecycle;
  readonly createdAt: string;
}

export interface ArtifactArchiveMetadata {
  readonly archivedAt: string;
  readonly reason: "retention" | "manual" | "workspace_terminal";
  readonly finalArtifactVersion: number;
  readonly contentHash: string;
}

export interface RepositoryArtifact {
  readonly artifactId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly workspaceId: string;
  readonly executionId: string;
  readonly workUnitId: string;
  readonly ownerId: string;
  readonly artifactType: ArtifactType;
  readonly artifactVersion: number;
  readonly lifecycle: ArtifactLifecycle;
  readonly versions: readonly ArtifactVersion[];
  readonly diagnostics: readonly ArtifactDiagnostic[];
  readonly approvals: readonly ArtifactApproval[];
  readonly lifecycleHistory: readonly ArtifactLifecycleEvent[];
  readonly recoveryHistory: readonly ArtifactRecoveryRecord[];
  readonly archiveMetadata: ArtifactArchiveMetadata | null;
  readonly validationFailureCount: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly reviewRequestedAt: string | null;
  readonly generationLeaseExpiresAt: string | null;
}

export interface GenerateArtifactInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly executionOwnerId: string;
  readonly artifactType: ArtifactType;
  readonly baseArtifactVersion: number;
  readonly workspace: RepositoryWorkspace;
  readonly snapshot: WorkspaceSnapshot;
  readonly patch: RepositoryPatch;
  readonly repositoryGraph: ImmutableGenerationSource;
  readonly intelligence: ImmutableGenerationSource;
  readonly planning: ImmutableGenerationSource;
  readonly executionMetadata: ArtifactExecutionMetadata;
  readonly workspaceMetadata: ArtifactWorkspaceMetadata;
  readonly leaseExpiresAt?: string;
}

export interface ReviewArtifactInput {
  readonly tenantId: string;
  readonly artifactId: string;
  readonly ownerId: string;
  readonly reviewerId: string;
  readonly artifactVersion: number;
  readonly decision: "approved" | "rejected";
  readonly findings: readonly string[];
  readonly idempotencyKey: string;
}

export interface ArtifactQuotas {
  readonly artifactsPerWorkspace: number;
  readonly versionsPerArtifact: number;
  readonly artifactBytes: number;
  readonly operationsPerArtifact: number;
  readonly diagnosticsPerArtifact: number;
  readonly retainedArtifacts: number;
  readonly retainedVersions: number;
  readonly retainedDiagnostics: number;
  readonly generationTimeoutMs: number;
  readonly artifactTtlMs: number;
}

export interface ArtifactMetrics {
  readonly artifactsGenerated: number;
  readonly generationLatencyMs: number;
  readonly validationFailures: number;
  readonly recoveryCount: number;
  readonly retentionCount: number;
  readonly approvalWaitTimeMs: number;
}

export class RepositoryArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryArtifactError";
  }
}
