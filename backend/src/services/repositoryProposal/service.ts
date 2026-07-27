import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  currentTraceContext,
  runWithChildSpan,
} from "../../observability/tracing.js";
import type { RepositoryProposalStore } from "./store.js";
import { runtimeRepositoryProposalStore } from "./store.js";
import type {
  AssembleProposalInput,
  DecideProposalInput,
  ProposalQuotas,
} from "./types.js";

export const DEFAULT_PROPOSAL_QUOTAS: ProposalQuotas = Object.freeze({
  proposalsPerWorkspace: 3,
  versionsPerProposal: 100,
  artifactsPerProposal: 100,
  reviewsPerProposal: 100,
  patchesPerProposal: 100,
  filesPerManifest: 5_000,
  symbolsPerManifest: 10_000,
  diagnosticsPerProposal: 2_000,
  manifestBytes: 8 * 1024 * 1024,
  retainedProposals: 100,
  retainedVersions: 100,
  retainedDiagnostics: 2_000,
  assemblyTimeoutMs: 5 * 60 * 1_000,
  proposalTtlMs: 30 * 24 * 60 * 60 * 1_000,
});

export class RepositoryProposalEngine {
  constructor(
    private readonly store: RepositoryProposalStore =
      runtimeRepositoryProposalStore,
    private readonly quotas: ProposalQuotas = DEFAULT_PROPOSAL_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async assemble(input: AssembleProposalInput) {
    return runWithChildSpan(async () => {
      const proposal = await this.store.assemble(input, this.quotas);
      this.log("repository_proposal.assembled", proposal.proposalId, {
        repositoryId: proposal.repositoryId,
        repositoryRevision: proposal.repositoryRevision,
        workspaceId: proposal.workspaceId,
        executionId: proposal.executionId,
        proposalVersion: proposal.proposalVersion,
      });
      await this.recordMetrics();
      return proposal;
    });
  }

  get(tenantId: string, proposalId: string, ownerId: string) {
    return this.store.get(tenantId, proposalId, ownerId);
  }

  async decide(input: DecideProposalInput) {
    const proposal = await this.store.decide(input);
    await this.recordMetrics();
    return proposal;
  }

  archive(
    tenantId: string,
    proposalId: string,
    ownerId: string,
    expectedVersion: number,
  ) {
    return this.store.archive(
      tenantId, proposalId, ownerId, expectedVersion,
    );
  }

  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    this.log("repository_proposal.recovered", null, { recoveryCount: count });
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
    runtimeMetrics.recordRepositoryProposal(await this.store.metrics());
  }

  private log(
    operation: string,
    proposalId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      proposalId,
      ...fields,
    });
  }
}

export const runtimeRepositoryProposalEngine =
  new RepositoryProposalEngine();
