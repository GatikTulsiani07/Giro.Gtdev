import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  ArtifactApproval,
  ArtifactLifecycle,
  ArtifactLifecycleEvent,
  ArtifactMetrics,
  ArtifactQuotas,
  ArtifactRecoveryRecord,
  ArtifactVersion,
  GenerateArtifactInput,
  RepositoryArtifact,
  ReviewArtifactInput,
} from "./types.js";
import {
  REPOSITORY_ARTIFACT_ENGINE_VERSION,
  REPOSITORY_ARTIFACT_SCHEMA_VERSION,
  RepositoryArtifactError,
} from "./types.js";
import {
  artifactContentHash,
  artifactIdentity,
  buildStructuredContent,
  createDiagnostics,
  validateArtifactIntegrity,
  validateArtifactVersion,
  validateGenerationInput,
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
const terminal = new Set<ArtifactLifecycle>([
  "approved", "rejected", "archived", "expired",
]);

export interface RepositoryArtifactStore {
  generate(
    input: GenerateArtifactInput,
    quotas: ArtifactQuotas,
    now?: Date,
  ): Promise<RepositoryArtifact>;
  get(
    tenantId: string,
    artifactId: string,
    ownerId: string,
  ): Promise<RepositoryArtifact | null>;
  review(input: ReviewArtifactInput, now?: Date): Promise<RepositoryArtifact>;
  archive(
    tenantId: string,
    artifactId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ): Promise<RepositoryArtifact>;
  recover(now?: Date, quotas?: ArtifactQuotas): Promise<number>;
  collect(tenantId: string, quotas: ArtifactQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<ArtifactMetrics>;
  verify(quotas?: ArtifactQuotas): Promise<void>;
}

function emptyMetrics(): ArtifactMetrics {
  return {
    artifactsGenerated: 0,
    generationLatencyMs: 0,
    validationFailures: 0,
    recoveryCount: 0,
    retentionCount: 0,
    approvalWaitTimeMs: 0,
  };
}

function lifecycleEvent(
  artifactId: string,
  artifactVersion: number,
  from: ArtifactLifecycle | null,
  to: ArtifactLifecycle,
  reason: string,
  createdAt: string,
  sequence: number,
): ArtifactLifecycleEvent {
  return {
    eventId: stableId("repository_artifact_lifecycle", {
      artifactId, artifactVersion, from, to, reason, sequence,
    }),
    artifactVersion, from, to, reason, createdAt,
  };
}

export class MemoryRepositoryArtifactStore implements RepositoryArtifactStore {
  private readonly artifacts = new Map<string, RepositoryArtifact>();
  private retentionCount = 0;
  private rejectedValidationCount = 0;

  private key(tenantId: string, artifactId: string): string {
    return `${tenantId}\0${artifactId}`;
  }

  hydrate(artifact: RepositoryArtifact): void {
    this.artifacts.set(this.key(artifact.tenantId, artifact.artifactId), clone(artifact));
  }

  private save(artifact: RepositoryArtifact): RepositoryArtifact {
    const key = this.key(artifact.tenantId, artifact.artifactId);
    const existing = this.artifacts.get(key);
    const saved = clone({
      ...artifact,
      persistenceVersion: existing
        ? Math.max(existing.persistenceVersion, artifact.persistenceVersion) + 1 : 1,
    });
    this.artifacts.set(key, saved);
    return clone(saved);
  }

  private require(
    tenantId: string,
    artifactId: string,
    ownerId: string,
  ): RepositoryArtifact {
    const artifact = this.artifacts.get(this.key(tenantId, artifactId));
    if (!artifact) {
      throw new RepositoryArtifactError(
        "repository_artifact_not_found", "Artifact was not found.");
    }
    if (artifact.ownerId !== ownerId) {
      throw new RepositoryArtifactError(
        "repository_artifact_ownership_conflict",
        "Artifact belongs to another owner.");
    }
    return artifact;
  }

  async generate(
    input: GenerateArtifactInput,
    quotas: ArtifactQuotas,
    now = new Date(),
  ): Promise<RepositoryArtifact> {
    const artifactId = artifactIdentity(input);
    const existing = this.artifacts.get(this.key(input.tenantId, artifactId));
    const workspaceArtifactCount = [...this.artifacts.values()].filter((artifact) =>
      artifact.tenantId === input.tenantId &&
      artifact.workspaceId === input.workspace.workspaceId &&
      artifact.artifactId !== artifactId).length;
    try {
      validateGenerationInput(
        input, quotas, existing?.artifactVersion ?? 0, workspaceArtifactCount,
      );
    } catch (error) {
      this.rejectedValidationCount += 1;
      throw error;
    }
    if (existing && terminal.has(existing.lifecycle)) {
      throw new RepositoryArtifactError(
        "repository_artifact_lifecycle_conflict",
        "Terminal artifacts cannot receive a new version.");
    }
    const timestamp = now.toISOString();
    const artifactVersion = (existing?.artifactVersion ?? 0) + 1;
    const built = buildStructuredContent(input);
    const diagnostics = createDiagnostics(
      artifactId, artifactVersion, input, timestamp,
    );
    const confidence = Math.max(0, Math.min(1,
      Number(input.patch.confidence.toFixed(6))));
    const deterministicSeed = stableHash({
      artifactId,
      artifactVersion,
      artifactType: input.artifactType,
      snapshotHash: input.snapshot.snapshotHash,
      patchHash: input.patch.contentHash,
      graphHash: input.repositoryGraph.contentHash,
      intelligenceHash: input.intelligence.contentHash,
      planningHash: input.planning.contentHash,
      executionVersion: input.executionMetadata.executionVersion,
    });
    const versionBody: Omit<ArtifactVersion, "contentHash"> = {
      artifactId,
      artifactVersion,
      structuredContent: built.content,
      affectedFiles: built.affectedFiles,
      affectedSymbols: built.affectedSymbols,
      diagnostics,
      confidence,
      warnings: built.warnings,
      generationMetadata: {
        engineVersion: REPOSITORY_ARTIFACT_ENGINE_VERSION,
        schemaVersion: REPOSITORY_ARTIFACT_SCHEMA_VERSION,
        deterministicSeed,
        snapshotVersion: input.snapshot.snapshotVersion,
        snapshotHash: input.snapshot.snapshotHash,
        patchVersion: input.patch.patchVersion,
        patchHash: input.patch.contentHash,
        graphVersion: input.repositoryGraph.version,
        intelligenceVersion: input.intelligence.version,
        planningVersion: input.planning.version,
        executionVersion: input.executionMetadata.executionVersion,
        generatedAt: timestamp,
        generationLatencyMs: 0,
      },
      createdAt: timestamp,
      generatedAt: timestamp,
      validatedAt: timestamp,
    };
    const version: ArtifactVersion = {
      ...versionBody,
      contentHash: artifactContentHash(versionBody),
    };
    try {
      validateArtifactVersion(version, quotas);
    } catch (error) {
      this.rejectedValidationCount += 1;
      throw error;
    }
    const previousLifecycle = existing?.lifecycle ?? null;
    const history = [...(existing?.lifecycleHistory ?? [])];
    for (const [from, to, reason] of [
      [previousLifecycle, "created", "artifact_version_created"],
      ["created", "generating", "deterministic_generation_started"],
      ["generating", "generated", "deterministic_generation_completed"],
      ["generated", "validated", "artifact_schema_validated"],
      ["validated", "awaiting_review", "artifact_proposal_ready"],
    ] as const) {
      history.push(lifecycleEvent(
        artifactId, artifactVersion, from, to, reason, timestamp, history.length + 1,
      ));
    }
    return this.save({
      artifactId,
      schemaVersion: REPOSITORY_ARTIFACT_SCHEMA_VERSION,
      persistenceVersion: existing?.persistenceVersion ?? 0,
      tenantId: input.tenantId,
      repositoryId: input.workspace.repositoryId,
      repositoryRevision: input.workspace.repositoryRevision,
      workspaceId: input.workspace.workspaceId,
      executionId: input.executionMetadata.executionId,
      workUnitId: input.executionMetadata.workUnitId,
      ownerId: input.ownerId,
      artifactType: input.artifactType,
      artifactVersion,
      lifecycle: "awaiting_review",
      versions: [...(existing?.versions ?? []), version],
      diagnostics: [...(existing?.diagnostics ?? []), ...diagnostics],
      approvals: existing?.approvals ?? [],
      lifecycleHistory: history,
      recoveryHistory: existing?.recoveryHistory ?? [],
      archiveMetadata: null,
      validationFailureCount: existing?.validationFailureCount ?? 0,
      recoveryCount: existing?.recoveryCount ?? 0,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
      reviewRequestedAt: timestamp,
      generationLeaseExpiresAt: input.leaseExpiresAt ?? null,
    });
  }

  async get(tenantId: string, artifactId: string, ownerId: string) {
    const artifact = this.artifacts.get(this.key(tenantId, artifactId));
    if (!artifact) return null;
    if (artifact.ownerId !== ownerId) {
      throw new RepositoryArtifactError(
        "repository_artifact_ownership_conflict",
        "Artifact belongs to another owner.");
    }
    return clone(artifact);
  }

  async review(
    input: ReviewArtifactInput,
    now = new Date(),
  ): Promise<RepositoryArtifact> {
    const artifact = this.require(input.tenantId, input.artifactId, input.ownerId);
    if (artifact.lifecycle !== "awaiting_review") {
      throw new RepositoryArtifactError(
        "repository_artifact_lifecycle_conflict",
        "Only artifacts awaiting review may be reviewed.");
    }
    if (input.artifactVersion !== artifact.artifactVersion) {
      throw new RepositoryArtifactError(
        "repository_artifact_version_stale",
        "Review targets a stale artifact version.");
    }
    if (!input.reviewerId.trim() || !input.idempotencyKey.trim() ||
        input.findings.some((finding) => !finding.trim())) {
      throw new RepositoryArtifactError(
        "repository_artifact_approval_invalid",
        "Artifact approval is malformed.");
    }
    const payloadHash = stableHash({
      artifactId: input.artifactId,
      artifactVersion: input.artifactVersion,
      decision: input.decision,
      findings: [...input.findings].sort(),
      reviewerId: input.reviewerId,
    });
    const replay = artifact.approvals.find((approval) =>
      approval.idempotencyKey === input.idempotencyKey);
    if (replay) {
      if (stableHash({
        artifactId: replay.artifactId,
        artifactVersion: replay.artifactVersion,
        decision: replay.decision,
        findings: replay.findings,
        reviewerId: replay.reviewerId,
      }) !== payloadHash) {
        throw new RepositoryArtifactError(
          "repository_artifact_idempotency_conflict",
          "Approval idempotency payload conflicts.");
      }
      return clone(artifact);
    }
    const timestamp = now.toISOString();
    const approval: ArtifactApproval = {
      approvalId: stableId("repository_artifact_approval", {
        artifactId: artifact.artifactId,
        artifactVersion: artifact.artifactVersion,
        idempotencyKey: input.idempotencyKey,
      }),
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      ownerId: input.ownerId,
      reviewerId: input.reviewerId,
      decision: input.decision,
      findings: [...input.findings].sort(),
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    };
    const lifecycle = input.decision;
    return this.save({
      ...artifact,
      lifecycle,
      approvals: [...artifact.approvals, approval],
      lifecycleHistory: [...artifact.lifecycleHistory, lifecycleEvent(
        artifact.artifactId, artifact.artifactVersion,
        artifact.lifecycle, lifecycle, `review_${input.decision}`,
        timestamp, artifact.lifecycleHistory.length + 1,
      )],
      updatedAt: timestamp,
      completedAt: timestamp,
      generationLeaseExpiresAt: null,
    });
  }

  async archive(
    tenantId: string,
    artifactId: string,
    ownerId: string,
    expectedVersion: number,
    now = new Date(),
  ): Promise<RepositoryArtifact> {
    const artifact = this.require(tenantId, artifactId, ownerId);
    if (artifact.artifactVersion !== expectedVersion) {
      throw new RepositoryArtifactError(
        "repository_artifact_version_stale",
        "Archive targets a stale artifact version.");
    }
    if (!["approved", "rejected", "expired"].includes(artifact.lifecycle)) {
      throw new RepositoryArtifactError(
        "repository_artifact_lifecycle_conflict",
        "Only completed artifacts may be archived.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...artifact,
      lifecycle: "archived",
      lifecycleHistory: [...artifact.lifecycleHistory, lifecycleEvent(
        artifact.artifactId, artifact.artifactVersion,
        artifact.lifecycle, "archived", "manual_archive",
        timestamp, artifact.lifecycleHistory.length + 1,
      )],
      archiveMetadata: {
        archivedAt: timestamp,
        reason: "manual",
        finalArtifactVersion: artifact.artifactVersion,
        contentHash: artifact.versions.at(-1)!.contentHash,
      },
      updatedAt: timestamp,
      completedAt: timestamp,
      generationLeaseExpiresAt: null,
    });
  }

  private recovered(
    artifact: RepositoryArtifact,
    reason: ArtifactRecoveryRecord["reason"],
    lifecycle: ArtifactLifecycle,
    now: Date,
  ): RepositoryArtifact {
    const timestamp = now.toISOString();
    const recovery: ArtifactRecoveryRecord = {
      recoveryId: stableId("repository_artifact_recovery", {
        artifactId: artifact.artifactId,
        artifactVersion: artifact.artifactVersion,
        reason,
        sequence: artifact.recoveryHistory.length + 1,
      }),
      reason,
      previousLifecycle: artifact.lifecycle,
      recoveredLifecycle: lifecycle,
      createdAt: timestamp,
    };
    return {
      ...artifact,
      lifecycle,
      lifecycleHistory: [...artifact.lifecycleHistory, lifecycleEvent(
        artifact.artifactId, artifact.artifactVersion,
        artifact.lifecycle, lifecycle, `recovery_${reason}`,
        timestamp, artifact.lifecycleHistory.length + 1,
      )],
      recoveryHistory: [...artifact.recoveryHistory, recovery],
      recoveryCount: artifact.recoveryCount + 1,
      updatedAt: timestamp,
      completedAt: terminal.has(lifecycle) ? timestamp : artifact.completedAt,
      generationLeaseExpiresAt: null,
    };
  }

  async recover(now = new Date(), quotas?: ArtifactQuotas): Promise<number> {
    let count = 0;
    for (const current of [...this.artifacts.values()]) {
      if (terminal.has(current.lifecycle)) continue;
      let recovered: RepositoryArtifact | null = null;
      const age = now.getTime() - Date.parse(current.updatedAt);
      if (current.generationLeaseExpiresAt &&
          Date.parse(current.generationLeaseExpiresAt) <= now.getTime()) {
        recovered = this.recovered(current, "expired_lease", "expired", now);
      } else if (current.lifecycle === "generating" &&
          (!quotas || age >= quotas.generationTimeoutMs)) {
        recovered = this.recovered(current, "abandoned_generation", "expired", now);
      } else if (["created", "generated", "validated"].includes(current.lifecycle) &&
          (!quotas || age >= quotas.generationTimeoutMs)) {
        recovered = this.recovered(current, "incomplete_artifact", "expired", now);
      } else if (current.lifecycle === "awaiting_review" && quotas &&
          age >= quotas.artifactTtlMs) {
        recovered = this.recovered(current, "stale_workspace", "expired", now);
      }
      if (recovered) {
        this.save(recovered);
        count += 1;
      }
    }
    return count;
  }

  async collect(tenantId: string, quotas: ArtifactQuotas): Promise<number> {
    const candidates = [...this.artifacts.entries()]
      .filter(([, artifact]) =>
        artifact.tenantId === tenantId && terminal.has(artifact.lifecycle))
      .sort((left, right) =>
        (right[1].completedAt ?? right[1].updatedAt)
          .localeCompare(left[1].completedAt ?? left[1].updatedAt) ||
        right[1].artifactId.localeCompare(left[1].artifactId));
    let removed = 0;
    for (const [key] of candidates.slice(Math.max(1, quotas.retainedArtifacts))) {
      this.artifacts.delete(key);
      removed += 1;
    }
    for (const [key, artifact] of this.artifacts) {
      if (artifact.tenantId !== tenantId || artifact.lifecycle !== "archived") continue;
      const versions = artifact.versions.slice(-Math.max(1, quotas.retainedVersions));
      const diagnostics = artifact.diagnostics.slice(
        -Math.max(1, quotas.retainedDiagnostics),
      );
      if (versions.length !== artifact.versions.length ||
          diagnostics.length !== artifact.diagnostics.length) {
        this.artifacts.set(key, clone({ ...artifact, versions, diagnostics }));
        removed += artifact.versions.length - versions.length +
          artifact.diagnostics.length - diagnostics.length;
      }
    }
    this.retentionCount += removed;
    return removed;
  }

  async metrics(tenantId?: string): Promise<ArtifactMetrics> {
    const metrics = [...this.artifacts.values()]
      .filter((artifact) => tenantId === undefined || artifact.tenantId === tenantId)
      .reduce<ArtifactMetrics>((result, artifact) => ({
        artifactsGenerated: result.artifactsGenerated + artifact.versions.length,
        generationLatencyMs: result.generationLatencyMs + artifact.versions.reduce(
          (sum, version) => sum + version.generationMetadata.generationLatencyMs, 0),
        validationFailures: result.validationFailures +
          artifact.validationFailureCount,
        recoveryCount: result.recoveryCount + artifact.recoveryCount,
        retentionCount: result.retentionCount,
        approvalWaitTimeMs: result.approvalWaitTimeMs + artifact.approvals.reduce(
          (sum, approval) => sum + Math.max(0,
            Date.parse(approval.createdAt) -
            Date.parse(artifact.reviewRequestedAt ?? approval.createdAt)), 0),
      }), emptyMetrics());
    return {
      ...metrics,
      validationFailures: metrics.validationFailures + this.rejectedValidationCount,
      retentionCount: tenantId === undefined ? this.retentionCount : 0,
    };
  }

  async verify(quotas?: ArtifactQuotas): Promise<void> {
    const validationQuotas: ArtifactQuotas = quotas ?? {
      artifactsPerWorkspace: Number.MAX_SAFE_INTEGER,
      versionsPerArtifact: Number.MAX_SAFE_INTEGER,
      artifactBytes: Number.MAX_SAFE_INTEGER,
      operationsPerArtifact: Number.MAX_SAFE_INTEGER,
      diagnosticsPerArtifact: Number.MAX_SAFE_INTEGER,
      retainedArtifacts: Number.MAX_SAFE_INTEGER,
      retainedVersions: Number.MAX_SAFE_INTEGER,
      retainedDiagnostics: Number.MAX_SAFE_INTEGER,
      generationTimeoutMs: Number.MAX_SAFE_INTEGER,
      artifactTtlMs: Number.MAX_SAFE_INTEGER,
    };
    for (const artifact of this.artifacts.values()) {
      validateArtifactIntegrity(artifact, validationQuotas);
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

export class PostgresRepositoryArtifactStore implements RepositoryArtifactStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(
    name: string,
    parameters: Record<string, unknown> = {},
  ): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code = error.message?.match(/repository_artifact_[a-z_]+/u)?.[0] ??
        "repository_artifact_persistence_failed";
      throw new RepositoryArtifactError(
        code, error.message ?? "Artifact persistence failed.");
    }
    return data;
  }

  private async load(
    tenantId: string,
    artifactId: string,
  ): Promise<RepositoryArtifact | null> {
    const data = await this.call("get_repository_artifact", {
      input_tenant_id: tenantId,
      input_artifact_id: artifactId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.artifact ?? data) as RepositoryArtifact);
  }

  private async persist(
    artifact: RepositoryArtifact,
    expectedVersion: number | null,
  ): Promise<RepositoryArtifact> {
    const data = await this.call("save_repository_artifact", {
      input_artifact: artifact,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    return clone((first(data)?.artifact ?? data) as RepositoryArtifact);
  }

  private async mutate<T>(
    tenantId: string,
    artifactId: string,
    operation: (memory: MemoryRepositoryArtifactStore) => Promise<T>,
  ): Promise<{ value: T; artifact: RepositoryArtifact }> {
    const existing = await this.load(tenantId, artifactId);
    if (!existing) {
      throw new RepositoryArtifactError(
        "repository_artifact_not_found", "Artifact was not found.");
    }
    const memory = new MemoryRepositoryArtifactStore();
    memory.hydrate(existing);
    const value = await operation(memory);
    const updated = await memory.get(tenantId, artifactId, existing.ownerId);
    if (!updated) {
      throw new RepositoryArtifactError(
        "repository_artifact_not_found", "Artifact was not found.");
    }
    return {
      value,
      artifact: await this.persist(updated, existing.persistenceVersion),
    };
  }

  async generate(input: GenerateArtifactInput, quotas: ArtifactQuotas, now?: Date) {
    const artifactId = artifactIdentity(input);
    const existing = await this.load(input.tenantId, artifactId);
    if (!existing) {
      const countData = await this.call("count_repository_workspace_artifacts", {
        input_tenant_id: input.tenantId,
        input_workspace_id: input.workspace.workspaceId,
      });
      const count = Number(first(countData)?.artifact_count ?? countData ?? 0);
      if (count >= quotas.artifactsPerWorkspace) {
        throw new RepositoryArtifactError(
          "repository_artifact_quota_exceeded",
          "Workspace artifact quota exceeded.",
        );
      }
    }
    const memory = new MemoryRepositoryArtifactStore();
    if (existing) memory.hydrate(existing);
    const generated = await memory.generate(input, quotas, now);
    return this.persist(generated, existing?.persistenceVersion ?? null);
  }

  async get(tenantId: string, artifactId: string, ownerId: string) {
    const artifact = await this.load(tenantId, artifactId);
    if (artifact && artifact.ownerId !== ownerId) {
      throw new RepositoryArtifactError(
        "repository_artifact_ownership_conflict",
        "Artifact belongs to another owner.");
    }
    return artifact;
  }

  async review(input: ReviewArtifactInput, now?: Date) {
    return (await this.mutate(input.tenantId, input.artifactId,
      (memory) => memory.review(input, now))).artifact;
  }

  async archive(
    tenantId: string,
    artifactId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ) {
    return (await this.mutate(tenantId, artifactId,
      (memory) => memory.archive(
        tenantId, artifactId, ownerId, expectedVersion, now,
      ))).artifact;
  }

  async recover(now = new Date(), quotas?: ArtifactQuotas) {
    const data = await this.call("list_recoverable_repository_artifacts");
    const artifacts = (first(data)?.artifacts ?? data ?? []) as RepositoryArtifact[];
    let count = 0;
    for (const artifact of artifacts) {
      const memory = new MemoryRepositoryArtifactStore();
      memory.hydrate(artifact);
      const recovered = await memory.recover(now, quotas);
      if (recovered > 0) {
        const updated = await memory.get(
          artifact.tenantId, artifact.artifactId, artifact.ownerId,
        );
        if (updated) await this.persist(updated, artifact.persistenceVersion);
      }
      count += recovered;
    }
    return count;
  }

  async collect(tenantId: string, quotas: ArtifactQuotas) {
    const data = await this.call("collect_repository_artifacts", {
      input_tenant_id: tenantId,
      input_artifact_retention: quotas.retainedArtifacts,
      input_version_retention: quotas.retainedVersions,
      input_diagnostic_retention: quotas.retainedDiagnostics,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("repository_artifact_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as ArtifactMetrics);
  }

  async verify() {
    const data = await this.call("verify_repository_artifact_contract", {
      input_engine_version: REPOSITORY_ARTIFACT_ENGINE_VERSION,
      input_schema_version: REPOSITORY_ARTIFACT_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositoryArtifactError(
        "repository_artifact_startup_validation_failed",
        "Artifact database contract is invalid.",
        { problems: row.problems ?? [] },
      );
    }
  }
}

export const runtimeRepositoryArtifactStore: RepositoryArtifactStore =
  new PostgresRepositoryArtifactStore(supabase as unknown as SupabaseClient);
