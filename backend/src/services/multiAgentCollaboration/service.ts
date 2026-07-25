import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import { currentTraceContext, runWithChildSpan } from "../../observability/tracing.js";
import type { CollaborationStore } from "./store.js";
import { runtimeCollaborationStore } from "./store.js";
import type {
  CollaborationLifecycle,
  CollaborationParticipantClaim,
  CollaborationQuotas,
  CreateCollaborationInput,
  RegisterParticipantInput,
  SendCollaborationMessageInput,
  SubmitCollaborationReviewInput,
} from "./types.js";

export const DEFAULT_COLLABORATION_QUOTAS: CollaborationQuotas = Object.freeze({
  participants: 16,
  messages: 10_000,
  pendingReviews: 100,
  durationMs: 86_400_000,
  retries: 3,
  messageBytes: 64 * 1024,
  findings: 100,
  retentionCount: 1_000,
});

export class MultiAgentCollaborationEngine {
  constructor(
    private readonly store: CollaborationStore = runtimeCollaborationStore,
    private readonly quotas: CollaborationQuotas = DEFAULT_COLLABORATION_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async create(input: CreateCollaborationInput) {
    return runWithChildSpan(async () => {
      const session = await this.store.create(input, this.quotas);
      this.log("collaboration.created", session.collaborationId, {
        executionVersion: session.executionVersion,
        repositoryId: session.repositoryId,
        repositoryRevision: session.repositoryRevision,
        workUnitCount: session.workUnits.length,
      });
      await this.recordMetrics();
      return session;
    });
  }

  async registerParticipant(input: RegisterParticipantInput) {
    return runWithChildSpan(async () => {
      const session = await this.store.registerParticipant(input, this.quotas);
      this.log("collaboration.participant.registered", session.collaborationId, {
        runtimeId: input.runtimeId,
        agentId: input.agentId,
        capabilityVersion: input.capabilityVersion,
        role: input.role,
      });
      await this.recordMetrics();
      return session;
    });
  }

  async activate(tenantId: string, collaborationId: string, coordinatorRuntimeId: string) {
    const session = await this.store.activate(tenantId, collaborationId, coordinatorRuntimeId);
    this.log("collaboration.activated", collaborationId, {
      coordinatorRuntimeId,
      participantCount: session.participants.length,
    });
    await this.recordMetrics();
    return session;
  }

  get(tenantId: string, collaborationId: string) {
    return this.store.get(tenantId, collaborationId);
  }

  heartbeat(claim: CollaborationParticipantClaim, leaseMs: number) {
    return this.store.heartbeat(claim, leaseMs);
  }

  async schedule(tenantId: string, collaborationId: string) {
    return runWithChildSpan(async () => {
      const session = await this.store.schedule(tenantId, collaborationId, this.quotas);
      this.log("collaboration.scheduled", collaborationId, {
        assignmentCount: session.workUnits.filter((unit) => unit.status === "assigned").length,
        readyCount: session.workUnits.filter((unit) => unit.status === "ready").length,
        blockedCount: session.workUnits.filter((unit) => unit.status === "blocked").length,
      });
      await this.recordMetrics();
      return session;
    });
  }

  startWork(claim: CollaborationParticipantClaim, workUnitId: string, workUnitVersion: string) {
    return this.store.startWork(claim, workUnitId, workUnitVersion);
  }

  completeWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
  ) {
    return this.store.completeWork(
      claim, workUnitId, workUnitVersion, outputVersion, this.quotas,
    );
  }

  failWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    failureCode: string,
    retryable: boolean,
  ) {
    return this.store.failWork(
      claim, workUnitId, workUnitVersion, failureCode, retryable, this.quotas,
    );
  }

  async sendMessage(input: SendCollaborationMessageInput) {
    const message = await this.store.sendMessage(input, this.quotas);
    this.log("collaboration.message.persisted", input.claim.collaborationId, {
      messageId: message.messageId,
      messageType: message.messageType,
      senderRuntimeId: message.senderRuntimeId,
      receiverRuntimeId: message.receiverRuntimeId,
      workUnitVersion: message.workUnitVersion,
    });
    await this.recordMetrics();
    return message;
  }

  requestReview(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
  ) {
    return this.store.requestReview(
      claim, workUnitId, workUnitVersion, outputVersion, this.quotas,
    );
  }

  async submitReview(input: SubmitCollaborationReviewInput) {
    const review = await this.store.submitReview(input, this.quotas);
    this.log("collaboration.review.completed", input.claim.collaborationId, {
      reviewId: review.reviewId,
      reviewerRuntimeId: review.reviewerRuntimeId,
      reviewedOutputVersion: review.reviewedOutputVersion,
      verdict: review.verdict,
      findingCount: review.findings.length,
    });
    await this.recordMetrics();
    return review;
  }

  transition(
    tenantId: string,
    collaborationId: string,
    coordinatorRuntimeId: string,
    lifecycle: Extract<CollaborationLifecycle,
      "paused" | "active" | "cancelled" | "failed" | "superseded">,
  ) {
    return this.store.transition(
      tenantId, collaborationId, coordinatorRuntimeId, lifecycle,
    );
  }

  context(claim: CollaborationParticipantClaim) {
    return this.store.context(claim);
  }

  async recover() {
    const recovered = await this.store.recover(undefined, this.quotas);
    this.log("collaboration.recovered", null, { recoveryCount: recovered });
    await this.recordMetrics();
    return recovered;
  }

  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }

  collect(tenantId: string) {
    return this.store.collect(tenantId, this.quotas.retentionCount);
  }

  verify() {
    return this.store.verify();
  }

  private async recordMetrics(): Promise<void> {
    runtimeMetrics.recordCollaboration(await this.store.metrics());
  }

  private log(
    operation: string,
    collaborationId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      collaborationId,
      ...fields,
    });
  }
}

export const runtimeMultiAgentCollaborationEngine =
  new MultiAgentCollaborationEngine();
