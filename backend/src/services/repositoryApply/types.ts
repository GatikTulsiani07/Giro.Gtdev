import type {
  ArtifactExecutionMetadata,
  RepositoryArtifact,
} from "../repositoryArtifact/types.js";
import type { RepositoryProposal } from "../repositoryProposal/types.js";
import type {
  RepositoryPatch,
  RepositoryWorkspace,
} from "../repositoryWorkspace/types.js";

export const REPOSITORY_APPLY_ENGINE_VERSION = "repository-apply-engine-v1";
export const REPOSITORY_APPLY_SCHEMA_VERSION = "repository-apply-schema-v1";
export const REPOSITORY_APPLY_PLAN_SCHEMA_VERSION =
  "repository-apply-plan-v1";

export type ApplyTransactionLifecycle =
  | "created"
  | "preparing"
  | "validating"
  | "awaiting_confirmation"
  | "ready"
  | "cancelled"
  | "expired"
  | "archived";

export type ApplyValidationCategory =
  | "ownership"
  | "proposal_approval"
  | "workspace_state"
  | "repository_revision"
  | "version_fencing"
  | "quota_validation"
  | "lifecycle"
  | "patch_compatibility"
  | "artifact_compatibility";

export interface ApplyOperation {
  readonly operationId: string;
  readonly sequence: number;
  readonly operation: string;
  readonly path: string;
  readonly destinationPath: string | null;
  readonly symbol: string | null;
  readonly content: string | null;
  readonly expectedHash: string | null;
  readonly artifactId: string;
  readonly artifactVersion: number;
}

export interface ApplyDependencyEdge {
  readonly fromOperationId: string;
  readonly toOperationId: string;
  readonly reason: "same_path_order" | "destination_order" | "symbol_order";
}

export interface ApplyDependencyGraph {
  readonly operationIds: readonly string[];
  readonly edges: readonly ApplyDependencyEdge[];
}

export interface RollbackOperation {
  readonly rollbackOperationId: string;
  readonly sequence: number;
  readonly sourceOperationId: string;
  readonly operation: string;
  readonly path: string;
  readonly destinationPath: string | null;
  readonly symbol: string | null;
  readonly sourceExpectedHash: string | null;
}

export interface DependencyRollback {
  readonly operationId: string;
  readonly dependsOnRollbackOperationIds: readonly string[];
}

export interface RollbackPlan {
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly inverseOperations: readonly RollbackOperation[];
  readonly dependencyRollback: readonly DependencyRollback[];
  readonly validationCheckpoints: readonly string[];
}

export interface ApplyDiagnostic {
  readonly diagnosticId: string;
  readonly transactionId: string;
  readonly transactionVersion: number;
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly createdAt: string;
}

export interface ApplyValidationFinding {
  readonly category: ApplyValidationCategory;
  readonly passed: boolean;
  readonly codes: readonly string[];
}

export interface ApplyValidationSummary {
  readonly valid: boolean;
  readonly gateCount: number;
  readonly passedGateCount: number;
  readonly findings: readonly ApplyValidationFinding[];
}

export interface ApplyPlan {
  readonly schemaVersion: string;
  readonly orderedOperations: readonly ApplyOperation[];
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
  readonly dependencyGraph: ApplyDependencyGraph;
  readonly rollbackPlan: RollbackPlan;
  readonly diagnostics: readonly ApplyDiagnostic[];
  readonly validationSummary: ApplyValidationSummary;
}

export interface ApplyPreparationMetadata {
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly deterministicSeed: string;
  readonly proposalVersion: number;
  readonly proposalOutputHash: string;
  readonly workspacePersistenceVersion: number;
  readonly snapshotHash: string;
  readonly executionVersion: string;
  readonly artifactVersions: readonly Readonly<{
    artifactId: string;
    artifactVersion: number;
    contentHash: string;
  }>[];
  readonly patchVersions: readonly Readonly<{
    patchId: string;
    patchVersion: number;
    contentHash: string;
  }>[];
  readonly preparedAt: string;
  readonly preparationLatencyMs: number;
}

export interface ApplyTransactionVersion {
  readonly transactionId: string;
  readonly transactionVersion: number;
  readonly planHash: string;
  readonly applyPlan: ApplyPlan;
  readonly preparationMetadata: ApplyPreparationMetadata;
  readonly createdAt: string;
  readonly preparedAt: string;
  readonly validatedAt: string;
}

export interface ApplyConfirmation {
  readonly confirmationId: string;
  readonly transactionId: string;
  readonly transactionVersion: number;
  readonly ownerId: string;
  readonly confirmerId: string;
  readonly decision: "ready" | "cancelled";
  readonly rationaleCodes: readonly string[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface ApplyLifecycleEvent {
  readonly eventId: string;
  readonly transactionVersion: number;
  readonly from: ApplyTransactionLifecycle | null;
  readonly to: ApplyTransactionLifecycle;
  readonly reason: string;
  readonly createdAt: string;
}

export interface ApplyRecoveryRecord {
  readonly recoveryId: string;
  readonly reason:
    | "abandoned_transaction"
    | "incomplete_apply_plan"
    | "expired_lease"
    | "stale_confirmation";
  readonly previousLifecycle: ApplyTransactionLifecycle;
  readonly recoveredLifecycle: "expired";
  readonly createdAt: string;
}

export interface ApplyArchiveMetadata {
  readonly archivedAt: string;
  readonly reason: "manual" | "retention" | "proposal_terminal";
  readonly finalTransactionVersion: number;
  readonly planHash: string;
}

export interface RepositoryApplyTransaction {
  readonly transactionId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly proposalId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly transactionVersion: number;
  readonly lifecycle: ApplyTransactionLifecycle;
  readonly versions: readonly ApplyTransactionVersion[];
  readonly diagnostics: readonly ApplyDiagnostic[];
  readonly confirmations: readonly ApplyConfirmation[];
  readonly lifecycleHistory: readonly ApplyLifecycleEvent[];
  readonly recoveryHistory: readonly ApplyRecoveryRecord[];
  readonly archiveMetadata: ApplyArchiveMetadata | null;
  readonly validationFailureCount: number;
  readonly conflictCount: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly confirmationRequestedAt: string | null;
  readonly applyLeaseExpiresAt: string | null;
}

export interface PrepareApplyTransactionInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly executionOwnerId: string;
  readonly baseTransactionVersion: number;
  readonly proposal: RepositoryProposal;
  readonly workspace: RepositoryWorkspace;
  readonly artifacts: readonly RepositoryArtifact[];
  readonly patches: readonly RepositoryPatch[];
  readonly executionMetadata: ArtifactExecutionMetadata;
  readonly applyLeaseExpiresAt?: string;
}

export interface ConfirmApplyTransactionInput {
  readonly tenantId: string;
  readonly transactionId: string;
  readonly ownerId: string;
  readonly confirmerId: string;
  readonly transactionVersion: number;
  readonly decision: "ready" | "cancelled";
  readonly rationaleCodes: readonly string[];
  readonly idempotencyKey: string;
}

export interface ApplyQuotas {
  readonly transactionsPerProposal: number;
  readonly versionsPerTransaction: number;
  readonly operationsPerPlan: number;
  readonly filesPerPlan: number;
  readonly symbolsPerPlan: number;
  readonly dependenciesPerPlan: number;
  readonly diagnosticsPerTransaction: number;
  readonly planBytes: number;
  readonly retainedTransactions: number;
  readonly retainedVersions: number;
  readonly retainedDiagnostics: number;
  readonly preparationTimeoutMs: number;
  readonly confirmationTtlMs: number;
}

export interface ApplyMetrics {
  readonly transactionsCreated: number;
  readonly validationFailures: number;
  readonly rollbackPlans: number;
  readonly conflicts: number;
  readonly preparationLatencyMs: number;
  readonly recoveryCount: number;
}

export class RepositoryApplyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryApplyError";
  }
}
