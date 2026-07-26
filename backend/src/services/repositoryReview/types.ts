import type {
  ArtifactExecutionMetadata,
  ImmutableGenerationSource,
  RepositoryArtifact,
} from "../repositoryArtifact/types.js";
import type {
  RepositoryPatch,
  RepositoryWorkspace,
  WorkspaceSnapshot,
} from "../repositoryWorkspace/types.js";

export const REPOSITORY_REVIEW_ENGINE_VERSION = "repository-review-engine-v1";
export const REPOSITORY_REVIEW_SCHEMA_VERSION = "repository-review-schema-v1";
export const REPOSITORY_REVIEW_OUTPUT_SCHEMA_VERSION =
  "repository-review-output-v1";

export type ReviewLifecycle =
  | "created"
  | "validating"
  | "awaiting_decision"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "archived"
  | "expired";

export type ReviewerType = "human" | "agent" | "system";
export type ReviewVerdict = "approved" | "changes_requested" | "rejected";
export type FindingSeverity = "info" | "warning" | "error" | "blocker";
export type QualityGateCategory =
  | "schema_correctness"
  | "ownership"
  | "lifecycle"
  | "version_fencing"
  | "artifact_completeness"
  | "patch_consistency"
  | "dependency_consistency"
  | "symbol_consistency"
  | "path_safety"
  | "quota_validation";

export interface ReviewDependency {
  readonly fromFile: string;
  readonly toFile: string;
  readonly blocking: boolean;
}

export interface ReviewSymbol {
  readonly filePath: string;
  readonly symbol: string;
}

export interface ReviewRepositoryGraph extends ImmutableGenerationSource {
  readonly dependencies: readonly ReviewDependency[];
  readonly symbols: readonly ReviewSymbol[];
}

export interface ReviewIntelligence extends ImmutableGenerationSource {
  readonly knownFiles: readonly string[];
  readonly knownSymbols: readonly ReviewSymbol[];
}

export interface ReviewPlanning extends ImmutableGenerationSource {
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly ReviewSymbol[];
  readonly dependencies: readonly ReviewDependency[];
}

export interface ReviewFinding {
  readonly findingId: string;
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly severity: FindingSeverity;
  readonly category: QualityGateCategory;
  readonly affectedFile: string | null;
  readonly affectedSymbol: string | null;
  readonly explanation: string;
  readonly recommendation: string;
  readonly createdAt: string;
}

export interface ReviewDiagnostic {
  readonly diagnosticId: string;
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly code: string;
  readonly message: string;
  readonly severity: "warning" | "error";
  readonly createdAt: string;
}

export interface ReviewOutputMetrics {
  readonly gateCount: number;
  readonly passedGateCount: number;
  readonly infoCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly blockerCount: number;
}

export interface ReviewMetadata {
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly deterministicSeed: string;
  readonly artifactVersion: number;
  readonly artifactContentHash: string;
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly patchVersion: number;
  readonly patchHash: string;
  readonly graphVersion: string;
  readonly intelligenceVersion: string;
  readonly planningVersion: string;
  readonly executionVersion: string;
  readonly validatedAt: string;
  readonly validationLatencyMs: number;
}

export interface ReviewVersion {
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly artifactVersion: number;
  readonly outputHash: string;
  readonly verdict: ReviewVerdict;
  readonly confidence: number;
  readonly findings: readonly ReviewFinding[];
  readonly diagnostics: readonly ReviewDiagnostic[];
  readonly metrics: ReviewOutputMetrics;
  readonly reviewMetadata: ReviewMetadata;
  readonly createdAt: string;
  readonly validatedAt: string;
}

export interface ReviewDecision {
  readonly decisionId: string;
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly ownerId: string;
  readonly reviewerId: string;
  readonly verdict: ReviewVerdict;
  readonly rationaleCodes: readonly string[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface ReviewLifecycleEvent {
  readonly eventId: string;
  readonly reviewVersion: number;
  readonly from: ReviewLifecycle | null;
  readonly to: ReviewLifecycle;
  readonly reason: string;
  readonly createdAt: string;
}

export interface ReviewRecoveryRecord {
  readonly recoveryId: string;
  readonly reason:
    | "abandoned_review"
    | "incomplete_validation"
    | "expired_review_lease"
    | "orphan_findings";
  readonly previousLifecycle: ReviewLifecycle;
  readonly recoveredLifecycle: ReviewLifecycle;
  readonly orphanFindingIds: readonly string[];
  readonly createdAt: string;
}

export interface ReviewArchiveMetadata {
  readonly archivedAt: string;
  readonly reason: "manual" | "retention" | "artifact_terminal";
  readonly finalReviewVersion: number;
  readonly outputHash: string;
}

export interface RepositoryReview {
  readonly reviewId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly executionId: string;
  readonly workUnitId: string;
  readonly ownerId: string;
  readonly reviewerType: ReviewerType;
  readonly reviewVersion: number;
  readonly lifecycle: ReviewLifecycle;
  readonly versions: readonly ReviewVersion[];
  readonly findings: readonly ReviewFinding[];
  readonly diagnostics: readonly ReviewDiagnostic[];
  readonly decisions: readonly ReviewDecision[];
  readonly lifecycleHistory: readonly ReviewLifecycleEvent[];
  readonly recoveryHistory: readonly ReviewRecoveryRecord[];
  readonly archiveMetadata: ReviewArchiveMetadata | null;
  readonly validationFailureCount: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly decisionRequestedAt: string | null;
  readonly reviewLeaseExpiresAt: string | null;
}

export interface CreateReviewInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly executionOwnerId: string;
  readonly reviewerType: ReviewerType;
  readonly baseReviewVersion: number;
  readonly artifact: RepositoryArtifact;
  readonly workspace: RepositoryWorkspace;
  readonly snapshot: WorkspaceSnapshot;
  readonly patch: RepositoryPatch;
  readonly repositoryGraph: ReviewRepositoryGraph;
  readonly intelligence: ReviewIntelligence;
  readonly planning: ReviewPlanning;
  readonly executionMetadata: ArtifactExecutionMetadata;
  readonly reviewLeaseExpiresAt?: string;
}

export interface DecideReviewInput {
  readonly tenantId: string;
  readonly reviewId: string;
  readonly ownerId: string;
  readonly reviewerId: string;
  readonly reviewVersion: number;
  readonly verdict: ReviewVerdict;
  readonly rationaleCodes: readonly string[];
  readonly idempotencyKey: string;
}

export interface ReviewQuotas {
  readonly reviewsPerArtifact: number;
  readonly versionsPerReview: number;
  readonly operationsPerReview: number;
  readonly findingsPerReview: number;
  readonly diagnosticsPerReview: number;
  readonly reviewBytes: number;
  readonly retainedReviews: number;
  readonly retainedVersions: number;
  readonly retainedFindings: number;
  readonly validationTimeoutMs: number;
  readonly reviewTtlMs: number;
}

export interface ReviewMetrics {
  readonly reviewsCreated: number;
  readonly approvals: number;
  readonly rejections: number;
  readonly validationFailures: number;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly reviewLatencyMs: number;
  readonly recoveryCount: number;
}

export class RepositoryReviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryReviewError";
  }
}
