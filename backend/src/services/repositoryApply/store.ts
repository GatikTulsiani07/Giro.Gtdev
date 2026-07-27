import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  ApplyConfirmation,
  ApplyLifecycleEvent,
  ApplyMetrics,
  ApplyQuotas,
  ApplyRecoveryRecord,
  ApplyTransactionLifecycle,
  ApplyTransactionVersion,
  ConfirmApplyTransactionInput,
  PrepareApplyTransactionInput,
  RepositoryApplyTransaction,
} from "./types.js";
import {
  REPOSITORY_APPLY_ENGINE_VERSION,
  REPOSITORY_APPLY_PLAN_SCHEMA_VERSION,
  REPOSITORY_APPLY_SCHEMA_VERSION,
  RepositoryApplyError,
} from "./types.js";
import {
  applyPlanHash,
  applyTransactionIdentity,
  buildApplyPlan,
  validateApplyInput,
  validateApplyIntegrity,
} from "./validation.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
const clone = <T>(value: T): T => deepFreeze(structuredClone(value));
const terminal = new Set<ApplyTransactionLifecycle>([
  "ready", "cancelled", "expired", "archived",
]);
const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export interface RepositoryApplyStore {
  prepare(
    input: PrepareApplyTransactionInput,
    quotas: ApplyQuotas,
    now?: Date,
  ): Promise<RepositoryApplyTransaction>;
  get(
    tenantId: string,
    transactionId: string,
    ownerId: string,
  ): Promise<RepositoryApplyTransaction | null>;
  confirm(
    input: ConfirmApplyTransactionInput,
    now?: Date,
  ): Promise<RepositoryApplyTransaction>;
  archive(
    tenantId: string,
    transactionId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ): Promise<RepositoryApplyTransaction>;
  recover(now?: Date, quotas?: ApplyQuotas): Promise<number>;
  collect(tenantId: string, quotas: ApplyQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<ApplyMetrics>;
  verify(quotas?: ApplyQuotas): Promise<void>;
}

function lifecycleEvent(
  transactionId: string,
  transactionVersion: number,
  from: ApplyTransactionLifecycle | null,
  to: ApplyTransactionLifecycle,
  reason: string,
  createdAt: string,
  sequence: number,
): ApplyLifecycleEvent {
  return {
    eventId: stableId("repository_apply_lifecycle", {
      transactionId, transactionVersion, from, to, reason, sequence,
    }),
    transactionVersion, from, to, reason, createdAt,
  };
}

const emptyMetrics = (): ApplyMetrics => ({
  transactionsCreated: 0,
  validationFailures: 0,
  rollbackPlans: 0,
  conflicts: 0,
  preparationLatencyMs: 0,
  recoveryCount: 0,
});

export class MemoryRepositoryApplyStore implements RepositoryApplyStore {
  private readonly transactions =
    new Map<string, RepositoryApplyTransaction>();
  private rejectedValidationCount = 0;
  private rejectedConflictCount = 0;

  private key(tenantId: string, transactionId: string): string {
    return `${tenantId}\0${transactionId}`;
  }

  hydrate(transaction: RepositoryApplyTransaction): void {
    this.transactions.set(
      this.key(transaction.tenantId, transaction.transactionId),
      clone(transaction),
    );
  }

  private save(
    transaction: RepositoryApplyTransaction,
  ): RepositoryApplyTransaction {
    const key = this.key(transaction.tenantId, transaction.transactionId);
    const existing = this.transactions.get(key);
    const saved = clone({
      ...transaction,
      persistenceVersion: existing
        ? Math.max(
          existing.persistenceVersion, transaction.persistenceVersion) + 1
        : 1,
    });
    this.transactions.set(key, saved);
    return clone(saved);
  }

  private require(
    tenantId: string,
    transactionId: string,
    ownerId: string,
  ): RepositoryApplyTransaction {
    const transaction = this.transactions.get(
      this.key(tenantId, transactionId));
    if (!transaction) {
      throw new RepositoryApplyError(
        "repository_apply_not_found", "Apply transaction was not found.");
    }
    if (transaction.ownerId !== ownerId) {
      throw new RepositoryApplyError(
        "repository_apply_ownership_conflict",
        "Apply transaction belongs to another owner.");
    }
    return transaction;
  }

  async prepare(
    input: PrepareApplyTransactionInput,
    quotas: ApplyQuotas,
    now = new Date(),
  ): Promise<RepositoryApplyTransaction> {
    const transactionId = applyTransactionIdentity(input);
    const existing = this.transactions.get(
      this.key(input.tenantId, transactionId));
    const transactionCount = [...this.transactions.values()].filter((value) =>
      value.tenantId === input.tenantId &&
      value.proposalId === input.proposal.proposalId &&
      value.transactionId !== transactionId).length;
    try {
      validateApplyInput(
        input, quotas, existing?.transactionVersion ?? 0,
        transactionCount, now,
      );
    } catch (error) {
      this.rejectedValidationCount += 1;
      throw error;
    }
    if (existing && existing.lifecycle !== "cancelled") {
      this.rejectedValidationCount += 1;
      throw new RepositoryApplyError(
        "repository_apply_lifecycle_conflict",
        "Only cancelled transactions may be prepared again.");
    }
    const timestamp = now.toISOString();
    const transactionVersion = (existing?.transactionVersion ?? 0) + 1;
    let built;
    try {
      built = buildApplyPlan(
        input, transactionId, transactionVersion, quotas, timestamp);
    } catch (error) {
      this.rejectedValidationCount += 1;
      if (error instanceof RepositoryApplyError &&
          error.code === "repository_apply_conflict") {
        this.rejectedConflictCount +=
          Number(error.details.conflictCount ?? 1);
      }
      throw error;
    }
    const proposalVersion = input.proposal.versions.at(-1)!;
    const artifactVersions = [...input.artifacts]
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        artifactVersion: artifact.artifactVersion,
        contentHash: artifact.versions.at(-1)!.contentHash,
      }));
    const patchVersions = [...input.patches]
      .sort((left, right) =>
        left.patchVersion - right.patchVersion ||
        left.patchId.localeCompare(right.patchId))
      .map((patch) => ({
        patchId: patch.patchId,
        patchVersion: patch.patchVersion,
        contentHash: patch.contentHash,
      }));
    const deterministicSeed = stableHash({
      transactionId,
      transactionVersion,
      proposalId: input.proposal.proposalId,
      proposalVersion: input.proposal.proposalVersion,
      proposalOutputHash: proposalVersion.outputHash,
      workspacePersistenceVersion: input.workspace.persistenceVersion,
      artifactVersions,
      patchVersions,
      executionVersion: input.executionMetadata.executionVersion,
    });
    const versionBody: Omit<ApplyTransactionVersion, "planHash"> = {
      transactionId,
      transactionVersion,
      applyPlan: built.plan,
      preparationMetadata: {
        engineVersion: REPOSITORY_APPLY_ENGINE_VERSION,
        schemaVersion: REPOSITORY_APPLY_PLAN_SCHEMA_VERSION,
        deterministicSeed,
        proposalVersion: input.proposal.proposalVersion,
        proposalOutputHash: proposalVersion.outputHash,
        workspacePersistenceVersion: input.workspace.persistenceVersion,
        snapshotHash: input.workspace.snapshot.snapshotHash,
        executionVersion: input.executionMetadata.executionVersion,
        artifactVersions,
        patchVersions,
        preparedAt: timestamp,
        preparationLatencyMs: 0,
      },
      createdAt: timestamp,
      preparedAt: timestamp,
      validatedAt: timestamp,
    };
    const version: ApplyTransactionVersion = {
      ...versionBody,
      planHash: applyPlanHash(versionBody),
    };
    const history = [...(existing?.lifecycleHistory ?? [])];
    const transitions: readonly [
      ApplyTransactionLifecycle | null,
      ApplyTransactionLifecycle,
      string,
    ][] = [
      [existing?.lifecycle ?? null, "created", "transaction_version_created"],
      ["created", "preparing", "apply_plan_preparation_started"],
      ["preparing", "validating", "apply_plan_validation_started"],
      ["validating", "awaiting_confirmation", "apply_plan_prepared"],
    ];
    for (const [from, to, reason] of transitions) {
      history.push(lifecycleEvent(
        transactionId, transactionVersion, from, to, reason, timestamp,
        history.length + 1,
      ));
    }
    return this.save({
      transactionId,
      schemaVersion: REPOSITORY_APPLY_SCHEMA_VERSION,
      persistenceVersion: existing?.persistenceVersion ?? 0,
      tenantId: input.tenantId,
      proposalId: input.proposal.proposalId,
      repositoryId: input.proposal.repositoryId,
      repositoryRevision: input.proposal.repositoryRevision,
      executionId: input.proposal.executionId,
      workspaceId: input.proposal.workspaceId,
      ownerId: input.ownerId,
      transactionVersion,
      lifecycle: "awaiting_confirmation",
      versions: [...(existing?.versions ?? []), version],
      diagnostics: [
        ...(existing?.diagnostics ?? []), ...built.plan.diagnostics,
      ],
      confirmations: existing?.confirmations ?? [],
      lifecycleHistory: history,
      recoveryHistory: existing?.recoveryHistory ?? [],
      archiveMetadata: null,
      validationFailureCount: existing?.validationFailureCount ?? 0,
      conflictCount: (existing?.conflictCount ?? 0) + built.conflictCount,
      recoveryCount: existing?.recoveryCount ?? 0,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
      confirmationRequestedAt: timestamp,
      applyLeaseExpiresAt: input.applyLeaseExpiresAt ?? null,
    });
  }

  async get(tenantId: string, transactionId: string, ownerId: string) {
    const transaction = this.transactions.get(
      this.key(tenantId, transactionId));
    if (!transaction) return null;
    if (transaction.ownerId !== ownerId) {
      throw new RepositoryApplyError(
        "repository_apply_ownership_conflict",
        "Apply transaction belongs to another owner.");
    }
    return clone(transaction);
  }

  async confirm(
    input: ConfirmApplyTransactionInput,
    now = new Date(),
  ): Promise<RepositoryApplyTransaction> {
    const transaction = this.require(
      input.tenantId, input.transactionId, input.ownerId);
    if (!input.confirmerId.trim() || !input.idempotencyKey.trim() ||
        input.rationaleCodes.some((code) => !code.trim()) ||
        !["ready", "cancelled"].includes(input.decision)) {
      throw new RepositoryApplyError(
        "repository_apply_confirmation_invalid",
        "Apply confirmation is malformed.");
    }
    const rationaleCodes = sortedUnique(input.rationaleCodes);
    const payloadHash = stableHash({
      transactionId: input.transactionId,
      transactionVersion: input.transactionVersion,
      confirmerId: input.confirmerId,
      decision: input.decision,
      rationaleCodes,
    });
    const replay = transaction.confirmations.find((confirmation) =>
      confirmation.idempotencyKey === input.idempotencyKey);
    if (replay) {
      const replayHash = stableHash({
        transactionId: replay.transactionId,
        transactionVersion: replay.transactionVersion,
        confirmerId: replay.confirmerId,
        decision: replay.decision,
        rationaleCodes: replay.rationaleCodes,
      });
      if (replayHash !== payloadHash) {
        throw new RepositoryApplyError(
          "repository_apply_idempotency_conflict",
          "Confirmation idempotency payload conflicts.");
      }
      return clone(transaction);
    }
    if (transaction.lifecycle !== "awaiting_confirmation") {
      throw new RepositoryApplyError(
        "repository_apply_lifecycle_conflict",
        "Only transactions awaiting confirmation may be confirmed.");
    }
    if (transaction.transactionVersion !== input.transactionVersion) {
      throw new RepositoryApplyError(
        "repository_apply_version_stale",
        "Confirmation targets a stale transaction version.");
    }
    const timestamp = now.toISOString();
    const confirmation: ApplyConfirmation = {
      confirmationId: stableId("repository_apply_confirmation", {
        transactionId: transaction.transactionId,
        transactionVersion: transaction.transactionVersion,
        idempotencyKey: input.idempotencyKey,
      }),
      transactionId: transaction.transactionId,
      transactionVersion: transaction.transactionVersion,
      ownerId: input.ownerId,
      confirmerId: input.confirmerId,
      decision: input.decision,
      rationaleCodes,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    };
    return this.save({
      ...transaction,
      lifecycle: input.decision,
      confirmations: [...transaction.confirmations, confirmation],
      lifecycleHistory: [...transaction.lifecycleHistory, lifecycleEvent(
        transaction.transactionId, transaction.transactionVersion,
        transaction.lifecycle, input.decision, "apply_plan_confirmed",
        timestamp, transaction.lifecycleHistory.length + 1,
      )],
      updatedAt: timestamp,
      completedAt: timestamp,
      applyLeaseExpiresAt: null,
    });
  }

  async archive(
    tenantId: string,
    transactionId: string,
    ownerId: string,
    expectedVersion: number,
    now = new Date(),
  ): Promise<RepositoryApplyTransaction> {
    const transaction = this.require(tenantId, transactionId, ownerId);
    if (transaction.transactionVersion !== expectedVersion) {
      throw new RepositoryApplyError(
        "repository_apply_version_stale",
        "Archive targets a stale transaction version.");
    }
    if (!["ready", "cancelled", "expired"].includes(transaction.lifecycle)) {
      throw new RepositoryApplyError(
        "repository_apply_lifecycle_conflict",
        "Only completed transactions may be archived.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...transaction,
      lifecycle: "archived",
      lifecycleHistory: [...transaction.lifecycleHistory, lifecycleEvent(
        transaction.transactionId, transaction.transactionVersion,
        transaction.lifecycle, "archived", "manual_archive",
        timestamp, transaction.lifecycleHistory.length + 1,
      )],
      archiveMetadata: {
        archivedAt: timestamp,
        reason: "manual",
        finalTransactionVersion: transaction.transactionVersion,
        planHash: transaction.versions.at(-1)!.planHash,
      },
      updatedAt: timestamp,
      completedAt: timestamp,
      applyLeaseExpiresAt: null,
    });
  }

  private recovered(
    transaction: RepositoryApplyTransaction,
    reason: ApplyRecoveryRecord["reason"],
    now: Date,
  ): RepositoryApplyTransaction {
    const timestamp = now.toISOString();
    const recovery: ApplyRecoveryRecord = {
      recoveryId: stableId("repository_apply_recovery", {
        transactionId: transaction.transactionId,
        transactionVersion: transaction.transactionVersion,
        reason,
        sequence: transaction.recoveryHistory.length + 1,
      }),
      reason,
      previousLifecycle: transaction.lifecycle,
      recoveredLifecycle: "expired",
      createdAt: timestamp,
    };
    return {
      ...transaction,
      lifecycle: "expired",
      recoveryHistory: [...transaction.recoveryHistory, recovery],
      lifecycleHistory: [...transaction.lifecycleHistory, lifecycleEvent(
        transaction.transactionId, transaction.transactionVersion,
        transaction.lifecycle, "expired", `recovery_${reason}`,
        timestamp, transaction.lifecycleHistory.length + 1,
      )],
      recoveryCount: transaction.recoveryCount + 1,
      updatedAt: timestamp,
      completedAt: timestamp,
      applyLeaseExpiresAt: null,
    };
  }

  async recover(now = new Date(), quotas?: ApplyQuotas): Promise<number> {
    let count = 0;
    for (const transaction of [...this.transactions.values()]) {
      if (terminal.has(transaction.lifecycle)) continue;
      const age = now.getTime() - Date.parse(transaction.updatedAt);
      let reason: ApplyRecoveryRecord["reason"] | null = null;
      if (transaction.applyLeaseExpiresAt &&
          Date.parse(transaction.applyLeaseExpiresAt) <= now.getTime()) {
        reason = "expired_lease";
      } else if (transaction.versions.length !==
          transaction.transactionVersion ||
          transaction.versions.some((version) =>
            version.applyPlan.rollbackPlan.inverseOperations.length !==
              version.applyPlan.orderedOperations.length)) {
        reason = "incomplete_apply_plan";
      } else if ((transaction.lifecycle === "preparing" ||
          transaction.lifecycle === "validating") &&
          (!quotas || age >= quotas.preparationTimeoutMs)) {
        reason = "incomplete_apply_plan";
      } else if (transaction.lifecycle === "created" &&
          (!quotas || age >= quotas.preparationTimeoutMs)) {
        reason = "abandoned_transaction";
      } else if (transaction.lifecycle === "awaiting_confirmation" &&
          quotas && age >= quotas.confirmationTtlMs) {
        reason = "stale_confirmation";
      }
      if (reason) {
        this.save(this.recovered(transaction, reason, now));
        count += 1;
      }
    }
    return count;
  }

  async collect(tenantId: string, quotas: ApplyQuotas): Promise<number> {
    const completed = [...this.transactions.entries()]
      .filter(([, transaction]) =>
        transaction.tenantId === tenantId && terminal.has(transaction.lifecycle))
      .sort((left, right) =>
        (right[1].completedAt ?? right[1].updatedAt).localeCompare(
          left[1].completedAt ?? left[1].updatedAt) ||
        right[1].transactionId.localeCompare(left[1].transactionId));
    let removed = 0;
    for (const [key] of completed.slice(
      Math.max(1, quotas.retainedTransactions))) {
      this.transactions.delete(key);
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string): Promise<ApplyMetrics> {
    const metrics = [...this.transactions.values()]
      .filter((transaction) =>
        tenantId === undefined || transaction.tenantId === tenantId)
      .reduce<ApplyMetrics>((result, transaction) => ({
        transactionsCreated:
          result.transactionsCreated + transaction.versions.length,
        validationFailures:
          result.validationFailures + transaction.validationFailureCount,
        rollbackPlans: result.rollbackPlans + transaction.versions.filter(
          (version) => version.applyPlan.rollbackPlan.inverseOperations.length ===
            version.applyPlan.orderedOperations.length).length,
        conflicts: result.conflicts + transaction.conflictCount,
        preparationLatencyMs: result.preparationLatencyMs +
          transaction.versions.reduce((sum, version) =>
            sum + version.preparationMetadata.preparationLatencyMs, 0),
        recoveryCount: result.recoveryCount + transaction.recoveryCount,
      }), emptyMetrics());
    return {
      ...metrics,
      validationFailures:
        metrics.validationFailures + this.rejectedValidationCount,
      conflicts: metrics.conflicts + this.rejectedConflictCount,
    };
  }

  async verify(quotas?: ApplyQuotas): Promise<void> {
    const validationQuotas = quotas ?? {
      transactionsPerProposal: Number.MAX_SAFE_INTEGER,
      versionsPerTransaction: Number.MAX_SAFE_INTEGER,
      operationsPerPlan: Number.MAX_SAFE_INTEGER,
      filesPerPlan: Number.MAX_SAFE_INTEGER,
      symbolsPerPlan: Number.MAX_SAFE_INTEGER,
      dependenciesPerPlan: Number.MAX_SAFE_INTEGER,
      diagnosticsPerTransaction: Number.MAX_SAFE_INTEGER,
      planBytes: Number.MAX_SAFE_INTEGER,
      retainedTransactions: Number.MAX_SAFE_INTEGER,
      retainedVersions: Number.MAX_SAFE_INTEGER,
      retainedDiagnostics: Number.MAX_SAFE_INTEGER,
      preparationTimeoutMs: Number.MAX_SAFE_INTEGER,
      confirmationTtlMs: Number.MAX_SAFE_INTEGER,
    };
    for (const transaction of this.transactions.values()) {
      validateApplyIntegrity(transaction, validationQuotas);
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
  return Array.isArray(value)
    ? value[0] as Record<string, unknown> | undefined : undefined;
}

export class PostgresRepositoryApplyStore implements RepositoryApplyStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(
    name: string,
    parameters: Record<string, unknown> = {},
  ): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code = error.message?.match(/repository_apply_[a-z_]+/u)?.[0] ??
        "repository_apply_persistence_failed";
      throw new RepositoryApplyError(
        code, error.message ?? "Apply transaction persistence failed.");
    }
    return data;
  }

  private async load(
    tenantId: string,
    transactionId: string,
  ): Promise<RepositoryApplyTransaction | null> {
    const data = await this.call("get_repository_apply_transaction", {
      input_tenant_id: tenantId,
      input_transaction_id: transactionId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone(
      (first(data)?.transaction ?? data) as RepositoryApplyTransaction);
  }

  private async persist(
    transaction: RepositoryApplyTransaction,
    expectedVersion: number | null,
  ): Promise<RepositoryApplyTransaction> {
    const data = await this.call("save_repository_apply_transaction", {
      input_transaction: transaction,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    return clone(
      (first(data)?.transaction ?? data) as RepositoryApplyTransaction);
  }

  private async mutate(
    tenantId: string,
    transactionId: string,
    operation: (
      memory: MemoryRepositoryApplyStore,
      existing: RepositoryApplyTransaction,
    ) => Promise<unknown>,
  ): Promise<RepositoryApplyTransaction> {
    const existing = await this.load(tenantId, transactionId);
    if (!existing) {
      throw new RepositoryApplyError(
        "repository_apply_not_found", "Apply transaction was not found.");
    }
    const memory = new MemoryRepositoryApplyStore();
    memory.hydrate(existing);
    await operation(memory, existing);
    const updated = await memory.get(
      tenantId, transactionId, existing.ownerId);
    if (!updated) {
      throw new RepositoryApplyError(
        "repository_apply_not_found", "Apply transaction was not found.");
    }
    return this.persist(updated, existing.persistenceVersion);
  }

  async prepare(
    input: PrepareApplyTransactionInput,
    quotas: ApplyQuotas,
    now?: Date,
  ) {
    const transactionId = applyTransactionIdentity(input);
    const existing = await this.load(input.tenantId, transactionId);
    if (!existing) {
      const countData = await this.call(
        "count_repository_proposal_apply_transactions", {
          input_tenant_id: input.tenantId,
          input_proposal_id: input.proposal.proposalId,
        });
      const count = Number(
        first(countData)?.transaction_count ?? countData ?? 0);
      if (count >= quotas.transactionsPerProposal) {
        throw new RepositoryApplyError(
          "repository_apply_quota_exceeded",
          "Proposal apply transaction quota exceeded.");
      }
    }
    const memory = new MemoryRepositoryApplyStore();
    if (existing) memory.hydrate(existing);
    const transaction = await memory.prepare(input, quotas, now);
    return this.persist(transaction, existing?.persistenceVersion ?? null);
  }

  async get(tenantId: string, transactionId: string, ownerId: string) {
    const transaction = await this.load(tenantId, transactionId);
    if (transaction && transaction.ownerId !== ownerId) {
      throw new RepositoryApplyError(
        "repository_apply_ownership_conflict",
        "Apply transaction belongs to another owner.");
    }
    return transaction;
  }

  async confirm(input: ConfirmApplyTransactionInput, now?: Date) {
    return this.mutate(input.tenantId, input.transactionId,
      (memory) => memory.confirm(input, now));
  }

  async archive(
    tenantId: string,
    transactionId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ) {
    return this.mutate(tenantId, transactionId,
      (memory) => memory.archive(
        tenantId, transactionId, ownerId, expectedVersion, now));
  }

  async recover(now = new Date(), quotas?: ApplyQuotas) {
    const data = await this.call("list_recoverable_repository_apply_transactions");
    const transactions = (
      first(data)?.transactions ?? data ?? []
    ) as unknown as RepositoryApplyTransaction[];
    let count = 0;
    for (const transaction of transactions) {
      const memory = new MemoryRepositoryApplyStore();
      memory.hydrate(transaction);
      const recovered = await memory.recover(now, quotas);
      if (recovered > 0) {
        const updated = await memory.get(
          transaction.tenantId, transaction.transactionId,
          transaction.ownerId);
        if (updated) {
          await this.persist(updated, transaction.persistenceVersion);
        }
      }
      count += recovered;
    }
    return count;
  }

  async collect(tenantId: string, quotas: ApplyQuotas) {
    const data = await this.call("collect_repository_apply_transactions", {
      input_tenant_id: tenantId,
      input_transaction_retention: quotas.retainedTransactions,
      input_version_retention: quotas.retainedVersions,
      input_diagnostic_retention: quotas.retainedDiagnostics,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("repository_apply_transaction_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as ApplyMetrics);
  }

  async verify() {
    const data = await this.call("verify_repository_apply_contract", {
      input_engine_version: REPOSITORY_APPLY_ENGINE_VERSION,
      input_schema_version: REPOSITORY_APPLY_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositoryApplyError(
        "repository_apply_startup_validation_failed",
        "Apply transaction database contract is invalid.",
        { problems: row.problems ?? [] },
      );
    }
  }
}

export const runtimeRepositoryApplyStore: RepositoryApplyStore =
  new PostgresRepositoryApplyStore(supabase as unknown as SupabaseClient);
