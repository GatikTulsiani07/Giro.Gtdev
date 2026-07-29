export const REPOSITORY_SANDBOX_ENGINE_VERSION = "repository-sandbox-v1";
export const REPOSITORY_SANDBOX_SCHEMA_VERSION = "repository-sandbox-schema-v1";

export type SandboxLifecycle =
  | "creating"
  | "ready"
  | "leased"
  | "released"
  | "archived"
  | "failed";

export interface RepositorySandboxSnapshot {
  readonly snapshotId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly contentFingerprint: string;
  readonly capturedAt: string;
}

export interface SandboxWorkspaceMetadata {
  readonly repositorySnapshot: RepositorySandboxSnapshot;
  readonly repositoryRevision: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly dependencyMetadata: Readonly<Record<string, unknown>>;
  readonly workspaceFingerprint: string;
  readonly preparedAt: string | null;
  readonly preparationLatencyMs: number;
}

export interface SandboxLease {
  readonly leaseId: string;
  readonly sandboxId: string;
  readonly ownerId: string;
  readonly leaseOwner: string;
  readonly fencingToken: number;
  readonly claimToken: string;
  readonly startedAt: string;
  readonly renewedAt: string;
  readonly expiresAt: string;
  readonly renewals: number;
  readonly releasedAt: string | null;
}

export type SandboxRecoveryReason =
  | "abandoned_sandbox"
  | "expired_lease"
  | "failed_preparation"
  | "orphan_metadata";

export interface SandboxRecoveryRecord {
  readonly recoveryId: string;
  readonly sandboxId: string;
  readonly reason: SandboxRecoveryReason;
  readonly previousLifecycle: SandboxLifecycle;
  readonly recoveredLifecycle: SandboxLifecycle;
  readonly createdAt: string;
}

export interface SandboxArchiveMetadata {
  readonly sandboxId: string;
  readonly archivedAt: string;
  readonly repositoryRevision: string;
  readonly workspaceFingerprint: string;
  readonly leaseCount: number;
}

export interface RepositorySandbox {
  readonly sandboxId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly workflowId: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly repositoryRevision: string;
  readonly workspaceRoot: string;
  readonly lifecycle: SandboxLifecycle;
  readonly workspace: SandboxWorkspaceMetadata;
  readonly leases: readonly SandboxLease[];
  readonly recoveryHistory: readonly SandboxRecoveryRecord[];
  readonly archiveMetadata: SandboxArchiveMetadata | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readyAt: string | null;
  readonly releasedAt: string | null;
  readonly archivedAt: string | null;
}

export interface CreateSandboxInput {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly workflowId: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly workflowOwnerId: string;
  readonly executionOwnerId: string;
  readonly repositoryRevision: string;
  readonly executionRevision: string;
  readonly repositoryAccess: boolean;
  readonly workspaceRootBase: string;
  readonly repositorySnapshot: Omit<RepositorySandboxSnapshot, "snapshotId" | "capturedAt">;
  readonly manifest?: Readonly<Record<string, unknown>>;
  readonly dependencyMetadata?: Readonly<Record<string, unknown>>;
}

export interface SandboxClaim {
  readonly tenantId: string;
  readonly sandboxId: string;
  readonly repositoryId: string;
  readonly workflowId: string;
  readonly executionId: string;
  readonly ownerId: string;
  readonly leaseOwner: string;
  readonly repositoryRevision: string;
  readonly workspaceFingerprint: string;
  readonly fencingToken: number;
  readonly claimToken: string;
}

export interface SandboxQuotas {
  readonly activePerOwner: number;
  readonly activeLeasesPerOwner: number;
  readonly leaseMs: number;
  readonly preparationTimeoutMs: number;
  readonly retainedSandboxes: number;
  readonly retainedRecoveryRecords: number;
}

export interface SandboxMetrics {
  readonly sandboxCreation: number;
  readonly activeLeases: number;
  readonly leaseRenewals: number;
  readonly recoveryCount: number;
  readonly preparationLatencyMs: number;
  readonly archiveCount: number;
}

export class RepositorySandboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositorySandboxError";
  }
}
