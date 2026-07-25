export const COLLABORATION_ENGINE_VERSION = "multi-agent-collaboration-v1";
export const COLLABORATION_MESSAGE_SCHEMA_VERSION = "collaboration-message-v1";
export const COLLABORATION_REVIEW_SCHEMA_VERSION = "collaboration-review-v1";

export type CollaborationLifecycle =
  | "created"
  | "assembling"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed"
  | "superseded";

export type CollaborationRole = "coordinator" | "contributor" | "reviewer" | "observer";
export type ParticipantStatus = "registered" | "active" | "abandoned" | "completed" | "removed";
export type CollaborationWorkStatus =
  | "blocked"
  | "ready"
  | "assigned"
  | "running"
  | "awaiting_review"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CollaborationMessageType =
  | "assignment"
  | "progress"
  | "question"
  | "answer"
  | "review_request"
  | "review_response"
  | "blocker"
  | "completion"
  | "diagnostic";

export type CollaborationReviewVerdict = "approved" | "changes_requested" | "rejected";

export interface PublishedCollaborationArtifact<T = unknown> {
  readonly version: string;
  readonly published: true;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly payload: T;
}

export interface CollaborationContext {
  readonly repositorySnapshot: PublishedCollaborationArtifact;
  readonly retrievalBundle: PublishedCollaborationArtifact;
  readonly repositoryGraph: PublishedCollaborationArtifact;
  readonly intelligence: PublishedCollaborationArtifact;
  readonly planning: PublishedCollaborationArtifact;
  readonly executionMetadata: PublishedCollaborationArtifact<Readonly<{
    executionId: string;
    executionVersion: string;
    planVersion: string;
  }>>;
}

export interface CollaborationWorkUnitDefinition {
  readonly workUnitId: string;
  readonly workUnitVersion: string;
  readonly order: number;
  readonly prerequisites: readonly string[];
  readonly eligibleAgentIds: readonly string[];
  readonly eligibleRoles: readonly CollaborationRole[];
  readonly reviewRequired: boolean;
  readonly maxAttempts: number;
}

export interface CollaborationAssignment {
  readonly assignmentId: string;
  readonly runtimeId: string;
  readonly assignedAt: string;
  readonly attempt: number;
}

export interface CollaborationWorkUnit extends CollaborationWorkUnitDefinition {
  readonly status: CollaborationWorkStatus;
  readonly ownerRuntimeId: string | null;
  readonly assignment: CollaborationAssignment | null;
  readonly outputVersion: number;
  readonly retryCount: number;
  readonly blockerCode: string | null;
  readonly updatedAt: string;
}

export interface CollaborationParticipantLease {
  readonly leaseId: string;
  readonly claimToken: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export interface CollaborationParticipantHeartbeat {
  readonly recordedAt: string;
  readonly latencyMs: number;
}

export interface CollaborationParticipant {
  readonly runtimeId: string;
  readonly agentId: string;
  readonly capabilityVersion: string;
  readonly assignedWorkUnits: readonly string[];
  readonly lease: CollaborationParticipantLease | null;
  readonly heartbeat: CollaborationParticipantHeartbeat | null;
  readonly role: CollaborationRole;
  readonly status: ParticipantStatus;
  readonly registeredAt: string;
  readonly updatedAt: string;
}

export interface CollaborationMessage {
  readonly messageId: string;
  readonly collaborationId: string;
  readonly messageType: CollaborationMessageType;
  readonly senderRuntimeId: string;
  readonly receiverRuntimeId: string;
  readonly executionVersion: string;
  readonly workUnitId: string;
  readonly workUnitVersion: string;
  readonly timestamp: string;
  readonly payloadSchemaVersion: string;
  readonly payloadHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly orphaned: boolean;
}

export interface CollaborationReview {
  readonly reviewId: string;
  readonly collaborationId: string;
  readonly workUnitId: string;
  readonly workUnitVersion: string;
  readonly requesterRuntimeId: string;
  readonly reviewerRuntimeId: string;
  readonly reviewedOutputVersion: number;
  readonly verdict: CollaborationReviewVerdict | null;
  readonly findings: readonly string[];
  readonly status: "pending" | "completed" | "cancelled";
  readonly requestedAt: string;
  readonly timestamp: string | null;
}

export interface CollaborationDiagnostic {
  readonly diagnosticId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

export interface CollaborationRecoveryRecord {
  readonly recoveryId: string;
  readonly reason: "abandoned_participant" | "expired_lease" | "interrupted_session"
    | "pending_review" | "orphan_message";
  readonly participantRuntimeId: string | null;
  readonly workUnitId: string | null;
  readonly previousState: string;
  readonly recoveredState: string;
  readonly timestamp: string;
}

export interface CollaborationSession {
  readonly collaborationId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly executionVersion: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly planVersion: string;
  readonly participants: readonly CollaborationParticipant[];
  readonly coordinatorRuntimeId: string;
  readonly lifecycle: CollaborationLifecycle;
  readonly workUnits: readonly CollaborationWorkUnit[];
  readonly context: CollaborationContext;
  readonly messages: readonly CollaborationMessage[];
  readonly reviews: readonly CollaborationReview[];
  readonly diagnostics: readonly CollaborationDiagnostic[];
  readonly recoveryState: readonly CollaborationRecoveryRecord[];
  readonly conflictCount: number;
  readonly reassignmentCount: number;
  readonly recoveryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CreateCollaborationInput {
  readonly tenantId: string;
  readonly executionId: string;
  readonly executionVersion: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly planVersion: string;
  readonly coordinatorRuntimeId: string;
  readonly workUnits: readonly CollaborationWorkUnitDefinition[];
  readonly context: CollaborationContext;
}

export interface RegisterParticipantInput {
  readonly tenantId: string;
  readonly collaborationId: string;
  readonly runtimeId: string;
  readonly agentId: string;
  readonly capabilityVersion: string;
  readonly role: CollaborationRole;
  readonly leaseMs: number;
}

export interface CollaborationParticipantClaim {
  readonly tenantId: string;
  readonly collaborationId: string;
  readonly runtimeId: string;
  readonly capabilityVersion: string;
  readonly claimToken: string;
}

export interface SendCollaborationMessageInput {
  readonly claim: CollaborationParticipantClaim;
  readonly messageType: CollaborationMessageType;
  readonly receiverRuntimeId: string;
  readonly workUnitId: string;
  readonly workUnitVersion: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SubmitCollaborationReviewInput {
  readonly claim: CollaborationParticipantClaim;
  readonly reviewId: string;
  readonly reviewedOutputVersion: number;
  readonly verdict: CollaborationReviewVerdict;
  readonly findings: readonly string[];
}

export interface CollaborationQuotas {
  readonly participants: number;
  readonly messages: number;
  readonly pendingReviews: number;
  readonly durationMs: number;
  readonly retries: number;
  readonly messageBytes: number;
  readonly findings: number;
  readonly retentionCount: number;
}

export interface CollaborationMetrics {
  readonly activeCollaborations: number;
  readonly participants: number;
  readonly messages: number;
  readonly reviews: number;
  readonly conflicts: number;
  readonly reassignmentCount: number;
  readonly recoveryCount: number;
  readonly completionLatencyMs: number;
}

export class CollaborationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "CollaborationError";
  }
}
