import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  CreateReviewInput,
  DecideReviewInput,
  RepositoryReview,
  ReviewDecision,
  ReviewLifecycle,
  ReviewLifecycleEvent,
  ReviewMetrics,
  ReviewQuotas,
  ReviewRecoveryRecord,
  ReviewVersion,
} from "./types.js";
import {
  REPOSITORY_REVIEW_ENGINE_VERSION,
  REPOSITORY_REVIEW_OUTPUT_SCHEMA_VERSION,
  REPOSITORY_REVIEW_SCHEMA_VERSION,
  RepositoryReviewError,
} from "./types.js";
import {
  evaluateQualityGates,
  reviewIdentity,
  reviewOutputHash,
  validateReviewInput,
  validateReviewIntegrity,
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
const terminal = new Set<ReviewLifecycle>([
  "approved", "rejected", "archived", "expired",
]);

export interface RepositoryReviewStore {
  create(
    input: CreateReviewInput,
    quotas: ReviewQuotas,
    now?: Date,
  ): Promise<RepositoryReview>;
  get(
    tenantId: string,
    reviewId: string,
    ownerId: string,
  ): Promise<RepositoryReview | null>;
  decide(input: DecideReviewInput, now?: Date): Promise<RepositoryReview>;
  archive(
    tenantId: string,
    reviewId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ): Promise<RepositoryReview>;
  recover(now?: Date, quotas?: ReviewQuotas): Promise<number>;
  collect(tenantId: string, quotas: ReviewQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<ReviewMetrics>;
  verify(quotas?: ReviewQuotas): Promise<void>;
}

function lifecycleEvent(
  reviewId: string,
  reviewVersion: number,
  from: ReviewLifecycle | null,
  to: ReviewLifecycle,
  reason: string,
  createdAt: string,
  sequence: number,
): ReviewLifecycleEvent {
  return {
    eventId: stableId("repository_review_lifecycle", {
      reviewId, reviewVersion, from, to, reason, sequence,
    }),
    reviewVersion, from, to, reason, createdAt,
  };
}

function emptyMetrics(): ReviewMetrics {
  return {
    reviewsCreated: 0, approvals: 0, rejections: 0,
    validationFailures: 0, blockerCount: 0, warningCount: 0,
    reviewLatencyMs: 0, recoveryCount: 0,
  };
}

export class MemoryRepositoryReviewStore implements RepositoryReviewStore {
  private readonly reviews = new Map<string, RepositoryReview>();
  private rejectedValidationCount = 0;

  private key(tenantId: string, reviewId: string): string {
    return `${tenantId}\0${reviewId}`;
  }

  hydrate(review: RepositoryReview): void {
    this.reviews.set(this.key(review.tenantId, review.reviewId), clone(review));
  }

  private save(review: RepositoryReview): RepositoryReview {
    const key = this.key(review.tenantId, review.reviewId);
    const existing = this.reviews.get(key);
    const saved = clone({
      ...review,
      persistenceVersion: existing
        ? Math.max(existing.persistenceVersion, review.persistenceVersion) + 1 : 1,
    });
    this.reviews.set(key, saved);
    return clone(saved);
  }

  private require(
    tenantId: string,
    reviewId: string,
    ownerId: string,
  ): RepositoryReview {
    const review = this.reviews.get(this.key(tenantId, reviewId));
    if (!review) {
      throw new RepositoryReviewError(
        "repository_review_not_found", "Review was not found.");
    }
    if (review.ownerId !== ownerId) {
      throw new RepositoryReviewError(
        "repository_review_ownership_conflict",
        "Review belongs to another owner.");
    }
    return review;
  }

  async create(
    input: CreateReviewInput,
    quotas: ReviewQuotas,
    now = new Date(),
  ): Promise<RepositoryReview> {
    const reviewId = reviewIdentity(input);
    const existing = this.reviews.get(this.key(input.tenantId, reviewId));
    const reviewCount = [...this.reviews.values()].filter((review) =>
      review.tenantId === input.tenantId &&
      review.artifactId === input.artifact.artifactId &&
      review.reviewId !== reviewId).length;
    try {
      validateReviewInput(
        input, quotas, existing?.reviewVersion ?? 0, reviewCount, now,
      );
    } catch (error) {
      this.rejectedValidationCount += 1;
      throw error;
    }
    if (existing &&
        !["changes_requested"].includes(existing.lifecycle)) {
      throw new RepositoryReviewError(
        "repository_review_lifecycle_conflict",
        "Only reviews with requested changes may receive a new version.");
    }
    const timestamp = now.toISOString();
    const reviewVersion = (existing?.reviewVersion ?? 0) + 1;
    const evaluated = evaluateQualityGates(
      input, reviewId, reviewVersion, quotas, timestamp,
    );
    const artifactVersion = input.artifact.versions.at(-1)!;
    const deterministicSeed = stableHash({
      reviewId, reviewVersion,
      artifactHash: artifactVersion.contentHash,
      snapshotHash: input.snapshot.snapshotHash,
      patchHash: input.patch.contentHash,
      graphHash: input.repositoryGraph.contentHash,
      intelligenceHash: input.intelligence.contentHash,
      planningHash: input.planning.contentHash,
      executionVersion: input.executionMetadata.executionVersion,
    });
    const versionBody: Omit<ReviewVersion, "outputHash"> = {
      reviewId,
      reviewVersion,
      artifactVersion: input.artifact.artifactVersion,
      verdict: evaluated.verdict,
      confidence: evaluated.confidence,
      findings: evaluated.findings,
      diagnostics: evaluated.diagnostics,
      metrics: evaluated.metrics,
      reviewMetadata: {
        engineVersion: REPOSITORY_REVIEW_ENGINE_VERSION,
        schemaVersion: REPOSITORY_REVIEW_OUTPUT_SCHEMA_VERSION,
        deterministicSeed,
        artifactVersion: input.artifact.artifactVersion,
        artifactContentHash: artifactVersion.contentHash,
        snapshotVersion: input.snapshot.snapshotVersion,
        snapshotHash: input.snapshot.snapshotHash,
        patchVersion: input.patch.patchVersion,
        patchHash: input.patch.contentHash,
        graphVersion: input.repositoryGraph.version,
        intelligenceVersion: input.intelligence.version,
        planningVersion: input.planning.version,
        executionVersion: input.executionMetadata.executionVersion,
        validatedAt: timestamp,
        validationLatencyMs: 0,
      },
      createdAt: timestamp,
      validatedAt: timestamp,
    };
    const version: ReviewVersion = {
      ...versionBody,
      outputHash: reviewOutputHash(versionBody),
    };
    const history = [...(existing?.lifecycleHistory ?? [])];
    const previous = existing?.lifecycle ?? null;
    for (const [from, to, reason] of [
      [previous, "created", "review_version_created"],
      ["created", "validating", "quality_gates_started"],
      ["validating", "awaiting_decision", "quality_gates_completed"],
    ] as const) {
      history.push(lifecycleEvent(
        reviewId, reviewVersion, from, to, reason, timestamp, history.length + 1,
      ));
    }
    return this.save({
      reviewId,
      schemaVersion: REPOSITORY_REVIEW_SCHEMA_VERSION,
      persistenceVersion: existing?.persistenceVersion ?? 0,
      tenantId: input.tenantId,
      repositoryId: input.artifact.repositoryId,
      repositoryRevision: input.artifact.repositoryRevision,
      artifactId: input.artifact.artifactId,
      workspaceId: input.workspace.workspaceId,
      executionId: input.executionMetadata.executionId,
      workUnitId: input.executionMetadata.workUnitId,
      ownerId: input.ownerId,
      reviewerType: input.reviewerType,
      reviewVersion,
      lifecycle: "awaiting_decision",
      versions: [...(existing?.versions ?? []), version],
      findings: [...(existing?.findings ?? []), ...evaluated.findings],
      diagnostics: [...(existing?.diagnostics ?? []), ...evaluated.diagnostics],
      decisions: existing?.decisions ?? [],
      lifecycleHistory: history,
      recoveryHistory: existing?.recoveryHistory ?? [],
      archiveMetadata: null,
      validationFailureCount: (existing?.validationFailureCount ?? 0) +
        evaluated.metrics.errorCount + evaluated.metrics.blockerCount,
      recoveryCount: existing?.recoveryCount ?? 0,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
      decisionRequestedAt: timestamp,
      reviewLeaseExpiresAt: input.reviewLeaseExpiresAt ?? null,
    });
  }

  async get(tenantId: string, reviewId: string, ownerId: string) {
    const review = this.reviews.get(this.key(tenantId, reviewId));
    if (!review) return null;
    if (review.ownerId !== ownerId) {
      throw new RepositoryReviewError(
        "repository_review_ownership_conflict",
        "Review belongs to another owner.");
    }
    return clone(review);
  }

  async decide(
    input: DecideReviewInput,
    now = new Date(),
  ): Promise<RepositoryReview> {
    const review = this.require(input.tenantId, input.reviewId, input.ownerId);
    if (review.lifecycle !== "awaiting_decision") {
      throw new RepositoryReviewError(
        "repository_review_lifecycle_conflict",
        "Only reviews awaiting a decision may be decided.");
    }
    if (review.reviewVersion !== input.reviewVersion) {
      throw new RepositoryReviewError(
        "repository_review_version_stale",
        "Decision targets a stale review version.");
    }
    if (!input.reviewerId.trim() || !input.idempotencyKey.trim() ||
        input.rationaleCodes.some((code) => !code.trim()) ||
        !["approved", "changes_requested", "rejected"].includes(input.verdict)) {
      throw new RepositoryReviewError(
        "repository_review_decision_invalid",
        "Review decision is malformed.");
    }
    const sortedCodes = sortedUnique(input.rationaleCodes);
    const payloadHash = stableHash({
      reviewId: input.reviewId, reviewVersion: input.reviewVersion,
      reviewerId: input.reviewerId, verdict: input.verdict,
      rationaleCodes: sortedCodes,
    });
    const replay = review.decisions.find((decision) =>
      decision.idempotencyKey === input.idempotencyKey);
    if (replay) {
      if (stableHash({
        reviewId: replay.reviewId, reviewVersion: replay.reviewVersion,
        reviewerId: replay.reviewerId, verdict: replay.verdict,
        rationaleCodes: replay.rationaleCodes,
      }) !== payloadHash) {
        throw new RepositoryReviewError(
          "repository_review_idempotency_conflict",
          "Decision idempotency payload conflicts.");
      }
      return clone(review);
    }
    const timestamp = now.toISOString();
    const decision: ReviewDecision = {
      decisionId: stableId("repository_review_decision", {
        reviewId: review.reviewId, reviewVersion: review.reviewVersion,
        idempotencyKey: input.idempotencyKey,
      }),
      reviewId: review.reviewId,
      reviewVersion: review.reviewVersion,
      ownerId: input.ownerId,
      reviewerId: input.reviewerId,
      verdict: input.verdict,
      rationaleCodes: sortedCodes,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    };
    return this.save({
      ...review,
      lifecycle: input.verdict,
      decisions: [...review.decisions, decision],
      lifecycleHistory: [...review.lifecycleHistory, lifecycleEvent(
        review.reviewId, review.reviewVersion,
        review.lifecycle, input.verdict, "review_decided",
        timestamp, review.lifecycleHistory.length + 1,
      )],
      updatedAt: timestamp,
      completedAt: input.verdict === "changes_requested" ? null : timestamp,
      reviewLeaseExpiresAt: null,
    });
  }

  async archive(
    tenantId: string,
    reviewId: string,
    ownerId: string,
    expectedVersion: number,
    now = new Date(),
  ): Promise<RepositoryReview> {
    const review = this.require(tenantId, reviewId, ownerId);
    if (review.reviewVersion !== expectedVersion) {
      throw new RepositoryReviewError(
        "repository_review_version_stale",
        "Archive targets a stale review version.");
    }
    if (!["approved", "rejected", "expired"].includes(review.lifecycle)) {
      throw new RepositoryReviewError(
        "repository_review_lifecycle_conflict",
        "Only completed reviews may be archived.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...review,
      lifecycle: "archived",
      lifecycleHistory: [...review.lifecycleHistory, lifecycleEvent(
        review.reviewId, review.reviewVersion,
        review.lifecycle, "archived", "manual_archive",
        timestamp, review.lifecycleHistory.length + 1,
      )],
      archiveMetadata: {
        archivedAt: timestamp,
        reason: "manual",
        finalReviewVersion: review.reviewVersion,
        outputHash: review.versions.at(-1)!.outputHash,
      },
      updatedAt: timestamp,
      completedAt: timestamp,
      reviewLeaseExpiresAt: null,
    });
  }

  private recovered(
    review: RepositoryReview,
    reason: ReviewRecoveryRecord["reason"],
    lifecycle: ReviewLifecycle,
    orphanFindingIds: readonly string[],
    now: Date,
  ): RepositoryReview {
    const timestamp = now.toISOString();
    const recovery: ReviewRecoveryRecord = {
      recoveryId: stableId("repository_review_recovery", {
        reviewId: review.reviewId,
        reviewVersion: review.reviewVersion,
        reason,
        orphanFindingIds: [...orphanFindingIds].sort(),
        sequence: review.recoveryHistory.length + 1,
      }),
      reason,
      previousLifecycle: review.lifecycle,
      recoveredLifecycle: lifecycle,
      orphanFindingIds: [...orphanFindingIds].sort(),
      createdAt: timestamp,
    };
    return {
      ...review,
      lifecycle,
      recoveryHistory: [...review.recoveryHistory, recovery],
      lifecycleHistory: lifecycle === review.lifecycle
        ? review.lifecycleHistory
        : [...review.lifecycleHistory, lifecycleEvent(
          review.reviewId, review.reviewVersion,
          review.lifecycle, lifecycle, `recovery_${reason}`,
          timestamp, review.lifecycleHistory.length + 1,
        )],
      recoveryCount: review.recoveryCount + 1,
      updatedAt: timestamp,
      completedAt: terminal.has(lifecycle) ? timestamp : review.completedAt,
      reviewLeaseExpiresAt: reason === "orphan_findings"
        ? review.reviewLeaseExpiresAt : null,
    };
  }

  async recover(now = new Date(), quotas?: ReviewQuotas): Promise<number> {
    let count = 0;
    for (const current of [...this.reviews.values()]) {
      const versionFindingIds = new Set(current.versions.flatMap((version) =>
        version.findings.map((finding) => finding.findingId)));
      const orphanFindings = current.findings.filter((finding) =>
        !versionFindingIds.has(finding.findingId));
      let review = current;
      if (orphanFindings.length > 0) {
        review = this.recovered(
          { ...review, findings: review.findings.filter((finding) =>
            versionFindingIds.has(finding.findingId)) },
          "orphan_findings", review.lifecycle,
          orphanFindings.map((finding) => finding.findingId), now,
        );
        count += 1;
      }
      if (!terminal.has(review.lifecycle)) {
        const age = now.getTime() - Date.parse(review.updatedAt);
        if (review.reviewLeaseExpiresAt &&
            Date.parse(review.reviewLeaseExpiresAt) <= now.getTime()) {
          review = this.recovered(
            review, "expired_review_lease", "expired", [], now,
          );
          count += 1;
        } else if (review.lifecycle === "created" &&
            (!quotas || age >= quotas.validationTimeoutMs)) {
          review = this.recovered(
            review, "abandoned_review", "expired", [], now,
          );
          count += 1;
        } else if (review.lifecycle === "validating" &&
            (!quotas || age >= quotas.validationTimeoutMs)) {
          review = this.recovered(
            review, "incomplete_validation", "expired", [], now,
          );
          count += 1;
        } else if (review.lifecycle === "awaiting_decision" && quotas &&
            age >= quotas.reviewTtlMs) {
          review = this.recovered(
            review, "abandoned_review", "expired", [], now,
          );
          count += 1;
        }
      }
      if (stableHash(review) !== stableHash(current)) this.save(review);
    }
    return count;
  }

  async collect(tenantId: string, quotas: ReviewQuotas): Promise<number> {
    const completed = [...this.reviews.entries()]
      .filter(([, review]) =>
        review.tenantId === tenantId && terminal.has(review.lifecycle))
      .sort((left, right) =>
        (right[1].completedAt ?? right[1].updatedAt)
          .localeCompare(left[1].completedAt ?? left[1].updatedAt) ||
        right[1].reviewId.localeCompare(left[1].reviewId));
    let removed = 0;
    for (const [key] of completed.slice(Math.max(1, quotas.retainedReviews))) {
      this.reviews.delete(key);
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string): Promise<ReviewMetrics> {
    const metrics = [...this.reviews.values()]
      .filter((review) => tenantId === undefined || review.tenantId === tenantId)
      .reduce<ReviewMetrics>((result, review) => ({
        reviewsCreated: result.reviewsCreated + review.versions.length,
        approvals: result.approvals + review.decisions.filter((decision) =>
          decision.verdict === "approved").length,
        rejections: result.rejections + review.decisions.filter((decision) =>
          decision.verdict === "rejected").length,
        validationFailures: result.validationFailures +
          review.validationFailureCount,
        blockerCount: result.blockerCount + review.findings.filter((finding) =>
          finding.severity === "blocker").length,
        warningCount: result.warningCount + review.findings.filter((finding) =>
          finding.severity === "warning").length,
        reviewLatencyMs: result.reviewLatencyMs + review.decisions.reduce(
          (sum, decision) => sum + Math.max(0,
            Date.parse(decision.createdAt) -
            Date.parse(review.decisionRequestedAt ?? decision.createdAt)), 0),
        recoveryCount: result.recoveryCount + review.recoveryCount,
      }), emptyMetrics());
    return {
      ...metrics,
      validationFailures:
        metrics.validationFailures + this.rejectedValidationCount,
    };
  }

  async verify(quotas?: ReviewQuotas): Promise<void> {
    const validationQuotas: ReviewQuotas = quotas ?? {
      reviewsPerArtifact: Number.MAX_SAFE_INTEGER,
      versionsPerReview: Number.MAX_SAFE_INTEGER,
      operationsPerReview: Number.MAX_SAFE_INTEGER,
      findingsPerReview: Number.MAX_SAFE_INTEGER,
      diagnosticsPerReview: Number.MAX_SAFE_INTEGER,
      reviewBytes: Number.MAX_SAFE_INTEGER,
      retainedReviews: Number.MAX_SAFE_INTEGER,
      retainedVersions: Number.MAX_SAFE_INTEGER,
      retainedFindings: Number.MAX_SAFE_INTEGER,
      validationTimeoutMs: Number.MAX_SAFE_INTEGER,
      reviewTtlMs: Number.MAX_SAFE_INTEGER,
    };
    for (const review of this.reviews.values()) {
      validateReviewIntegrity(review, validationQuotas);
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

export class PostgresRepositoryReviewStore implements RepositoryReviewStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(
    name: string,
    parameters: Record<string, unknown> = {},
  ): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code = error.message?.match(/repository_review_[a-z_]+/u)?.[0] ??
        "repository_review_persistence_failed";
      throw new RepositoryReviewError(
        code, error.message ?? "Review persistence failed.");
    }
    return data;
  }

  private async load(
    tenantId: string,
    reviewId: string,
  ): Promise<RepositoryReview | null> {
    const data = await this.call("get_repository_quality_review", {
      input_tenant_id: tenantId,
      input_review_id: reviewId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.review ?? data) as RepositoryReview);
  }

  private async persist(
    review: RepositoryReview,
    expectedVersion: number | null,
  ): Promise<RepositoryReview> {
    const data = await this.call("save_repository_quality_review", {
      input_review: review,
      input_expected_version: expectedVersion === null
        ? null : String(expectedVersion),
    });
    return clone((first(data)?.review ?? data) as RepositoryReview);
  }

  private async mutate(
    tenantId: string,
    reviewId: string,
    operation: (
      memory: MemoryRepositoryReviewStore,
      existing: RepositoryReview,
    ) => Promise<unknown>,
  ): Promise<RepositoryReview> {
    const existing = await this.load(tenantId, reviewId);
    if (!existing) {
      throw new RepositoryReviewError(
        "repository_review_not_found", "Review was not found.");
    }
    const memory = new MemoryRepositoryReviewStore();
    memory.hydrate(existing);
    await operation(memory, existing);
    const updated = await memory.get(
      tenantId, reviewId, existing.ownerId,
    );
    if (!updated) {
      throw new RepositoryReviewError(
        "repository_review_not_found", "Review was not found.");
    }
    return this.persist(updated, existing.persistenceVersion);
  }

  async create(input: CreateReviewInput, quotas: ReviewQuotas, now?: Date) {
    const reviewId = reviewIdentity(input);
    const existing = await this.load(input.tenantId, reviewId);
    if (!existing) {
      const countData = await this.call("count_repository_artifact_reviews", {
        input_tenant_id: input.tenantId,
        input_artifact_id: input.artifact.artifactId,
      });
      const count = Number(first(countData)?.review_count ?? countData ?? 0);
      if (count >= quotas.reviewsPerArtifact) {
        throw new RepositoryReviewError(
          "repository_review_quota_exceeded",
          "Artifact review quota exceeded.");
      }
    }
    const memory = new MemoryRepositoryReviewStore();
    if (existing) memory.hydrate(existing);
    const review = await memory.create(input, quotas, now);
    return this.persist(review, existing?.persistenceVersion ?? null);
  }

  async get(tenantId: string, reviewId: string, ownerId: string) {
    const review = await this.load(tenantId, reviewId);
    if (review && review.ownerId !== ownerId) {
      throw new RepositoryReviewError(
        "repository_review_ownership_conflict",
        "Review belongs to another owner.");
    }
    return review;
  }

  async decide(input: DecideReviewInput, now?: Date) {
    return this.mutate(input.tenantId, input.reviewId,
      (memory) => memory.decide(input, now));
  }

  async archive(
    tenantId: string,
    reviewId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ) {
    return this.mutate(tenantId, reviewId,
      (memory) => memory.archive(
        tenantId, reviewId, ownerId, expectedVersion, now,
      ));
  }

  async recover(now = new Date(), quotas?: ReviewQuotas) {
    const data = await this.call("list_recoverable_repository_quality_reviews");
    const reviews = (first(data)?.reviews ?? data ?? []) as RepositoryReview[];
    let count = 0;
    for (const review of reviews) {
      const memory = new MemoryRepositoryReviewStore();
      memory.hydrate(review);
      const recovered = await memory.recover(now, quotas);
      if (recovered > 0) {
        const updated = await memory.get(
          review.tenantId, review.reviewId, review.ownerId,
        );
        if (updated) await this.persist(updated, review.persistenceVersion);
      }
      count += recovered;
    }
    return count;
  }

  async collect(tenantId: string, quotas: ReviewQuotas) {
    const data = await this.call("collect_repository_quality_reviews", {
      input_tenant_id: tenantId,
      input_review_retention: quotas.retainedReviews,
      input_version_retention: quotas.retainedVersions,
      input_finding_retention: quotas.retainedFindings,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("repository_quality_review_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as ReviewMetrics);
  }

  async verify() {
    const data = await this.call("verify_repository_quality_review_contract", {
      input_engine_version: REPOSITORY_REVIEW_ENGINE_VERSION,
      input_schema_version: REPOSITORY_REVIEW_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositoryReviewError(
        "repository_review_startup_validation_failed",
        "Review database contract is invalid.",
        { problems: row.problems ?? [] },
      );
    }
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export const runtimeRepositoryReviewStore: RepositoryReviewStore =
  new PostgresRepositoryReviewStore(supabase as unknown as SupabaseClient);
