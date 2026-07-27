import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  AssembleProposalInput,
  DecideProposalInput,
  ProposalDecision,
  ProposalLifecycle,
  ProposalLifecycleEvent,
  ProposalMetrics,
  ProposalQuotas,
  ProposalRecoveryRecord,
  ProposalVersion,
  RepositoryProposal,
} from "./types.js";
import {
  REPOSITORY_PROPOSAL_ENGINE_VERSION,
  REPOSITORY_PROPOSAL_OUTPUT_SCHEMA_VERSION,
  REPOSITORY_PROPOSAL_SCHEMA_VERSION,
  RepositoryProposalError,
} from "./types.js";
import {
  assembleManifest,
  proposalIdentity,
  proposalOutputHash,
  validateProposalInput,
  validateProposalIntegrity,
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
const terminal = new Set<ProposalLifecycle>([
  "approved", "rejected", "archived", "expired",
]);
const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export interface RepositoryProposalStore {
  assemble(
    input: AssembleProposalInput,
    quotas: ProposalQuotas,
    now?: Date,
  ): Promise<RepositoryProposal>;
  get(
    tenantId: string,
    proposalId: string,
    ownerId: string,
  ): Promise<RepositoryProposal | null>;
  decide(
    input: DecideProposalInput,
    now?: Date,
  ): Promise<RepositoryProposal>;
  archive(
    tenantId: string,
    proposalId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ): Promise<RepositoryProposal>;
  recover(now?: Date, quotas?: ProposalQuotas): Promise<number>;
  collect(tenantId: string, quotas: ProposalQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<ProposalMetrics>;
  verify(quotas?: ProposalQuotas): Promise<void>;
}

function lifecycleEvent(
  proposalId: string,
  proposalVersion: number,
  from: ProposalLifecycle | null,
  to: ProposalLifecycle,
  reason: string,
  createdAt: string,
  sequence: number,
): ProposalLifecycleEvent {
  return {
    eventId: stableId("repository_proposal_lifecycle", {
      proposalId, proposalVersion, from, to, reason, sequence,
    }),
    proposalVersion, from, to, reason, createdAt,
  };
}

function emptyMetrics(): ProposalMetrics {
  return {
    proposalsAssembled: 0,
    validationFailures: 0,
    rejectedProposals: 0,
    manifestSize: 0,
    diagnosticsCount: 0,
    assemblyLatencyMs: 0,
    recoveryCount: 0,
  };
}

export class MemoryRepositoryProposalStore implements RepositoryProposalStore {
  private readonly proposals = new Map<string, RepositoryProposal>();
  private rejectedValidationCount = 0;

  private key(tenantId: string, proposalId: string): string {
    return `${tenantId}\0${proposalId}`;
  }

  hydrate(proposal: RepositoryProposal): void {
    this.proposals.set(
      this.key(proposal.tenantId, proposal.proposalId), clone(proposal),
    );
  }

  private save(proposal: RepositoryProposal): RepositoryProposal {
    const key = this.key(proposal.tenantId, proposal.proposalId);
    const existing = this.proposals.get(key);
    const saved = clone({
      ...proposal,
      persistenceVersion: existing
        ? Math.max(existing.persistenceVersion, proposal.persistenceVersion) + 1
        : 1,
    });
    this.proposals.set(key, saved);
    return clone(saved);
  }

  private require(
    tenantId: string,
    proposalId: string,
    ownerId: string,
  ): RepositoryProposal {
    const proposal = this.proposals.get(this.key(tenantId, proposalId));
    if (!proposal) {
      throw new RepositoryProposalError(
        "repository_proposal_not_found", "Proposal was not found.");
    }
    if (proposal.ownerId !== ownerId) {
      throw new RepositoryProposalError(
        "repository_proposal_ownership_conflict",
        "Proposal belongs to another owner.");
    }
    return proposal;
  }

  async assemble(
    input: AssembleProposalInput,
    quotas: ProposalQuotas,
    now = new Date(),
  ): Promise<RepositoryProposal> {
    const proposalId = proposalIdentity(input);
    const existing = this.proposals.get(this.key(input.tenantId, proposalId));
    const proposalCount = [...this.proposals.values()].filter((proposal) =>
      proposal.tenantId === input.tenantId &&
      proposal.workspaceId === input.workspace.workspaceId &&
      proposal.proposalId !== proposalId).length;
    try {
      validateProposalInput(
        input, quotas, existing?.proposalVersion ?? 0, proposalCount, now,
      );
    } catch (error) {
      this.rejectedValidationCount += 1;
      throw error;
    }
    if (existing && existing.lifecycle !== "rejected") {
      throw new RepositoryProposalError(
        "repository_proposal_lifecycle_conflict",
        "Only rejected proposals may be reassembled.");
    }
    const timestamp = now.toISOString();
    const proposalVersion = (existing?.proposalVersion ?? 0) + 1;
    const assembled = assembleManifest(
      input, proposalId, proposalVersion, quotas, timestamp,
    );
    const artifacts = [...input.artifacts].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId));
    const reviews = [...input.reviews].sort((left, right) =>
      left.reviewId.localeCompare(right.reviewId));
    const patches = [...input.patches].sort((left, right) =>
      left.patchVersion - right.patchVersion ||
      left.patchId.localeCompare(right.patchId));
    const artifactVersions = artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      contentHash: artifact.versions.at(-1)!.contentHash,
    }));
    const reviewVersions = reviews.map((review) => ({
      reviewId: review.reviewId,
      reviewVersion: review.reviewVersion,
      outputHash: review.versions.at(-1)!.outputHash,
    }));
    const patchVersions = patches.map((patch) => ({
      patchId: patch.patchId,
      patchVersion: patch.patchVersion,
      contentHash: patch.contentHash,
    }));
    const deterministicSeed = stableHash({
      proposalId, proposalVersion, artifactVersions, reviewVersions,
      patchVersions,
      workspacePersistenceVersion: input.workspace.persistenceVersion,
      executionVersion: input.executionMetadata.executionVersion,
    });
    const fileCount = assembled.manifest.changedFiles.length;
    const symbolCount = assembled.manifest.changedSymbols.length;
    const title = `Proposed changes for ${input.workspace.repositoryId}`;
    const summary = `${fileCount} file${fileCount === 1 ? "" : "s"}, ` +
      `${symbolCount} symbol${symbolCount === 1 ? "" : "s"}, ` +
      `${artifacts.length} approved artifact` +
      `${artifacts.length === 1 ? "" : "s"}.`;
    const detailedDescription = [
      `Repository revision: ${input.workspace.repositoryRevision}.`,
      `Workspace: ${input.workspace.workspaceId}.`,
      `Approved reviews: ${reviews.length}.`,
      `Validated patches: ${patches.length}.`,
      `Manifest confidence: ${assembled.manifest.confidence.toFixed(6)}.`,
    ].join(" ");
    const versionBody: Omit<ProposalVersion, "outputHash"> = {
      proposalId,
      proposalVersion,
      title,
      summary,
      detailedDescription,
      manifest: assembled.manifest,
      reviewReferences: reviews.map((review) => review.reviewId),
      artifactReferences: artifacts.map((artifact) => artifact.artifactId),
      diagnostics: assembled.diagnostics,
      metrics: assembled.metrics,
      assemblyMetadata: {
        engineVersion: REPOSITORY_PROPOSAL_ENGINE_VERSION,
        schemaVersion: REPOSITORY_PROPOSAL_OUTPUT_SCHEMA_VERSION,
        deterministicSeed,
        repositoryRevision: input.workspace.repositoryRevision,
        executionVersion: input.executionMetadata.executionVersion,
        workspacePersistenceVersion: input.workspace.persistenceVersion,
        artifactVersions,
        reviewVersions,
        patchVersions,
        assembledAt: timestamp,
        assemblyLatencyMs: 0,
      },
      createdAt: timestamp,
      assembledAt: timestamp,
      validatedAt: timestamp,
    };
    const version: ProposalVersion = {
      ...versionBody,
      outputHash: proposalOutputHash(versionBody),
    };
    const history = [...(existing?.lifecycleHistory ?? [])];
    const transitions: readonly [
      ProposalLifecycle | null, ProposalLifecycle, string,
    ][] = [
      [existing?.lifecycle ?? null, "created", "proposal_version_created"],
      ["created", "assembling", "assembly_started"],
      ["assembling", "validating", "manifest_validation_started"],
      ["validating", "awaiting_review", "proposal_assembled"],
    ];
    for (const [from, to, reason] of transitions) {
      history.push(lifecycleEvent(
        proposalId, proposalVersion, from, to, reason, timestamp,
        history.length + 1,
      ));
    }
    return this.save({
      proposalId,
      schemaVersion: REPOSITORY_PROPOSAL_SCHEMA_VERSION,
      persistenceVersion: existing?.persistenceVersion ?? 0,
      tenantId: input.tenantId,
      repositoryId: input.workspace.repositoryId,
      repositoryRevision: input.workspace.repositoryRevision,
      executionId: input.executionMetadata.executionId,
      workspaceId: input.workspace.workspaceId,
      ownerId: input.ownerId,
      proposalVersion,
      lifecycle: "awaiting_review",
      versions: [...(existing?.versions ?? []), version],
      diagnostics: [
        ...(existing?.diagnostics ?? []), ...assembled.diagnostics,
      ],
      decisions: existing?.decisions ?? [],
      lifecycleHistory: history,
      recoveryHistory: existing?.recoveryHistory ?? [],
      archiveMetadata: null,
      validationFailureCount: existing?.validationFailureCount ?? 0,
      recoveryCount: existing?.recoveryCount ?? 0,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
      reviewRequestedAt: timestamp,
      assemblyLeaseExpiresAt: input.assemblyLeaseExpiresAt ?? null,
    });
  }

  async get(tenantId: string, proposalId: string, ownerId: string) {
    const proposal = this.proposals.get(this.key(tenantId, proposalId));
    if (!proposal) return null;
    if (proposal.ownerId !== ownerId) {
      throw new RepositoryProposalError(
        "repository_proposal_ownership_conflict",
        "Proposal belongs to another owner.");
    }
    return clone(proposal);
  }

  async decide(
    input: DecideProposalInput,
    now = new Date(),
  ): Promise<RepositoryProposal> {
    const proposal = this.require(
      input.tenantId, input.proposalId, input.ownerId,
    );
    if (proposal.lifecycle !== "awaiting_review") {
      throw new RepositoryProposalError(
        "repository_proposal_lifecycle_conflict",
        "Only proposals awaiting review may be decided.");
    }
    if (proposal.proposalVersion !== input.proposalVersion) {
      throw new RepositoryProposalError(
        "repository_proposal_version_stale",
        "Decision targets a stale proposal version.");
    }
    if (!input.reviewerId.trim() || !input.idempotencyKey.trim() ||
        input.rationaleCodes.some((code) => !code.trim()) ||
        !["approved", "rejected"].includes(input.verdict)) {
      throw new RepositoryProposalError(
        "repository_proposal_decision_invalid",
        "Proposal decision is malformed.");
    }
    const rationaleCodes = sortedUnique(input.rationaleCodes);
    const payloadHash = stableHash({
      proposalId: input.proposalId,
      proposalVersion: input.proposalVersion,
      reviewerId: input.reviewerId,
      verdict: input.verdict,
      rationaleCodes,
    });
    const replay = proposal.decisions.find((decision) =>
      decision.idempotencyKey === input.idempotencyKey);
    if (replay) {
      if (stableHash({
        proposalId: replay.proposalId,
        proposalVersion: replay.proposalVersion,
        reviewerId: replay.reviewerId,
        verdict: replay.verdict,
        rationaleCodes: replay.rationaleCodes,
      }) !== payloadHash) {
        throw new RepositoryProposalError(
          "repository_proposal_idempotency_conflict",
          "Decision idempotency payload conflicts.");
      }
      return clone(proposal);
    }
    const timestamp = now.toISOString();
    const decision: ProposalDecision = {
      decisionId: stableId("repository_proposal_decision", {
        proposalId: proposal.proposalId,
        proposalVersion: proposal.proposalVersion,
        idempotencyKey: input.idempotencyKey,
      }),
      proposalId: proposal.proposalId,
      proposalVersion: proposal.proposalVersion,
      ownerId: input.ownerId,
      reviewerId: input.reviewerId,
      verdict: input.verdict,
      rationaleCodes,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    };
    return this.save({
      ...proposal,
      lifecycle: input.verdict,
      decisions: [...proposal.decisions, decision],
      lifecycleHistory: [...proposal.lifecycleHistory, lifecycleEvent(
        proposal.proposalId, proposal.proposalVersion,
        proposal.lifecycle, input.verdict, "proposal_decided",
        timestamp, proposal.lifecycleHistory.length + 1,
      )],
      updatedAt: timestamp,
      completedAt: timestamp,
      assemblyLeaseExpiresAt: null,
    });
  }

  async archive(
    tenantId: string,
    proposalId: string,
    ownerId: string,
    expectedVersion: number,
    now = new Date(),
  ): Promise<RepositoryProposal> {
    const proposal = this.require(tenantId, proposalId, ownerId);
    if (proposal.proposalVersion !== expectedVersion) {
      throw new RepositoryProposalError(
        "repository_proposal_version_stale",
        "Archive targets a stale proposal version.");
    }
    if (!["approved", "rejected", "expired"].includes(proposal.lifecycle)) {
      throw new RepositoryProposalError(
        "repository_proposal_lifecycle_conflict",
        "Only completed proposals may be archived.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...proposal,
      lifecycle: "archived",
      lifecycleHistory: [...proposal.lifecycleHistory, lifecycleEvent(
        proposal.proposalId, proposal.proposalVersion,
        proposal.lifecycle, "archived", "manual_archive",
        timestamp, proposal.lifecycleHistory.length + 1,
      )],
      archiveMetadata: {
        archivedAt: timestamp,
        reason: "manual",
        finalProposalVersion: proposal.proposalVersion,
        outputHash: proposal.versions.at(-1)!.outputHash,
      },
      updatedAt: timestamp,
      completedAt: timestamp,
      assemblyLeaseExpiresAt: null,
    });
  }

  private recovered(
    proposal: RepositoryProposal,
    reason: ProposalRecoveryRecord["reason"],
    now: Date,
  ): RepositoryProposal {
    const timestamp = now.toISOString();
    const recovery: ProposalRecoveryRecord = {
      recoveryId: stableId("repository_proposal_recovery", {
        proposalId: proposal.proposalId,
        proposalVersion: proposal.proposalVersion,
        reason,
        sequence: proposal.recoveryHistory.length + 1,
      }),
      reason,
      previousLifecycle: proposal.lifecycle,
      recoveredLifecycle: "expired",
      createdAt: timestamp,
    };
    return {
      ...proposal,
      lifecycle: "expired",
      recoveryHistory: [...proposal.recoveryHistory, recovery],
      lifecycleHistory: [...proposal.lifecycleHistory, lifecycleEvent(
        proposal.proposalId, proposal.proposalVersion,
        proposal.lifecycle, "expired", `recovery_${reason}`,
        timestamp, proposal.lifecycleHistory.length + 1,
      )],
      recoveryCount: proposal.recoveryCount + 1,
      updatedAt: timestamp,
      completedAt: timestamp,
      assemblyLeaseExpiresAt: null,
    };
  }

  async recover(now = new Date(), quotas?: ProposalQuotas): Promise<number> {
    let count = 0;
    for (const current of [...this.proposals.values()]) {
      if (terminal.has(current.lifecycle)) continue;
      const age = now.getTime() - Date.parse(current.updatedAt);
      let reason: ProposalRecoveryRecord["reason"] | null = null;
      if (current.versions.length !== current.proposalVersion) {
        reason = "stale_proposal_version";
      } else if (current.lifecycle === "assembling" ||
          current.lifecycle === "validating") {
        if (!quotas || age >= quotas.assemblyTimeoutMs) {
          reason = "incomplete_assembly";
        }
      } else if ((current.lifecycle === "created" &&
          (!quotas || age >= quotas.assemblyTimeoutMs)) ||
          (current.lifecycle === "awaiting_review" && quotas &&
            age >= quotas.proposalTtlMs) ||
          (current.assemblyLeaseExpiresAt &&
            Date.parse(current.assemblyLeaseExpiresAt) <= now.getTime())) {
        reason = "abandoned_proposal_creation";
      }
      if (reason) {
        this.save(this.recovered(current, reason, now));
        count += 1;
      }
    }
    return count;
  }

  async collect(tenantId: string, quotas: ProposalQuotas): Promise<number> {
    const completed = [...this.proposals.entries()]
      .filter(([, proposal]) =>
        proposal.tenantId === tenantId && terminal.has(proposal.lifecycle))
      .sort((left, right) =>
        (right[1].completedAt ?? right[1].updatedAt).localeCompare(
          left[1].completedAt ?? left[1].updatedAt) ||
        right[1].proposalId.localeCompare(left[1].proposalId));
    let removed = 0;
    for (const [key] of completed.slice(
      Math.max(1, quotas.retainedProposals),
    )) {
      this.proposals.delete(key);
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string): Promise<ProposalMetrics> {
    const metrics = [...this.proposals.values()]
      .filter((proposal) =>
        tenantId === undefined || proposal.tenantId === tenantId)
      .reduce<ProposalMetrics>((result, proposal) => ({
        proposalsAssembled:
          result.proposalsAssembled + proposal.versions.length,
        validationFailures:
          result.validationFailures + proposal.validationFailureCount,
        rejectedProposals: result.rejectedProposals +
          proposal.decisions.filter((decision) =>
            decision.verdict === "rejected").length,
        manifestSize: result.manifestSize + proposal.versions.reduce(
          (sum, version) => sum + version.metrics.manifestBytes, 0),
        diagnosticsCount:
          result.diagnosticsCount + proposal.diagnostics.length,
        assemblyLatencyMs: result.assemblyLatencyMs +
          proposal.versions.reduce((sum, version) =>
            sum + version.assemblyMetadata.assemblyLatencyMs, 0),
        recoveryCount: result.recoveryCount + proposal.recoveryCount,
      }), emptyMetrics());
    return {
      ...metrics,
      validationFailures:
        metrics.validationFailures + this.rejectedValidationCount,
    };
  }

  async verify(quotas?: ProposalQuotas): Promise<void> {
    const validationQuotas = quotas ?? {
      proposalsPerWorkspace: Number.MAX_SAFE_INTEGER,
      versionsPerProposal: Number.MAX_SAFE_INTEGER,
      artifactsPerProposal: Number.MAX_SAFE_INTEGER,
      reviewsPerProposal: Number.MAX_SAFE_INTEGER,
      patchesPerProposal: Number.MAX_SAFE_INTEGER,
      filesPerManifest: Number.MAX_SAFE_INTEGER,
      symbolsPerManifest: Number.MAX_SAFE_INTEGER,
      diagnosticsPerProposal: Number.MAX_SAFE_INTEGER,
      manifestBytes: Number.MAX_SAFE_INTEGER,
      retainedProposals: Number.MAX_SAFE_INTEGER,
      retainedVersions: Number.MAX_SAFE_INTEGER,
      retainedDiagnostics: Number.MAX_SAFE_INTEGER,
      assemblyTimeoutMs: Number.MAX_SAFE_INTEGER,
      proposalTtlMs: Number.MAX_SAFE_INTEGER,
    };
    for (const proposal of this.proposals.values()) {
      validateProposalIntegrity(proposal, validationQuotas);
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

export class PostgresRepositoryProposalStore
implements RepositoryProposalStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(
    name: string,
    parameters: Record<string, unknown> = {},
  ): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code =
        error.message?.match(/repository_proposal_[a-z_]+/u)?.[0] ??
        "repository_proposal_persistence_failed";
      throw new RepositoryProposalError(
        code, error.message ?? "Proposal persistence failed.");
    }
    return data;
  }

  private async load(
    tenantId: string,
    proposalId: string,
  ): Promise<RepositoryProposal | null> {
    const data = await this.call("get_repository_change_proposal", {
      input_tenant_id: tenantId,
      input_proposal_id: proposalId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.proposal ?? data) as RepositoryProposal);
  }

  private async persist(
    proposal: RepositoryProposal,
    expectedVersion: number | null,
  ): Promise<RepositoryProposal> {
    const data = await this.call("save_repository_change_proposal", {
      input_proposal: proposal,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    return clone((first(data)?.proposal ?? data) as RepositoryProposal);
  }

  private async mutate(
    tenantId: string,
    proposalId: string,
    operation: (
      memory: MemoryRepositoryProposalStore,
      existing: RepositoryProposal,
    ) => Promise<unknown>,
  ): Promise<RepositoryProposal> {
    const existing = await this.load(tenantId, proposalId);
    if (!existing) {
      throw new RepositoryProposalError(
        "repository_proposal_not_found", "Proposal was not found.");
    }
    const memory = new MemoryRepositoryProposalStore();
    memory.hydrate(existing);
    await operation(memory, existing);
    const updated = await memory.get(
      tenantId, proposalId, existing.ownerId,
    );
    if (!updated) {
      throw new RepositoryProposalError(
        "repository_proposal_not_found", "Proposal was not found.");
    }
    return this.persist(updated, existing.persistenceVersion);
  }

  async assemble(
    input: AssembleProposalInput,
    quotas: ProposalQuotas,
    now?: Date,
  ) {
    const proposalId = proposalIdentity(input);
    const existing = await this.load(input.tenantId, proposalId);
    if (!existing) {
      const countData = await this.call(
        "count_repository_workspace_proposals", {
          input_tenant_id: input.tenantId,
          input_workspace_id: input.workspace.workspaceId,
        });
      const count = Number(first(countData)?.proposal_count ?? countData ?? 0);
      if (count >= quotas.proposalsPerWorkspace) {
        throw new RepositoryProposalError(
          "repository_proposal_quota_exceeded",
          "Workspace proposal quota exceeded.");
      }
    }
    const memory = new MemoryRepositoryProposalStore();
    if (existing) memory.hydrate(existing);
    const proposal = await memory.assemble(input, quotas, now);
    return this.persist(proposal, existing?.persistenceVersion ?? null);
  }

  async get(tenantId: string, proposalId: string, ownerId: string) {
    const proposal = await this.load(tenantId, proposalId);
    if (proposal && proposal.ownerId !== ownerId) {
      throw new RepositoryProposalError(
        "repository_proposal_ownership_conflict",
        "Proposal belongs to another owner.");
    }
    return proposal;
  }

  async decide(input: DecideProposalInput, now?: Date) {
    return this.mutate(input.tenantId, input.proposalId,
      (memory) => memory.decide(input, now));
  }

  async archive(
    tenantId: string,
    proposalId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ) {
    return this.mutate(tenantId, proposalId,
      (memory) => memory.archive(
        tenantId, proposalId, ownerId, expectedVersion, now,
      ));
  }

  async recover(now = new Date(), quotas?: ProposalQuotas) {
    const data = await this.call("list_recoverable_repository_change_proposals");
    const proposals =
      (first(data)?.proposals ?? data ?? []) as RepositoryProposal[];
    let count = 0;
    for (const proposal of proposals) {
      const memory = new MemoryRepositoryProposalStore();
      memory.hydrate(proposal);
      const recovered = await memory.recover(now, quotas);
      if (recovered > 0) {
        const updated = await memory.get(
          proposal.tenantId, proposal.proposalId, proposal.ownerId,
        );
        if (updated) await this.persist(updated, proposal.persistenceVersion);
      }
      count += recovered;
    }
    return count;
  }

  async collect(tenantId: string, quotas: ProposalQuotas) {
    const data = await this.call("collect_repository_change_proposals", {
      input_tenant_id: tenantId,
      input_proposal_retention: quotas.retainedProposals,
      input_version_retention: quotas.retainedVersions,
      input_diagnostic_retention: quotas.retainedDiagnostics,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("repository_change_proposal_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as ProposalMetrics);
  }

  async verify() {
    const data = await this.call("verify_repository_change_proposal_contract", {
      input_engine_version: REPOSITORY_PROPOSAL_ENGINE_VERSION,
      input_schema_version: REPOSITORY_PROPOSAL_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositoryProposalError(
        "repository_proposal_startup_validation_failed",
        "Proposal database contract is invalid.",
        { problems: row.problems ?? [] },
      );
    }
  }
}

export const runtimeRepositoryProposalStore: RepositoryProposalStore =
  new PostgresRepositoryProposalStore(supabase as unknown as SupabaseClient);
