import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  currentTraceContext,
  runWithChildSpan,
} from "../../observability/tracing.js";
import type { RepositoryApplyStore } from "./store.js";
import { runtimeRepositoryApplyStore } from "./store.js";
import type {
  ApplyQuotas,
  ConfirmApplyTransactionInput,
  PrepareApplyTransactionInput,
} from "./types.js";

export const DEFAULT_APPLY_QUOTAS: ApplyQuotas = Object.freeze({
  transactionsPerProposal: 3,
  versionsPerTransaction: 100,
  operationsPerPlan: 10_000,
  filesPerPlan: 5_000,
  symbolsPerPlan: 10_000,
  dependenciesPerPlan: 20_000,
  diagnosticsPerTransaction: 2_000,
  planBytes: 16 * 1024 * 1024,
  retainedTransactions: 100,
  retainedVersions: 100,
  retainedDiagnostics: 2_000,
  preparationTimeoutMs: 5 * 60 * 1_000,
  confirmationTtlMs: 30 * 24 * 60 * 60 * 1_000,
});

export class RepositoryApplyEngine {
  constructor(
    private readonly store: RepositoryApplyStore = runtimeRepositoryApplyStore,
    private readonly quotas: ApplyQuotas = DEFAULT_APPLY_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async prepare(input: PrepareApplyTransactionInput) {
    return runWithChildSpan(async () => {
      const transaction = await this.store.prepare(input, this.quotas);
      this.log("repository_apply.prepared", transaction.transactionId, {
        proposalId: transaction.proposalId,
        repositoryId: transaction.repositoryId,
        repositoryRevision: transaction.repositoryRevision,
        workspaceId: transaction.workspaceId,
        transactionVersion: transaction.transactionVersion,
      });
      await this.recordMetrics();
      return transaction;
    });
  }

  get(tenantId: string, transactionId: string, ownerId: string) {
    return this.store.get(tenantId, transactionId, ownerId);
  }

  async confirm(input: ConfirmApplyTransactionInput) {
    const transaction = await this.store.confirm(input);
    await this.recordMetrics();
    return transaction;
  }

  archive(
    tenantId: string,
    transactionId: string,
    ownerId: string,
    expectedVersion: number,
  ) {
    return this.store.archive(
      tenantId, transactionId, ownerId, expectedVersion);
  }

  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    this.log("repository_apply.recovered", null, { recoveryCount: count });
    await this.recordMetrics();
    return count;
  }

  collect(tenantId: string) {
    return this.store.collect(tenantId, this.quotas);
  }

  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }

  verify() {
    return this.store.verify(this.quotas);
  }

  private async recordMetrics(): Promise<void> {
    runtimeMetrics.recordRepositoryApply(await this.store.metrics());
  }

  private log(
    operation: string,
    transactionId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      transactionId,
      ...fields,
    });
  }
}

export const runtimeRepositoryApplyEngine = new RepositoryApplyEngine();
