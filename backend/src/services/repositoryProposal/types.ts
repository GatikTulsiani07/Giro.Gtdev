import type {
  ArtifactExecutionMetadata,
  RepositoryArtifact,
} from "../repositoryArtifact/types.js";
import type { RepositoryReview } from "../repositoryReview/types.js";
import type {
  RepositoryPatch,
  RepositoryWorkspace,
} from "../repositoryWorkspace/types.js";

export const REPOSITORY_PROPOSAL_ENGINE_VERSION =
  "repository-proposal-engine-v1";
export const REPOSITORY_PROPOSAL_SCHEMA_VERSION =
  "repository-proposal-schema-v1";
export const REPOSITORY_PROPOSAL_OUTPUT_SCHEMA_VERSION =
  "repository-proposal-output-v1";

export type ProposalLifecycle =
  | "created"
  | "assembling"
  | "validating"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "archived"
  | "expired";

export type ProposalVerdict = "approved" | "rejected";
export type ProposalValidationCategory =
  | "ownership"
  | "lifecycle"
  | "version_fencing"
  | "completeness"
  | "artifact_approval"
  | "review_approval"
  | "manifest_consistency"
  | "quota_validation";

export interface ManifestChangedFile {
  readonly path: string;
  readonly operations: readonly string[];
  readonly artifactIds: readonly string[];
  readonly patchVersions: readonly number[];
}

export interface ManifestChangedSymbol {
  readonly filePath: string;
  readonly symbol: string;
  readonly artifactIds: readonly string[];
}

export interface ManifestPatchSummary {
  readonly patchId: string;
  readonly patchVersion: number;
  readonly contentHash: string;
  readonly operationCount: number;
  readonly affectedFiles: readonly string[];
}

export interface ManifestReviewSummary {
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly artifactId: string;
  readonly verdict: "approved";
  readonly confidence: number;
  readonly findingCount: number;
}

export interface ProposalDiagnostic {
  readonly diagnosticId: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly sourceType: "artifact" | "review" | "patch" | "assembly";
  readonly sourceId: string;
  readonly createdAt: string;
}

export interface ProposalValidationFinding {
  readonly category: ProposalValidationCategory;
  readonly passed: boolean;
  readonly codes: readonly string[];
}

export interface ProposalValidationSummary {
  readonly valid: boolean;
  readonly gateCount: number;
  readonly passedGateCount: number;
  readonly findings: readonly ProposalValidationFinding[];
}

export interface ChangeManifest {
  readonly schemaVersion: string;
  readonly changedFiles: readonly ManifestChangedFile[];
  readonly changedSymbols: readonly ManifestChangedSymbol[];
  readonly patchSummaries: readonly ManifestPatchSummary[];
  readonly reviewSummaries: readonly ManifestReviewSummary[];
  readonly diagnostics: readonly ProposalDiagnostic[];
  readonly confidence: number;
  readonly risks: readonly string[];
  readonly affectedComponents: readonly string[];
  readonly validationSummary: ProposalValidationSummary;
}

export interface ProposalOutputMetrics {
  readonly artifactCount: number;
  readonly reviewCount: number;
  readonly patchCount: number;
  readonly changedFileCount: number;
  readonly changedSymbolCount: number;
  readonly diagnosticCount: number;
  readonly manifestBytes: number;
}

export interface ProposalAssemblyMetadata {
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly deterministicSeed: string;
  readonly repositoryRevision: string;
  readonly executionVersion: string;
  readonly workspacePersistenceVersion: number;
  readonly artifactVersions: readonly Readonly<{
    artifactId: string;
    artifactVersion: number;
    contentHash: string;
  }>[];
  readonly reviewVersions: readonly Readonly<{
    reviewId: string;
    reviewVersion: number;
    outputHash: string;
  }>[];
  readonly patchVersions: readonly Readonly<{
    patchId: string;
    patchVersion: number;
    contentHash: string;
  }>[];
  readonly assembledAt: string;
  readonly assemblyLatencyMs: number;
}

export interface ProposalVersion {
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly outputHash: string;
  readonly title: string;
  readonly summary: string;
  readonly detailedDescription: string;
  readonly manifest: ChangeManifest;
  readonly reviewReferences: readonly string[];
  readonly artifactReferences: readonly string[];
  readonly diagnostics: readonly ProposalDiagnostic[];
  readonly metrics: ProposalOutputMetrics;
  readonly assemblyMetadata: ProposalAssemblyMetadata;
  readonly createdAt: string;
  readonly assembledAt: string;
  readonly validatedAt: string;
}

export interface ProposalDecision {
  readonly decisionId: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly ownerId: string;
  readonly reviewerId: string;
  readonly verdict: ProposalVerdict;
  readonly rationaleCodes: readonly string[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface ProposalLifecycleEvent {
  readonly eventId: string;
  readonly proposalVersion: number;
  readonly from: ProposalLifecycle | null;
  readonly to: ProposalLifecycle;
  readonly reason: string;
  readonly createdAt: string;
}

export interface ProposalRecoveryRecord {
  readonly recoveryId: string;
  readonly reason:
    | "incomplete_assembly"
    | "stale_proposal_version"
    | "abandoned_proposal_creation";
  readonly previousLifecycle: ProposalLifecycle;
  readonly recoveredLifecycle: "expired";
  readonly createdAt: string;
}

export interface ProposalArchiveMetadata {
  readonly archivedAt: string;
  readonly reason: "manual" | "retention" | "workspace_terminal";
  readonly finalProposalVersion: number;
  readonly outputHash: string;
}

export interface RepositoryProposal {
  readonly proposalId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly proposalVersion: number;
  readonly lifecycle: ProposalLifecycle;
  readonly versions: readonly ProposalVersion[];
  readonly diagnostics: readonly ProposalDiagnostic[];
  readonly decisions: readonly ProposalDecision[];
  readonly lifecycleHistory: readonly ProposalLifecycleEvent[];
  readonly recoveryHistory: readonly ProposalRecoveryRecord[];
  readonly archiveMetadata: ProposalArchiveMetadata | null;
  readonly validationFailureCount: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly reviewRequestedAt: string | null;
  readonly assemblyLeaseExpiresAt: string | null;
}

export interface AssembleProposalInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly executionOwnerId: string;
  readonly baseProposalVersion: number;
  readonly workspace: RepositoryWorkspace;
  readonly artifacts: readonly RepositoryArtifact[];
  readonly patches: readonly RepositoryPatch[];
  readonly reviews: readonly RepositoryReview[];
  readonly executionMetadata: ArtifactExecutionMetadata;
  readonly assemblyLeaseExpiresAt?: string;
}

export interface DecideProposalInput {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly ownerId: string;
  readonly reviewerId: string;
  readonly proposalVersion: number;
  readonly verdict: ProposalVerdict;
  readonly rationaleCodes: readonly string[];
  readonly idempotencyKey: string;
}

export interface ProposalQuotas {
  readonly proposalsPerWorkspace: number;
  readonly versionsPerProposal: number;
  readonly artifactsPerProposal: number;
  readonly reviewsPerProposal: number;
  readonly patchesPerProposal: number;
  readonly filesPerManifest: number;
  readonly symbolsPerManifest: number;
  readonly diagnosticsPerProposal: number;
  readonly manifestBytes: number;
  readonly retainedProposals: number;
  readonly retainedVersions: number;
  readonly retainedDiagnostics: number;
  readonly assemblyTimeoutMs: number;
  readonly proposalTtlMs: number;
}

export interface ProposalMetrics {
  readonly proposalsAssembled: number;
  readonly validationFailures: number;
  readonly rejectedProposals: number;
  readonly manifestSize: number;
  readonly diagnosticsCount: number;
  readonly assemblyLatencyMs: number;
  readonly recoveryCount: number;
}

export class RepositoryProposalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryProposalError";
  }
}
