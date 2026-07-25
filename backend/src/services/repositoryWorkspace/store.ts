import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  CreateWorkspaceInput, GeneratePatchInput, RepositoryPatch, RepositoryWorkspace,
  WorkspaceAuditDiagnostic, WorkspaceClaim, WorkspaceLifecycle, WorkspaceMetrics,
  WorkspaceQuotas, WorkspaceRecoveryRecord,
} from "./types.js";
import {
  REPOSITORY_PATCH_SCHEMA_VERSION, REPOSITORY_WORKSPACE_ENGINE_VERSION,
  REPOSITORY_WORKSPACE_SCHEMA_VERSION, RepositoryWorkspaceError,
} from "./types.js";
import {
  immutableWorkspaceClone as clone, patchContentHash, validatePatchInput,
  validatePublishedSnapshot, validateWorkspaceIntegrity, workspaceIdentity,
} from "./validation.js";

export interface RepositoryWorkspaceStore {
  create(input: CreateWorkspaceInput, quotas: WorkspaceQuotas, now?: Date): Promise<RepositoryWorkspace>;
  get(tenantId: string, workspaceId: string): Promise<RepositoryWorkspace | null>;
  prepare(tenantId: string, workspaceId: string, ownerId: string, now?: Date): Promise<RepositoryWorkspace>;
  markReady(tenantId: string, workspaceId: string, ownerId: string, now?: Date): Promise<RepositoryWorkspace>;
  claim(tenantId: string, workspaceId: string, ownerId: string, leaseMs: number, now?: Date): Promise<WorkspaceClaim>;
  activate(claim: WorkspaceClaim, now?: Date): Promise<RepositoryWorkspace>;
  heartbeat(claim: WorkspaceClaim, leaseMs: number, now?: Date): Promise<WorkspaceClaim>;
  beginValidation(claim: WorkspaceClaim, now?: Date): Promise<RepositoryWorkspace>;
  generatePatch(input: GeneratePatchInput, quotas: WorkspaceQuotas, now?: Date): Promise<RepositoryPatch>;
  transition(
    tenantId: string, workspaceId: string, ownerId: string,
    lifecycle: Extract<WorkspaceLifecycle, "archived" | "failed" | "cancelled">,
    quotas: WorkspaceQuotas, now?: Date,
  ): Promise<RepositoryWorkspace>;
  recover(now?: Date, quotas?: WorkspaceQuotas): Promise<number>;
  collect(tenantId: string, quotas: WorkspaceQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<WorkspaceMetrics>;
  verify(): Promise<void>;
}

const terminal = new Set<WorkspaceLifecycle>(["archived", "expired", "failed", "cancelled"]);

function emptyMetrics(): WorkspaceMetrics {
  return {
    workspaceCreation: 0, activeWorkspaces: 0, patchGeneration: 0,
    validationFailures: 0, conflicts: 0, archiveCount: 0,
    recoveryCount: 0, workspaceDurationMs: 0,
  };
}

export class MemoryRepositoryWorkspaceStore implements RepositoryWorkspaceStore {
  private readonly workspaces = new Map<string, RepositoryWorkspace>();

  private key(tenantId: string, workspaceId: string): string {
    return `${tenantId}\0${workspaceId}`;
  }

  hydrate(workspace: RepositoryWorkspace): void {
    this.workspaces.set(this.key(workspace.tenantId, workspace.workspaceId), clone(workspace));
  }

  private require(tenantId: string, workspaceId: string): RepositoryWorkspace {
    const workspace = this.workspaces.get(this.key(tenantId, workspaceId));
    if (!workspace) {
      throw new RepositoryWorkspaceError("repository_workspace_not_found",
        "Repository workspace was not found.");
    }
    return workspace;
  }

  private save(workspace: RepositoryWorkspace): RepositoryWorkspace {
    const current = this.workspaces.get(this.key(workspace.tenantId, workspace.workspaceId));
    const copy = clone({
      ...workspace,
      persistenceVersion: current
        ? Math.max(current.persistenceVersion, workspace.persistenceVersion) + 1
        : 1,
    });
    this.workspaces.set(this.key(copy.tenantId, copy.workspaceId), copy);
    return clone(copy);
  }

  private diagnostic(
    workspace: RepositoryWorkspace,
    severity: WorkspaceAuditDiagnostic["severity"],
    code: string,
    message: string,
    now: Date,
    patchId: string | null = null,
    affectedFiles: readonly string[] = [],
    affectedSymbols: readonly string[] = [],
  ): RepositoryWorkspace {
    const createdAt = now.toISOString();
    const item: WorkspaceAuditDiagnostic = {
      diagnosticId: stableId("repository_workspace_diagnostic", {
        workspaceId: workspace.workspaceId, code,
        sequence: workspace.diagnostics.length + 1,
      }),
      severity, code, message, affectedFiles, affectedSymbols,
      patchId, createdAt,
    };
    return {
      ...workspace,
      diagnostics: [...workspace.diagnostics, item],
      conflictCount: severity === "blocker"
        ? workspace.conflictCount + 1 : workspace.conflictCount,
      validationFailureCount: severity === "validation_failure"
        ? workspace.validationFailureCount + 1 : workspace.validationFailureCount,
      updatedAt: createdAt,
    };
  }

  private reject(
    workspace: RepositoryWorkspace, code: string, message: string, now: Date,
    severity: "blocker" | "validation_failure" = "blocker",
  ): never {
    this.save(this.diagnostic(workspace, severity, code, message, now));
    throw new RepositoryWorkspaceError(code, message, { workspaceId: workspace.workspaceId });
  }

  private owned(workspace: RepositoryWorkspace, ownerId: string, now: Date): void {
    if (workspace.ownerId !== ownerId) {
      this.reject(workspace, "repository_workspace_ownership_conflict",
        "Workspace belongs to another owner.", now);
    }
  }

  private fenced(claim: WorkspaceClaim, now: Date): RepositoryWorkspace {
    const workspace = this.require(claim.tenantId, claim.workspaceId);
    this.owned(workspace, claim.ownerId, now);
    if (workspace.executionId !== claim.executionId ||
        workspace.workUnitId !== claim.workUnitId ||
        workspace.repositoryRevision !== claim.repositoryRevision ||
        workspace.snapshot.snapshotHash !== claim.snapshotHash) {
      this.reject(workspace, "repository_workspace_version_conflict",
        "Workspace claim is fenced by another execution, revision, or snapshot.", now);
    }
    if (!workspace.lease || workspace.lease.claimToken !== claim.claimToken ||
        workspace.lease.ownerId !== claim.ownerId ||
        Date.parse(workspace.lease.expiresAt) <= now.getTime()) {
      this.reject(workspace, "repository_workspace_lease_expired",
        "Workspace lease is absent, expired, or stale.", now);
    }
    return workspace;
  }

  async create(
    input: CreateWorkspaceInput,
    quotas: WorkspaceQuotas,
    now = new Date(),
  ): Promise<RepositoryWorkspace> {
    if ([input.tenantId, input.repositoryId, input.repositoryRevision, input.executionId,
      input.workUnitId, input.ownerId].some((value) => !value.trim())) {
      throw new RepositoryWorkspaceError("repository_workspace_identity_invalid",
        "Workspace identity is incomplete.");
    }
    if (input.ownerId !== input.repositoryOwnerId || input.ownerId !== input.executionOwnerId) {
      throw new RepositoryWorkspaceError("repository_workspace_ownership_conflict",
        "Repository, execution, and workspace ownership must match.");
    }
    const snapshot = validatePublishedSnapshot(input, now);
    const workspaceId = workspaceIdentity(input);
    const existing = this.workspaces.get(this.key(input.tenantId, workspaceId));
    if (existing) {
      if (stableHash({
        repositoryId: existing.repositoryId, repositoryRevision: existing.repositoryRevision,
        executionId: existing.executionId, workUnitId: existing.workUnitId,
        ownerId: existing.ownerId, snapshot: existing.snapshot.snapshotHash,
      }) !== stableHash({
        repositoryId: input.repositoryId, repositoryRevision: input.repositoryRevision,
        executionId: input.executionId, workUnitId: input.workUnitId,
        ownerId: input.ownerId, snapshot: snapshot.snapshotHash,
      })) {
        this.reject(existing, "repository_workspace_identity_conflict",
          "Deterministic workspace identity conflicts with existing state.", now);
      }
      return clone(existing);
    }
    const active = [...this.workspaces.values()].filter((workspace) =>
      workspace.tenantId === input.tenantId && workspace.ownerId === input.ownerId &&
      !terminal.has(workspace.lifecycle)).length;
    if (active >= quotas.activePerOwner) {
      throw new RepositoryWorkspaceError("repository_workspace_quota_exceeded",
        "Active workspace quota exceeded.");
    }
    const timestamp = now.toISOString();
    return this.save({
      workspaceId, schemaVersion: REPOSITORY_WORKSPACE_SCHEMA_VERSION,
      persistenceVersion: 0,
      tenantId: input.tenantId, repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision, executionId: input.executionId,
      workUnitId: input.workUnitId, ownerId: input.ownerId,
      snapshotVersion: snapshot.snapshotVersion, lifecycle: "created", snapshot,
      lease: null, patches: [], diagnostics: [], recoveryHistory: [],
      archiveMetadata: null, conflictCount: 0, validationFailureCount: 0,
      recoveryCount: 0, createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    });
  }

  async get(tenantId: string, workspaceId: string): Promise<RepositoryWorkspace | null> {
    const workspace = this.workspaces.get(this.key(tenantId, workspaceId));
    return workspace ? clone(workspace) : null;
  }

  async prepare(
    tenantId: string, workspaceId: string, ownerId: string, now = new Date(),
  ): Promise<RepositoryWorkspace> {
    const workspace = this.require(tenantId, workspaceId);
    this.owned(workspace, ownerId, now);
    if (workspace.lifecycle !== "created") {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        "Only created workspaces may begin preparation.", now);
    }
    validateWorkspaceIntegrity(workspace);
    return this.save({ ...workspace, lifecycle: "preparing", updatedAt: now.toISOString() });
  }

  async markReady(
    tenantId: string, workspaceId: string, ownerId: string, now = new Date(),
  ): Promise<RepositoryWorkspace> {
    const workspace = this.require(tenantId, workspaceId);
    this.owned(workspace, ownerId, now);
    if (workspace.lifecycle !== "preparing") {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        "Only preparing workspaces may become ready.", now);
    }
    try {
      validateWorkspaceIntegrity(workspace);
    } catch (error) {
      this.reject(workspace, "repository_workspace_snapshot_stale",
        error instanceof Error ? error.message : "Workspace snapshot is stale.",
        now, "validation_failure");
    }
    return this.save({ ...workspace, lifecycle: "ready", updatedAt: now.toISOString() });
  }

  async claim(
    tenantId: string, workspaceId: string, ownerId: string,
    leaseMs: number, now = new Date(),
  ): Promise<WorkspaceClaim> {
    const workspace = this.require(tenantId, workspaceId);
    this.owned(workspace, ownerId, now);
    if (workspace.lifecycle !== "ready" || !Number.isInteger(leaseMs) || leaseMs <= 0) {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        "Only ready workspaces may receive a valid lease.", now);
    }
    const timestamp = now.toISOString();
    const claimToken = stableHash({
      workspaceId, ownerId, snapshotHash: workspace.snapshot.snapshotHash,
      patchVersion: workspace.patches.at(-1)?.patchVersion ?? 0, acquiredAt: timestamp,
    });
    const updated = this.save({
      ...workspace, lifecycle: "leased",
      lease: {
        leaseId: stableId("repository_workspace_lease", {
          workspaceId, ownerId, snapshotHash: workspace.snapshot.snapshotHash,
        }),
        ownerId, claimToken, acquiredAt: timestamp, heartbeatAt: timestamp,
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      },
      updatedAt: timestamp,
    });
    return clone({
      tenantId, workspaceId, executionId: updated.executionId,
      workUnitId: updated.workUnitId, ownerId,
      repositoryRevision: updated.repositoryRevision,
      snapshotHash: updated.snapshot.snapshotHash, claimToken,
    });
  }

  async activate(claim: WorkspaceClaim, now = new Date()): Promise<RepositoryWorkspace> {
    const workspace = this.fenced(claim, now);
    if (workspace.lifecycle !== "leased") {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        "Only leased workspaces may become active.", now);
    }
    return this.save({ ...workspace, lifecycle: "active", updatedAt: now.toISOString() });
  }

  async heartbeat(
    claim: WorkspaceClaim, leaseMs: number, now = new Date(),
  ): Promise<WorkspaceClaim> {
    const workspace = this.fenced(claim, now);
    if (!["leased", "active", "validating"].includes(workspace.lifecycle) ||
        !Number.isInteger(leaseMs) || leaseMs <= 0) {
      this.reject(workspace, "repository_workspace_lease_expired",
        "Workspace lease cannot be renewed.", now);
    }
    const timestamp = now.toISOString();
    this.save({
      ...workspace,
      lease: {
        ...workspace.lease!, heartbeatAt: timestamp,
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      },
      updatedAt: timestamp,
    });
    return clone(claim);
  }

  async beginValidation(
    claim: WorkspaceClaim, now = new Date(),
  ): Promise<RepositoryWorkspace> {
    const workspace = this.fenced(claim, now);
    if (workspace.lifecycle !== "active") {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        "Only active workspaces may begin patch validation.", now);
    }
    return this.save({
      ...workspace, lifecycle: "validating", updatedAt: now.toISOString(),
    });
  }

  async generatePatch(
    input: GeneratePatchInput, quotas: WorkspaceQuotas, now = new Date(),
  ): Promise<RepositoryPatch> {
    let workspace = this.fenced(input.claim, now);
    if (!["active", "validating"].includes(workspace.lifecycle)) {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        "Patches require an active workspace.", now);
    }
    if (now.getTime() - Date.parse(workspace.createdAt) >= quotas.durationMs) {
      this.reject(workspace, "repository_workspace_duration_exceeded",
        "Workspace duration quota exceeded.", now, "validation_failure");
    }
    const currentVersion = workspace.patches.at(-1)?.patchVersion ?? 0;
    if (input.basePatchVersion !== currentVersion) {
      this.reject(workspace, "repository_patch_version_stale",
        "Patch base version is stale.", now);
    }
    if (workspace.patches.length >= quotas.patchesPerWorkspace) {
      this.reject(workspace, "repository_patch_quota_exceeded",
        "Patch history quota exceeded.", now, "validation_failure");
    }
    try {
      validateWorkspaceIntegrity(workspace);
      validatePatchInput(input, quotas);
    } catch (error) {
      const code = error instanceof RepositoryWorkspaceError
        ? error.code : "repository_patch_validation_failed";
      const message = error instanceof Error ? error.message : "Patch validation failed.";
      const filePath = error instanceof RepositoryWorkspaceError &&
        typeof error.details.filePath === "string" ? error.details.filePath : null;
      const symbol = error instanceof RepositoryWorkspaceError &&
        typeof error.details.symbol === "string" ? error.details.symbol : null;
      const severity = code.includes("conflict") ? "blocker" : "validation_failure";
      const failed = this.diagnostic(
        workspace, severity, code, message, now, null,
        filePath ? [filePath] : [], symbol ? [symbol] : [],
      );
      this.save(failed);
      throw new RepositoryWorkspaceError(code, message, {
        workspaceId: workspace.workspaceId,
        ...(filePath ? { filePath } : {}),
        ...(symbol ? { symbol } : {}),
      });
    }
    const fileOperations = [...input.fileOperations].sort((left, right) =>
      left.path.localeCompare(right.path) || left.operation.localeCompare(right.operation));
    const symbolOperations = [...input.symbolOperations].sort((left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.symbol.localeCompare(right.symbol) ||
      left.operation.localeCompare(right.operation));
    const diagnostics = [...input.diagnostics].sort((left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
    const patchVersion = currentVersion + 1;
    const timestamp = now.toISOString();
    const body = {
      workspaceId: workspace.workspaceId, executionId: workspace.executionId,
      workUnitId: workspace.workUnitId, patchVersion,
      snapshotHash: workspace.snapshot.snapshotHash,
      fileOperations, symbolOperations, diagnostics, confidence: input.confidence,
    };
    const contentHash = patchContentHash(body);
    const patch: RepositoryPatch = {
      patchId: stableId("repository_patch", {
        workspaceId: workspace.workspaceId, patchVersion,
        snapshotHash: workspace.snapshot.snapshotHash, contentHash,
      }),
      ...body, contentHash, createdAt: timestamp, validatedAt: timestamp,
    };
    const auditDiagnostics: WorkspaceAuditDiagnostic[] = diagnostics.map((diagnostic, index) => ({
      ...diagnostic, patchId: patch.patchId, createdAt: timestamp,
      diagnosticId: stableId("repository_workspace_diagnostic", {
        workspaceId: workspace.workspaceId, patchId: patch.patchId, index,
        code: diagnostic.code,
      }),
    }));
    workspace = {
      ...workspace, lifecycle: "active",
      patches: [...workspace.patches, patch],
      diagnostics: [...workspace.diagnostics, ...auditDiagnostics],
      updatedAt: timestamp,
    };
    this.save(workspace);
    return clone(patch);
  }

  async transition(
    tenantId: string, workspaceId: string, ownerId: string,
    lifecycle: Extract<WorkspaceLifecycle, "archived" | "failed" | "cancelled">,
    quotas: WorkspaceQuotas, now = new Date(),
  ): Promise<RepositoryWorkspace> {
    const workspace = this.require(tenantId, workspaceId);
    this.owned(workspace, ownerId, now);
    const allowed = lifecycle === "archived"
      ? ["ready", "active"] : ["created", "preparing", "ready", "leased", "active", "validating"];
    if (!allowed.includes(workspace.lifecycle)) {
      this.reject(workspace, "repository_workspace_lifecycle_conflict",
        `Workspace cannot transition from ${workspace.lifecycle} to ${lifecycle}.`, now);
    }
    const timestamp = now.toISOString();
    const patches = lifecycle === "archived"
      ? workspace.patches.slice(-Math.max(1, quotas.patchHistory)) : workspace.patches;
    const diagnostics = lifecycle === "archived"
      ? workspace.diagnostics.slice(-Math.max(1, quotas.retainedDiagnostics))
      : workspace.diagnostics;
    return this.save({
      ...workspace, lifecycle, lease: null, patches, diagnostics,
      archiveMetadata: lifecycle === "archived" ? {
        archivedAt: timestamp, patchCount: workspace.patches.length,
        finalPatchVersion: workspace.patches.at(-1)?.patchVersion ?? 0,
        snapshotHash: workspace.snapshot.snapshotHash,
      } : workspace.archiveMetadata,
      updatedAt: timestamp, completedAt: timestamp,
    });
  }

  private recovery(
    workspace: RepositoryWorkspace, reason: WorkspaceRecoveryRecord["reason"],
    recoveredLifecycle: WorkspaceLifecycle, now: Date,
  ): RepositoryWorkspace {
    const createdAt = now.toISOString();
    const record: WorkspaceRecoveryRecord = {
      recoveryId: stableId("repository_workspace_recovery", {
        workspaceId: workspace.workspaceId, reason,
        sequence: workspace.recoveryHistory.length + 1,
      }),
      reason, previousLifecycle: workspace.lifecycle, recoveredLifecycle, createdAt,
    };
    return {
      ...workspace, lifecycle: recoveredLifecycle,
      lease: recoveredLifecycle === "active" ? workspace.lease : null,
      recoveryHistory: [...workspace.recoveryHistory, record],
      recoveryCount: workspace.recoveryCount + 1,
      completedAt: terminal.has(recoveredLifecycle) ? createdAt : workspace.completedAt,
      updatedAt: createdAt,
    };
  }

  async recover(now = new Date(), quotas?: WorkspaceQuotas): Promise<number> {
    let count = 0;
    for (const current of [...this.workspaces.values()]) {
      if (terminal.has(current.lifecycle)) continue;
      let workspace = current;
      try {
        validateWorkspaceIntegrity(workspace);
      } catch {
        workspace = this.recovery(workspace, "stale_snapshot", "failed", now);
        this.save(this.diagnostic(workspace, "validation_failure",
          "repository_workspace_snapshot_stale", "Recovery rejected a stale snapshot.", now));
        count += 1;
        continue;
      }
      const expired = workspace.lease &&
        Date.parse(workspace.lease.expiresAt) <= now.getTime();
      if (expired) {
        workspace = this.recovery(workspace, "expired_lease", "expired", now);
        count += 1;
      } else if (workspace.lifecycle === "validating") {
        workspace = this.recovery(workspace, "incomplete_patch",
          workspace.lease ? "active" : "failed", now);
        count += 1;
      } else if (workspace.lifecycle === "active" && !workspace.lease) {
        workspace = this.recovery(workspace, "abandoned_workspace", "failed", now);
        count += 1;
      } else if (quotas && workspace.lifecycle === "preparing" &&
          now.getTime() - Date.parse(workspace.updatedAt) >= quotas.durationMs) {
        workspace = this.recovery(workspace, "abandoned_workspace", "failed", now);
        count += 1;
      }
      this.save(workspace);
    }
    return count;
  }

  async collect(tenantId: string, quotas: WorkspaceQuotas): Promise<number> {
    const archived = [...this.workspaces.entries()].filter(([, workspace]) =>
      workspace.tenantId === tenantId && terminal.has(workspace.lifecycle))
      .sort((left, right) => right[1].completedAt!.localeCompare(left[1].completedAt!) ||
        right[1].workspaceId.localeCompare(left[1].workspaceId));
    let removed = 0;
    for (const [key] of archived.slice(Math.max(1, quotas.archivedWorkspaces))) {
      this.workspaces.delete(key);
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string): Promise<WorkspaceMetrics> {
    return [...this.workspaces.values()]
      .filter((workspace) => tenantId === undefined || workspace.tenantId === tenantId)
      .reduce<WorkspaceMetrics>((metrics, workspace) => ({
        workspaceCreation: metrics.workspaceCreation + 1,
        activeWorkspaces: metrics.activeWorkspaces +
          (terminal.has(workspace.lifecycle) ? 0 : 1),
        patchGeneration: metrics.patchGeneration + workspace.patches.length,
        validationFailures: metrics.validationFailures + workspace.validationFailureCount,
        conflicts: metrics.conflicts + workspace.conflictCount,
        archiveCount: metrics.archiveCount + (workspace.lifecycle === "archived" ? 1 : 0),
        recoveryCount: metrics.recoveryCount + workspace.recoveryCount,
        workspaceDurationMs: metrics.workspaceDurationMs +
          (workspace.completedAt
            ? Math.max(0, Date.parse(workspace.completedAt) - Date.parse(workspace.createdAt)) : 0),
      }), emptyMetrics());
  }

  async verify(): Promise<void> {
    for (const workspace of this.workspaces.values()) {
      validateWorkspaceIntegrity(workspace);
      if (workspace.schemaVersion !== REPOSITORY_WORKSPACE_SCHEMA_VERSION ||
          workspace.tenantId !== workspace.snapshot.tenantId ||
          workspace.repositoryId !== workspace.snapshot.repositoryId ||
          workspace.patches.some((patch) =>
            patch.contentHash !== patchContentHash({
              workspaceId: patch.workspaceId, executionId: patch.executionId,
              workUnitId: patch.workUnitId, patchVersion: patch.patchVersion,
              snapshotHash: patch.snapshotHash, fileOperations: patch.fileOperations,
              symbolOperations: patch.symbolOperations, diagnostics: patch.diagnostics,
              confidence: patch.confidence,
            }))) {
        throw new RepositoryWorkspaceError("repository_workspace_startup_validation_failed",
          "Workspace persistence integrity validation failed.");
      }
    }
  }
}

interface RpcQuery extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {}
interface DatabaseClient { rpc(name: string, parameters?: Record<string, unknown>): RpcQuery }
function first(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : undefined;
}

export class PostgresRepositoryWorkspaceStore implements RepositoryWorkspaceStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code = error.message?.match(/repository_(?:workspace|patch)_[a-z_]+/u)?.[0] ??
        "repository_workspace_persistence_failed";
      throw new RepositoryWorkspaceError(code,
        error.message ?? "Repository workspace persistence failed.");
    }
    return data;
  }

  private async load(tenantId: string, workspaceId: string): Promise<RepositoryWorkspace | null> {
    const data = await this.call("get_repository_workspace", {
      input_tenant_id: tenantId, input_workspace_id: workspaceId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.workspace ?? data) as RepositoryWorkspace);
  }

  private async persist(
    workspace: RepositoryWorkspace, expectedVersion: number | null,
  ): Promise<RepositoryWorkspace> {
    const data = await this.call("save_repository_workspace", {
      input_workspace: workspace,
      input_expected_version: expectedVersion === null ? null : String(expectedVersion),
    });
    return clone((first(data)?.workspace ?? data) as RepositoryWorkspace);
  }

  private async mutate<T>(
    tenantId: string, workspaceId: string,
    operation: (memory: MemoryRepositoryWorkspaceStore) => Promise<T>,
  ): Promise<{ value: T; workspace: RepositoryWorkspace }> {
    const existing = await this.load(tenantId, workspaceId);
    if (!existing) {
      throw new RepositoryWorkspaceError("repository_workspace_not_found",
        "Repository workspace was not found.");
    }
    const memory = new MemoryRepositoryWorkspaceStore();
    memory.hydrate(existing);
    try {
      const value = await operation(memory);
      const updated = await memory.get(tenantId, workspaceId);
      if (!updated) throw new RepositoryWorkspaceError("repository_workspace_not_found",
        "Repository workspace was not found.");
      return { value, workspace: await this.persist(updated, existing.persistenceVersion) };
    } catch (error) {
      const failed = await memory.get(tenantId, workspaceId);
      if (failed && stableHash(failed) !== stableHash(existing)) {
        await this.persist(failed, existing.persistenceVersion).catch(() => undefined);
      }
      throw error;
    }
  }

  async create(input: CreateWorkspaceInput, quotas: WorkspaceQuotas, now?: Date) {
    const workspaceId = workspaceIdentity(input);
    const existing = await this.load(input.tenantId, workspaceId);
    const memory = new MemoryRepositoryWorkspaceStore();
    if (existing) memory.hydrate(existing);
    try {
      const workspace = await memory.create(input, quotas, now);
      return this.persist(workspace, existing?.persistenceVersion ?? null);
    } catch (error) {
      const failed = await memory.get(input.tenantId, workspaceId);
      if (existing && failed && stableHash(failed) !== stableHash(existing)) {
        await this.persist(failed, existing.persistenceVersion).catch(() => undefined);
      }
      throw error;
    }
  }

  get(tenantId: string, workspaceId: string) { return this.load(tenantId, workspaceId); }
  async prepare(tenantId: string, workspaceId: string, ownerId: string, now?: Date) {
    return (await this.mutate(tenantId, workspaceId,
      (memory) => memory.prepare(tenantId, workspaceId, ownerId, now))).workspace;
  }
  async markReady(tenantId: string, workspaceId: string, ownerId: string, now?: Date) {
    return (await this.mutate(tenantId, workspaceId,
      (memory) => memory.markReady(tenantId, workspaceId, ownerId, now))).workspace;
  }
  async claim(
    tenantId: string, workspaceId: string, ownerId: string, leaseMs: number, now?: Date,
  ) {
    return (await this.mutate(tenantId, workspaceId,
      (memory) => memory.claim(tenantId, workspaceId, ownerId, leaseMs, now))).value;
  }
  async activate(claim: WorkspaceClaim, now?: Date) {
    return (await this.mutate(claim.tenantId, claim.workspaceId,
      (memory) => memory.activate(claim, now))).workspace;
  }
  async heartbeat(claim: WorkspaceClaim, leaseMs: number, now?: Date) {
    return (await this.mutate(claim.tenantId, claim.workspaceId,
      (memory) => memory.heartbeat(claim, leaseMs, now))).value;
  }
  async beginValidation(claim: WorkspaceClaim, now?: Date) {
    return (await this.mutate(claim.tenantId, claim.workspaceId,
      (memory) => memory.beginValidation(claim, now))).workspace;
  }
  async generatePatch(input: GeneratePatchInput, quotas: WorkspaceQuotas, now?: Date) {
    return (await this.mutate(input.claim.tenantId, input.claim.workspaceId,
      (memory) => memory.generatePatch(input, quotas, now))).value;
  }
  async transition(
    tenantId: string, workspaceId: string, ownerId: string,
    lifecycle: Extract<WorkspaceLifecycle, "archived" | "failed" | "cancelled">,
    quotas: WorkspaceQuotas, now?: Date,
  ) {
    return (await this.mutate(tenantId, workspaceId,
      (memory) => memory.transition(
        tenantId, workspaceId, ownerId, lifecycle, quotas, now,
      ))).workspace;
  }
  async recover(now = new Date(), quotas?: WorkspaceQuotas) {
    const data = await this.call("list_recoverable_repository_workspaces");
    const workspaces = (first(data)?.workspaces ?? data ?? []) as RepositoryWorkspace[];
    let recovered = 0;
    for (const workspace of workspaces) {
      const memory = new MemoryRepositoryWorkspaceStore();
      memory.hydrate(workspace);
      const count = await memory.recover(now, quotas);
      const updated = await memory.get(workspace.tenantId, workspace.workspaceId);
      if (updated && count > 0) await this.persist(updated, workspace.persistenceVersion);
      recovered += count;
    }
    return recovered;
  }
  async collect(tenantId: string, quotas: WorkspaceQuotas) {
    const data = await this.call("collect_repository_workspaces", {
      input_tenant_id: tenantId,
      input_workspace_retention: quotas.archivedWorkspaces,
      input_patch_retention: quotas.patchHistory,
      input_diagnostic_retention: quotas.retainedDiagnostics,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }
  async metrics(tenantId?: string) {
    const data = await this.call("repository_workspace_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as WorkspaceMetrics);
  }
  async verify() {
    const data = await this.call("verify_repository_workspace_contract", {
      input_engine_version: REPOSITORY_WORKSPACE_ENGINE_VERSION,
      input_patch_schema_version: REPOSITORY_PATCH_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositoryWorkspaceError("repository_workspace_startup_validation_failed",
        "Repository workspace database contract is invalid.", { problems: row.problems ?? [] });
    }
  }
}

export const runtimeRepositoryWorkspaceStore: RepositoryWorkspaceStore =
  new PostgresRepositoryWorkspaceStore(supabase as unknown as SupabaseClient);
