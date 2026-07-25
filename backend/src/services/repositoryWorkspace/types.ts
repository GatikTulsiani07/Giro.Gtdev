export const REPOSITORY_WORKSPACE_ENGINE_VERSION = "repository-workspace-patch-v1";
export const REPOSITORY_WORKSPACE_SCHEMA_VERSION = "repository-workspace-schema-v1";
export const REPOSITORY_PATCH_SCHEMA_VERSION = "repository-patch-schema-v1";

export type WorkspaceLifecycle =
  | "created" | "preparing" | "ready" | "leased" | "active" | "validating"
  | "archived" | "expired" | "failed" | "cancelled";

export interface PublishedWorkspaceSnapshot {
  readonly published: true;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly snapshotVersion: string;
  readonly revisionHash: string;
  readonly graphVersion: string;
  readonly intelligenceVersion: string;
  readonly retrievalVersion: string;
  readonly planningVersion: string;
}

export interface WorkspaceSnapshot extends PublishedWorkspaceSnapshot {
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly createdAt: string;
}

export interface WorkspaceLease {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly claimToken: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export type FileOperation =
  | Readonly<{ operation: "create_file"; path: string; content: string }>
  | Readonly<{ operation: "update_file"; path: string; content: string; expectedContentHash: string }>
  | Readonly<{ operation: "delete_file"; path: string; expectedContentHash: string }>
  | Readonly<{ operation: "rename_file"; path: string; destinationPath: string; expectedContentHash: string }>;

export type SymbolOperation =
  | Readonly<{ operation: "add_symbol"; filePath: string; symbol: string; declaration: string }>
  | Readonly<{ operation: "remove_symbol"; filePath: string; symbol: string; expectedSymbolHash: string }>
  | Readonly<{ operation: "update_symbol"; filePath: string; symbol: string; declaration: string; expectedSymbolHash: string }>;

export interface PatchDiagnostic {
  readonly severity: "warning" | "blocker" | "validation_failure";
  readonly code: string;
  readonly message: string;
  readonly affectedFiles: readonly string[];
  readonly affectedSymbols: readonly string[];
}

export interface RepositoryPatch {
  readonly patchId: string;
  readonly workspaceId: string;
  readonly executionId: string;
  readonly workUnitId: string;
  readonly patchVersion: number;
  readonly snapshotHash: string;
  readonly fileOperations: readonly FileOperation[];
  readonly symbolOperations: readonly SymbolOperation[];
  readonly diagnostics: readonly PatchDiagnostic[];
  readonly confidence: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly validatedAt: string;
}

export interface WorkspaceAuditDiagnostic extends PatchDiagnostic {
  readonly diagnosticId: string;
  readonly patchId: string | null;
  readonly createdAt: string;
}

export interface WorkspaceRecoveryRecord {
  readonly recoveryId: string;
  readonly reason: "expired_lease" | "abandoned_workspace" | "incomplete_patch" | "stale_snapshot";
  readonly previousLifecycle: WorkspaceLifecycle;
  readonly recoveredLifecycle: WorkspaceLifecycle;
  readonly createdAt: string;
}

export interface WorkspaceArchiveMetadata {
  readonly archivedAt: string;
  readonly patchCount: number;
  readonly finalPatchVersion: number;
  readonly snapshotHash: string;
}

export interface RepositoryWorkspace {
  readonly workspaceId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly workUnitId: string;
  readonly ownerId: string;
  readonly snapshotVersion: string;
  readonly lifecycle: WorkspaceLifecycle;
  readonly snapshot: WorkspaceSnapshot;
  readonly lease: WorkspaceLease | null;
  readonly patches: readonly RepositoryPatch[];
  readonly diagnostics: readonly WorkspaceAuditDiagnostic[];
  readonly recoveryHistory: readonly WorkspaceRecoveryRecord[];
  readonly archiveMetadata: WorkspaceArchiveMetadata | null;
  readonly conflictCount: number;
  readonly validationFailureCount: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CreateWorkspaceInput {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly workUnitId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly executionOwnerId: string;
  readonly snapshot: PublishedWorkspaceSnapshot;
}

export interface WorkspaceClaim {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly executionId: string;
  readonly workUnitId: string;
  readonly ownerId: string;
  readonly repositoryRevision: string;
  readonly snapshotHash: string;
  readonly claimToken: string;
}

export interface GeneratePatchInput {
  readonly claim: WorkspaceClaim;
  readonly basePatchVersion: number;
  readonly fileOperations: readonly FileOperation[];
  readonly symbolOperations: readonly SymbolOperation[];
  readonly diagnostics: readonly PatchDiagnostic[];
  readonly confidence: number;
}

export interface WorkspaceQuotas {
  readonly activePerOwner: number;
  readonly patchesPerWorkspace: number;
  readonly fileOperationsPerPatch: number;
  readonly symbolOperationsPerPatch: number;
  readonly patchBytes: number;
  readonly diagnosticsPerPatch: number;
  readonly leaseMs: number;
  readonly durationMs: number;
  readonly archivedWorkspaces: number;
  readonly patchHistory: number;
  readonly retainedDiagnostics: number;
}

export interface WorkspaceMetrics {
  readonly workspaceCreation: number;
  readonly activeWorkspaces: number;
  readonly patchGeneration: number;
  readonly validationFailures: number;
  readonly conflicts: number;
  readonly archiveCount: number;
  readonly recoveryCount: number;
  readonly workspaceDurationMs: number;
}

export class RepositoryWorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryWorkspaceError";
  }
}
