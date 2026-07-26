import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import { currentTraceContext, runWithChildSpan } from "../../observability/tracing.js";
import type { RepositoryReviewStore } from "./store.js";
import { runtimeRepositoryReviewStore } from "./store.js";
import type {
  CreateReviewInput,
  DecideReviewInput,
  ReviewQuotas,
} from "./types.js";

export const DEFAULT_REVIEW_QUOTAS: ReviewQuotas = Object.freeze({
  reviewsPerArtifact: 3,
  versionsPerReview: 100,
  operationsPerReview: 1_000,
  findingsPerReview: 1_000,
  diagnosticsPerReview: 500,
  reviewBytes: 2 * 1024 * 1024,
  retainedReviews: 100,
  retainedVersions: 100,
  retainedFindings: 1_000,
  validationTimeoutMs: 5 * 60 * 1_000,
  reviewTtlMs: 30 * 24 * 60 * 60 * 1_000,
});

export class RepositoryReviewEngine {
  constructor(
    private readonly store: RepositoryReviewStore = runtimeRepositoryReviewStore,
    private readonly quotas: ReviewQuotas = DEFAULT_REVIEW_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async create(input: CreateReviewInput) {
    return runWithChildSpan(async () => {
      const review = await this.store.create(input, this.quotas);
      this.log("repository_review.created", review.reviewId, {
        artifactId: review.artifactId,
        workspaceId: review.workspaceId,
        executionId: review.executionId,
        workUnitId: review.workUnitId,
        reviewVersion: review.reviewVersion,
        reviewerType: review.reviewerType,
        verdict: review.versions.at(-1)?.verdict,
      });
      await this.recordMetrics();
      return review;
    });
  }

  get(tenantId: string, reviewId: string, ownerId: string) {
    return this.store.get(tenantId, reviewId, ownerId);
  }

  async decide(input: DecideReviewInput) {
    const review = await this.store.decide(input);
    await this.recordMetrics();
    return review;
  }

  archive(
    tenantId: string,
    reviewId: string,
    ownerId: string,
    expectedVersion: number,
  ) {
    return this.store.archive(
      tenantId, reviewId, ownerId, expectedVersion,
    );
  }

  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    this.log("repository_review.recovered", null, { recoveryCount: count });
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
    runtimeMetrics.recordRepositoryReview(await this.store.metrics());
  }

  private log(
    operation: string,
    reviewId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      reviewId,
      ...fields,
    });
  }
}

export const runtimeRepositoryReviewEngine = new RepositoryReviewEngine();
