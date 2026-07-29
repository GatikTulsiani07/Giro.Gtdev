import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  CreateSandboxInput,
  RepositorySandbox,
  SandboxClaim,
  SandboxLifecycle,
  SandboxMetrics,
  SandboxQuotas,
  SandboxRecoveryReason,
} from "./types.js";
import {
  REPOSITORY_SANDBOX_ENGINE_VERSION,
  REPOSITORY_SANDBOX_SCHEMA_VERSION,
  RepositorySandboxError,
} from "./types.js";
import {
  cloneSandbox as clone,
  prepareWorkspaceMetadata,
  sandboxIdentity,
  sandboxWorkspaceRoot,
  validateSandboxIntegrity,
} from "./validation.js";

export interface RepositorySandboxStore {
  create(input: CreateSandboxInput, quotas: SandboxQuotas, now?: Date): Promise<RepositorySandbox>;
  get(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
  ): Promise<RepositorySandbox | null>;
  prepare(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string, now?: Date,
  ): Promise<RepositorySandbox>;
  failPreparation(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    reason: string, now?: Date,
  ): Promise<RepositorySandbox>;
  acquire(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    leaseOwner: string, leaseMs: number, quotas: SandboxQuotas, now?: Date,
  ): Promise<SandboxClaim>;
  renew(claim: SandboxClaim, leaseMs: number, now?: Date): Promise<SandboxClaim>;
  release(claim: SandboxClaim, now?: Date): Promise<RepositorySandbox>;
  archive(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string, now?: Date,
  ): Promise<RepositorySandbox>;
  recover(now?: Date, quotas?: SandboxQuotas): Promise<number>;
  collect(tenantId: string, quotas: SandboxQuotas): Promise<number>;
  metrics(tenantId?: string, now?: Date): Promise<SandboxMetrics>;
  verify(): Promise<void>;
}

const activeLifecycles = new Set<SandboxLifecycle>(["creating", "ready", "leased"]);

function emptyMetrics(): SandboxMetrics {
  return {
    sandboxCreation: 0,
    activeLeases: 0,
    leaseRenewals: 0,
    recoveryCount: 0,
    preparationLatencyMs: 0,
    archiveCount: 0,
  };
}

export class MemoryRepositorySandboxStore implements RepositorySandboxStore {
  private readonly sandboxes = new Map<string, RepositorySandbox>();

  private key(tenantId: string, sandboxId: string): string {
    return `${tenantId}\0${sandboxId}`;
  }

  hydrate(sandbox: RepositorySandbox): void {
    this.sandboxes.set(this.key(sandbox.tenantId, sandbox.sandboxId), clone(sandbox));
  }

  private require(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
  ): RepositorySandbox {
    const sandbox = this.sandboxes.get(this.key(tenantId, sandboxId));
    if (!sandbox || sandbox.ownerId !== ownerId || sandbox.repositoryId !== repositoryId) {
      throw new RepositorySandboxError(
        "repository_sandbox_not_found",
        "Repository sandbox was not found.",
      );
    }
    return sandbox;
  }

  private save(sandbox: RepositorySandbox): RepositorySandbox {
    const current = this.sandboxes.get(this.key(sandbox.tenantId, sandbox.sandboxId));
    const saved = clone({
      ...sandbox,
      persistenceVersion: current
        ? Math.max(current.persistenceVersion, sandbox.persistenceVersion) + 1
        : 1,
    });
    validateSandboxIntegrity(saved);
    this.sandboxes.set(this.key(saved.tenantId, saved.sandboxId), saved);
    return clone(saved);
  }

  async create(
    input: CreateSandboxInput,
    quotas: SandboxQuotas,
    now = new Date(),
  ): Promise<RepositorySandbox> {
    if ([input.tenantId, input.repositoryId, input.workflowId, input.executionId,
      input.ownerId, input.repositoryRevision, input.workspaceRootBase,
      input.repositorySnapshot.contentFingerprint].some((value) => !value.trim())) {
      throw new RepositorySandboxError(
        "repository_sandbox_identity_invalid",
        "Sandbox identity and snapshot metadata must be complete.",
      );
    }
    if (!input.repositoryAccess ||
        input.ownerId !== input.repositoryOwnerId ||
        input.ownerId !== input.workflowOwnerId ||
        input.ownerId !== input.executionOwnerId) {
      throw new RepositorySandboxError(
        "repository_sandbox_access_denied",
        "Repository, workflow, execution, and sandbox ownership must match.",
      );
    }
    const sandboxId = sandboxIdentity(input);
    const workspaceRoot = sandboxWorkspaceRoot(input);
    const workspace = prepareWorkspaceMetadata(input, now);
    const existing = this.sandboxes.get(this.key(input.tenantId, sandboxId));
    if (existing) {
      if (stableHash({
        repositoryId: existing.repositoryId,
        workflowId: existing.workflowId,
        executionId: existing.executionId,
        ownerId: existing.ownerId,
        repositoryRevision: existing.repositoryRevision,
        workspaceRoot: existing.workspaceRoot,
        workspaceFingerprint: existing.workspace.workspaceFingerprint,
      }) !== stableHash({
        repositoryId: input.repositoryId,
        workflowId: input.workflowId,
        executionId: input.executionId,
        ownerId: input.ownerId,
        repositoryRevision: input.repositoryRevision,
        workspaceRoot,
        workspaceFingerprint: workspace.workspaceFingerprint,
      })) {
        throw new RepositorySandboxError(
          "repository_sandbox_identity_conflict",
          "Deterministic sandbox identity conflicts with durable metadata.",
        );
      }
      return clone(existing);
    }
    if ([...this.sandboxes.values()].some((candidate) =>
      candidate.tenantId === input.tenantId && candidate.workspaceRoot === workspaceRoot)) {
      throw new RepositorySandboxError(
        "repository_sandbox_workspace_conflict",
        "Sandbox workspace root must be unique within a tenant.",
      );
    }
    const active = [...this.sandboxes.values()].filter((candidate) =>
      candidate.tenantId === input.tenantId && candidate.ownerId === input.ownerId &&
      activeLifecycles.has(candidate.lifecycle)).length;
    if (active >= quotas.activePerOwner) {
      throw new RepositorySandboxError(
        "repository_sandbox_quota_exceeded",
        "Active sandbox quota exceeded.",
        { limit: quotas.activePerOwner },
      );
    }
    const timestamp = now.toISOString();
    return this.save({
      sandboxId,
      schemaVersion: REPOSITORY_SANDBOX_SCHEMA_VERSION,
      persistenceVersion: 0,
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      workflowId: input.workflowId,
      executionId: input.executionId,
      ownerId: input.ownerId,
      repositoryRevision: input.repositoryRevision,
      workspaceRoot,
      lifecycle: "creating",
      workspace,
      leases: [],
      recoveryHistory: [],
      archiveMetadata: null,
      failureReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      readyAt: null,
      releasedAt: null,
      archivedAt: null,
    });
  }

  async get(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
  ): Promise<RepositorySandbox | null> {
    const sandbox = this.sandboxes.get(this.key(tenantId, sandboxId));
    return sandbox && sandbox.ownerId === ownerId && sandbox.repositoryId === repositoryId
      ? clone(sandbox)
      : null;
  }

  async prepare(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    now = new Date(),
  ): Promise<RepositorySandbox> {
    const sandbox = this.require(tenantId, ownerId, repositoryId, sandboxId);
    if (sandbox.lifecycle !== "creating") {
      throw new RepositorySandboxError(
        "repository_sandbox_lifecycle_conflict",
        "Only creating sandboxes may be prepared.",
      );
    }
    validateSandboxIntegrity(sandbox);
    const timestamp = now.toISOString();
    return this.save({
      ...sandbox,
      lifecycle: "ready",
      workspace: {
        ...sandbox.workspace,
        preparedAt: timestamp,
        preparationLatencyMs: Math.max(0, now.getTime() - Date.parse(sandbox.createdAt)),
      },
      failureReason: null,
      readyAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async failPreparation(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    reason: string, now = new Date(),
  ): Promise<RepositorySandbox> {
    const sandbox = this.require(tenantId, ownerId, repositoryId, sandboxId);
    if (sandbox.lifecycle !== "creating" || !reason.trim()) {
      throw new RepositorySandboxError(
        "repository_sandbox_lifecycle_conflict",
        "Only creating sandboxes may fail preparation with a reason.",
      );
    }
    const timestamp = now.toISOString();
    return this.save({
      ...sandbox,
      lifecycle: "failed",
      failureReason: `preparation:${reason.trim()}`,
      updatedAt: timestamp,
    });
  }

  async acquire(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    leaseOwner: string, leaseMs: number, quotas: SandboxQuotas, now = new Date(),
  ): Promise<SandboxClaim> {
    const sandbox = this.require(tenantId, ownerId, repositoryId, sandboxId);
    if (sandbox.lifecycle !== "ready" || !leaseOwner.trim() ||
        !Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new RepositorySandboxError(
        "repository_sandbox_lease_rejected",
        "A valid lease may only be acquired for a ready sandbox.",
      );
    }
    const activeLeases = [...this.sandboxes.values()].filter((candidate) =>
      candidate.tenantId === tenantId && candidate.ownerId === ownerId &&
      candidate.lifecycle === "leased").length;
    if (activeLeases >= quotas.activeLeasesPerOwner) {
      throw new RepositorySandboxError(
        "repository_sandbox_lease_quota_exceeded",
        "Active sandbox lease quota exceeded.",
        { limit: quotas.activeLeasesPerOwner },
      );
    }
    const fencingToken = sandbox.leases.length + 1;
    const startedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const leaseId = stableId("sandbox_lease", { sandboxId, leaseOwner, fencingToken });
    const claimToken = stableHash({
      sandboxId,
      ownerId,
      leaseOwner,
      fencingToken,
      repositoryRevision: sandbox.repositoryRevision,
      workspaceFingerprint: sandbox.workspace.workspaceFingerprint,
      startedAt,
      expiresAt,
    });
    const saved = this.save({
      ...sandbox,
      lifecycle: "leased",
      leases: [...sandbox.leases, {
        leaseId,
        sandboxId,
        ownerId,
        leaseOwner,
        fencingToken,
        claimToken,
        startedAt,
        renewedAt: startedAt,
        expiresAt,
        renewals: 0,
        releasedAt: null,
      }],
      updatedAt: startedAt,
    });
    return this.claim(saved, saved.leases.at(-1)!);
  }

  private claim(
    sandbox: RepositorySandbox,
    lease: RepositorySandbox["leases"][number],
  ): SandboxClaim {
    return clone({
      tenantId: sandbox.tenantId,
      sandboxId: sandbox.sandboxId,
      repositoryId: sandbox.repositoryId,
      workflowId: sandbox.workflowId,
      executionId: sandbox.executionId,
      ownerId: sandbox.ownerId,
      leaseOwner: lease.leaseOwner,
      repositoryRevision: sandbox.repositoryRevision,
      workspaceFingerprint: sandbox.workspace.workspaceFingerprint,
      fencingToken: lease.fencingToken,
      claimToken: lease.claimToken,
    });
  }

  private fenced(claim: SandboxClaim, now: Date): {
    sandbox: RepositorySandbox;
    leaseIndex: number;
  } {
    const sandbox = this.require(
      claim.tenantId, claim.ownerId, claim.repositoryId, claim.sandboxId,
    );
    if (sandbox.workflowId !== claim.workflowId ||
        sandbox.executionId !== claim.executionId ||
        sandbox.repositoryRevision !== claim.repositoryRevision ||
        sandbox.workspace.workspaceFingerprint !== claim.workspaceFingerprint) {
      throw new RepositorySandboxError(
        "repository_sandbox_revision_fence_rejected",
        "Sandbox claim targets a stale workflow, execution, revision, or workspace.",
      );
    }
    const leaseIndex = sandbox.leases.findIndex((lease) =>
      lease.leaseOwner === claim.leaseOwner &&
      lease.fencingToken === claim.fencingToken &&
      lease.claimToken === claim.claimToken &&
      lease.releasedAt === null);
    if (sandbox.lifecycle !== "leased" || leaseIndex < 0 ||
        Date.parse(sandbox.leases[leaseIndex]!.expiresAt) <= now.getTime()) {
      throw new RepositorySandboxError(
        "repository_sandbox_stale_lease",
        "Sandbox lease is expired, released, or fenced by a newer lease.",
      );
    }
    return { sandbox, leaseIndex };
  }

  async renew(
    claim: SandboxClaim, leaseMs: number, now = new Date(),
  ): Promise<SandboxClaim> {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new RepositorySandboxError(
        "repository_sandbox_lease_rejected",
        "Lease duration must be a positive integer.",
      );
    }
    const { sandbox, leaseIndex } = this.fenced(claim, now);
    const lease = sandbox.leases[leaseIndex]!;
    const timestamp = now.toISOString();
    const leases = [...sandbox.leases];
    leases[leaseIndex] = {
      ...lease,
      renewedAt: timestamp,
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      renewals: lease.renewals + 1,
    };
    const saved = this.save({ ...sandbox, leases, updatedAt: timestamp });
    return this.claim(saved, saved.leases[leaseIndex]!);
  }

  async release(claim: SandboxClaim, now = new Date()): Promise<RepositorySandbox> {
    const { sandbox, leaseIndex } = this.fenced(claim, now);
    const timestamp = now.toISOString();
    const leases = [...sandbox.leases];
    leases[leaseIndex] = { ...leases[leaseIndex]!, releasedAt: timestamp };
    return this.save({
      ...sandbox,
      lifecycle: "released",
      leases,
      releasedAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async archive(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    now = new Date(),
  ): Promise<RepositorySandbox> {
    const sandbox = this.require(tenantId, ownerId, repositoryId, sandboxId);
    if (!["released", "failed"].includes(sandbox.lifecycle)) {
      throw new RepositorySandboxError(
        "repository_sandbox_lifecycle_conflict",
        "Only released or failed sandboxes may be archived.",
      );
    }
    const archivedAt = now.toISOString();
    return this.save({
      ...sandbox,
      lifecycle: "archived",
      archiveMetadata: {
        sandboxId,
        archivedAt,
        repositoryRevision: sandbox.repositoryRevision,
        workspaceFingerprint: sandbox.workspace.workspaceFingerprint,
        leaseCount: sandbox.leases.length,
      },
      archivedAt,
      updatedAt: archivedAt,
    });
  }

  private recovery(
    sandbox: RepositorySandbox,
    reason: SandboxRecoveryReason,
    recoveredLifecycle: SandboxLifecycle,
    now: Date,
  ): RepositorySandbox {
    const createdAt = now.toISOString();
    return {
      ...sandbox,
      lifecycle: recoveredLifecycle,
      recoveryHistory: [...sandbox.recoveryHistory, {
        recoveryId: stableId("sandbox_recovery", {
          sandboxId: sandbox.sandboxId,
          reason,
          sequence: sandbox.recoveryHistory.length + 1,
        }),
        sandboxId: sandbox.sandboxId,
        reason,
        previousLifecycle: sandbox.lifecycle,
        recoveredLifecycle,
        createdAt,
      }],
      updatedAt: createdAt,
    };
  }

  async recover(
    now = new Date(),
    quotas: SandboxQuotas = {
      activePerOwner: 16,
      activeLeasesPerOwner: 8,
      leaseMs: 60_000,
      preparationTimeoutMs: 300_000,
      retainedSandboxes: 100,
      retainedRecoveryRecords: 100,
    },
  ): Promise<number> {
    let recovered = 0;
    for (const sandbox of [...this.sandboxes.values()]) {
      let updated: RepositorySandbox | null = null;
      if (sandbox.lifecycle === "leased") {
        const leaseIndex = sandbox.leases.findIndex((lease) => lease.releasedAt === null);
        const lease = sandbox.leases[leaseIndex];
        if (lease && Date.parse(lease.expiresAt) <= now.getTime()) {
          const leases = [...sandbox.leases];
          leases[leaseIndex] = { ...lease, releasedAt: now.toISOString() };
          updated = {
            ...this.recovery({ ...sandbox, leases }, "expired_lease", "released", now),
            releasedAt: now.toISOString(),
          };
        }
      } else if (sandbox.lifecycle === "creating" &&
          now.getTime() - Date.parse(sandbox.updatedAt) >= quotas.preparationTimeoutMs) {
        updated = {
          ...this.recovery(sandbox, "abandoned_sandbox", "failed", now),
          failureReason: "recovery:abandoned_preparation",
        };
      } else if (sandbox.lifecycle === "failed" &&
          sandbox.failureReason?.startsWith("preparation:")) {
        updated = {
          ...this.recovery(sandbox, "failed_preparation", "creating", now),
          failureReason: null,
        };
      }
      if (updated) {
        updated = {
          ...updated,
          recoveryHistory: updated.recoveryHistory.slice(-quotas.retainedRecoveryRecords),
        };
        this.save(updated);
        recovered += 1;
      }
    }
    return recovered;
  }

  async collect(tenantId: string, quotas: SandboxQuotas): Promise<number> {
    const terminal = [...this.sandboxes.entries()].filter(([, sandbox]) =>
      sandbox.tenantId === tenantId &&
      ["released", "archived", "failed"].includes(sandbox.lifecycle))
      .sort((left, right) =>
        right[1].updatedAt.localeCompare(left[1].updatedAt) ||
        right[1].sandboxId.localeCompare(left[1].sandboxId));
    let removed = 0;
    for (const [key] of terminal.slice(Math.max(1, quotas.retainedSandboxes))) {
      this.sandboxes.delete(key);
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string, now = new Date()): Promise<SandboxMetrics> {
    return [...this.sandboxes.values()]
      .filter((sandbox) => tenantId === undefined || sandbox.tenantId === tenantId)
      .reduce<SandboxMetrics>((metrics, sandbox) => ({
        sandboxCreation: metrics.sandboxCreation + 1,
        activeLeases: metrics.activeLeases + sandbox.leases.filter((lease) =>
          lease.releasedAt === null && Date.parse(lease.expiresAt) > now.getTime()).length,
        leaseRenewals: metrics.leaseRenewals +
          sandbox.leases.reduce((count, lease) => count + lease.renewals, 0),
        recoveryCount: metrics.recoveryCount + sandbox.recoveryHistory.length,
        preparationLatencyMs: metrics.preparationLatencyMs +
          sandbox.workspace.preparationLatencyMs,
        archiveCount: metrics.archiveCount + Number(sandbox.lifecycle === "archived"),
      }), emptyMetrics());
  }

  async verify(): Promise<void> {
    const workspaceRoots = new Set<string>();
    for (const sandbox of this.sandboxes.values()) {
      validateSandboxIntegrity(sandbox);
      const scopedRoot = `${sandbox.tenantId}\0${sandbox.workspaceRoot}`;
      if (workspaceRoots.has(scopedRoot)) {
        throw new RepositorySandboxError(
          "repository_sandbox_startup_validation_failed",
          "Sandbox workspace uniqueness validation failed.",
        );
      }
      workspaceRoots.add(scopedRoot);
    }
  }
}

interface RpcQuery extends PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> {}
interface DatabaseClient {
  rpc(name: string, parameters?: Record<string, unknown>): RpcQuery;
}
function first(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : undefined;
}

export class PostgresRepositorySandboxStore implements RepositorySandboxStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code = error.message?.match(/repository_sandbox_[a-z_]+/u)?.[0] ??
        "repository_sandbox_persistence_failed";
      throw new RepositorySandboxError(
        code, error.message ?? "Repository sandbox persistence failed.",
      );
    }
    return data;
  }

  private async load(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
  ): Promise<RepositorySandbox | null> {
    const data = await this.call("get_repository_sandbox", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_sandbox_id: sandboxId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    const value = first(data)?.sandbox ?? data;
    return value ? clone(value as RepositorySandbox) : null;
  }

  private async listOwner(
    tenantId: string, ownerId: string,
  ): Promise<RepositorySandbox[]> {
    const data = await this.call("list_repository_sandboxes_for_owner", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
    });
    return clone((first(data)?.sandboxes ?? data ?? []) as RepositorySandbox[]);
  }

  private async persist(
    sandbox: RepositorySandbox, expectedVersion: number | null,
  ): Promise<RepositorySandbox> {
    const data = await this.call("save_repository_sandbox", {
      input_sandbox: sandbox,
      input_expected_version: expectedVersion === null ? null : String(expectedVersion),
    });
    return clone((first(data)?.sandbox ?? data) as RepositorySandbox);
  }

  private async mutate<T>(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    operation: (memory: MemoryRepositorySandboxStore) => Promise<T>,
  ): Promise<{ value: T; sandbox: RepositorySandbox }> {
    const existing = await this.load(tenantId, ownerId, repositoryId, sandboxId);
    if (!existing) {
      throw new RepositorySandboxError(
        "repository_sandbox_not_found", "Repository sandbox was not found.",
      );
    }
    const memory = new MemoryRepositorySandboxStore();
    memory.hydrate(existing);
    const value = await operation(memory);
    const updated = await memory.get(tenantId, ownerId, repositoryId, sandboxId);
    if (!updated) {
      throw new RepositorySandboxError(
        "repository_sandbox_not_found", "Repository sandbox was not found.",
      );
    }
    return {
      value,
      sandbox: await this.persist(updated, existing.persistenceVersion),
    };
  }

  async create(input: CreateSandboxInput, quotas: SandboxQuotas, now?: Date) {
    const sandboxId = sandboxIdentity(input);
    const ownerSandboxes = await this.listOwner(input.tenantId, input.ownerId);
    const existing = ownerSandboxes.find((sandbox) =>
      sandbox.sandboxId === sandboxId && sandbox.repositoryId === input.repositoryId);
    const memory = new MemoryRepositorySandboxStore();
    for (const sandbox of ownerSandboxes) memory.hydrate(sandbox);
    const sandbox = await memory.create(input, quotas, now);
    return this.persist(sandbox, existing?.persistenceVersion ?? null);
  }

  get(tenantId: string, ownerId: string, repositoryId: string, sandboxId: string) {
    return this.load(tenantId, ownerId, repositoryId, sandboxId);
  }

  async prepare(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string, now?: Date,
  ) {
    return (await this.mutate(tenantId, ownerId, repositoryId, sandboxId,
      (memory) => memory.prepare(
        tenantId, ownerId, repositoryId, sandboxId, now,
      ))).sandbox;
  }

  async failPreparation(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    reason: string, now?: Date,
  ) {
    return (await this.mutate(tenantId, ownerId, repositoryId, sandboxId,
      (memory) => memory.failPreparation(
        tenantId, ownerId, repositoryId, sandboxId, reason, now,
      ))).sandbox;
  }

  async acquire(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    leaseOwner: string, leaseMs: number, quotas: SandboxQuotas, now?: Date,
  ) {
    const ownerSandboxes = await this.listOwner(tenantId, ownerId);
    const existing = ownerSandboxes.find((sandbox) =>
      sandbox.sandboxId === sandboxId && sandbox.repositoryId === repositoryId);
    if (!existing) {
      throw new RepositorySandboxError(
        "repository_sandbox_not_found", "Repository sandbox was not found.",
      );
    }
    const memory = new MemoryRepositorySandboxStore();
    for (const sandbox of ownerSandboxes) memory.hydrate(sandbox);
    const claim = await memory.acquire(
      tenantId, ownerId, repositoryId, sandboxId, leaseOwner, leaseMs, quotas, now,
    );
    const updated = await memory.get(tenantId, ownerId, repositoryId, sandboxId);
    if (!updated) {
      throw new RepositorySandboxError(
        "repository_sandbox_not_found", "Repository sandbox was not found.",
      );
    }
    await this.persist(updated, existing.persistenceVersion);
    return claim;
  }

  async renew(claim: SandboxClaim, leaseMs: number, now?: Date) {
    return (await this.mutate(
      claim.tenantId, claim.ownerId, claim.repositoryId, claim.sandboxId,
      (memory) => memory.renew(claim, leaseMs, now),
    )).value;
  }

  async release(claim: SandboxClaim, now?: Date) {
    return (await this.mutate(
      claim.tenantId, claim.ownerId, claim.repositoryId, claim.sandboxId,
      (memory) => memory.release(claim, now),
    )).sandbox;
  }

  async archive(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string, now?: Date,
  ) {
    return (await this.mutate(tenantId, ownerId, repositoryId, sandboxId,
      (memory) => memory.archive(
        tenantId, ownerId, repositoryId, sandboxId, now,
      ))).sandbox;
  }

  async recover(now = new Date(), quotas?: SandboxQuotas): Promise<number> {
    const data = await this.call("list_recoverable_repository_sandboxes");
    const sandboxes = (first(data)?.sandboxes ?? data ?? []) as RepositorySandbox[];
    let count = Number(await this.call("recover_orphan_repository_sandbox_metadata") ?? 0);
    for (const sandbox of sandboxes) {
      const memory = new MemoryRepositorySandboxStore();
      memory.hydrate(sandbox);
      const recovered = await memory.recover(now, quotas);
      if (recovered > 0) {
        const updated = await memory.get(
          sandbox.tenantId, sandbox.ownerId, sandbox.repositoryId, sandbox.sandboxId,
        );
        if (updated) await this.persist(updated, sandbox.persistenceVersion);
        count += recovered;
      }
    }
    return count;
  }

  async collect(tenantId: string, quotas: SandboxQuotas): Promise<number> {
    const data = await this.call("collect_repository_sandboxes", {
      input_tenant_id: tenantId,
      input_sandbox_retention: quotas.retainedSandboxes,
      input_recovery_retention: quotas.retainedRecoveryRecords,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string): Promise<SandboxMetrics> {
    const data = await this.call("repository_sandbox_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as SandboxMetrics);
  }

  async verify(): Promise<void> {
    const data = await this.call("verify_repository_sandbox_contract", {
      input_engine_version: REPOSITORY_SANDBOX_ENGINE_VERSION,
      input_schema_version: REPOSITORY_SANDBOX_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositorySandboxError(
        "repository_sandbox_startup_validation_failed",
        "Repository sandbox database contract is invalid.",
        { problems: row.problems ?? [] },
      );
    }
  }
}

export const runtimeRepositorySandboxStore: RepositorySandboxStore =
  new PostgresRepositorySandboxStore(supabase as unknown as SupabaseClient);
