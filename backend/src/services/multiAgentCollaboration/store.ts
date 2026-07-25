import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import {
  deterministicCollaborationAssignments,
  deterministicReviewer,
  propagateCollaborationReadiness,
} from "./scheduler.js";
import type {
  CollaborationDiagnostic,
  CollaborationLifecycle,
  CollaborationMessage,
  CollaborationMetrics,
  CollaborationParticipant,
  CollaborationParticipantClaim,
  CollaborationQuotas,
  CollaborationRecoveryRecord,
  CollaborationReview,
  CollaborationSession,
  CollaborationWorkUnit,
  CreateCollaborationInput,
  RegisterParticipantInput,
  SendCollaborationMessageInput,
  SubmitCollaborationReviewInput,
} from "./types.js";
import {
  COLLABORATION_ENGINE_VERSION,
  COLLABORATION_MESSAGE_SCHEMA_VERSION,
  CollaborationError,
} from "./types.js";
import {
  collaborationIdentity,
  immutableCollaborationClone,
  validateCollaborationContext,
  validateCollaborationWorkUnits,
  validateMessagePayload,
} from "./validation.js";

export interface CollaborationStore {
  create(input: CreateCollaborationInput, quotas: CollaborationQuotas, now?: Date): Promise<CollaborationSession>;
  get(tenantId: string, collaborationId: string): Promise<CollaborationSession | null>;
  registerParticipant(input: RegisterParticipantInput, quotas: CollaborationQuotas, now?: Date): Promise<CollaborationSession>;
  activate(tenantId: string, collaborationId: string, coordinatorRuntimeId: string, now?: Date): Promise<CollaborationSession>;
  heartbeat(claim: CollaborationParticipantClaim, leaseMs: number, now?: Date): Promise<CollaborationParticipant>;
  schedule(tenantId: string, collaborationId: string, quotas: CollaborationQuotas, now?: Date): Promise<CollaborationSession>;
  startWork(claim: CollaborationParticipantClaim, workUnitId: string, workUnitVersion: string, now?: Date): Promise<CollaborationSession>;
  completeWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
    quotas: CollaborationQuotas,
    now?: Date,
  ): Promise<CollaborationSession>;
  failWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    failureCode: string,
    retryable: boolean,
    quotas: CollaborationQuotas,
    now?: Date,
  ): Promise<CollaborationSession>;
  sendMessage(input: SendCollaborationMessageInput, quotas: CollaborationQuotas, now?: Date): Promise<CollaborationMessage>;
  requestReview(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
    quotas: CollaborationQuotas,
    now?: Date,
  ): Promise<CollaborationReview>;
  submitReview(input: SubmitCollaborationReviewInput, quotas: CollaborationQuotas, now?: Date): Promise<CollaborationReview>;
  transition(
    tenantId: string,
    collaborationId: string,
    coordinatorRuntimeId: string,
    lifecycle: Extract<CollaborationLifecycle, "paused" | "active" | "cancelled" | "failed" | "superseded">,
    now?: Date,
  ): Promise<CollaborationSession>;
  context(claim: CollaborationParticipantClaim): Promise<CollaborationSession["context"]>;
  recover(now?: Date, quotas?: CollaborationQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<CollaborationMetrics>;
  collect(tenantId: string, retentionCount: number): Promise<number>;
  verify(): Promise<void>;
}

const terminal = new Set<CollaborationLifecycle>([
  "completed", "cancelled", "failed", "superseded",
]);
const clone = <T>(value: T): T => immutableCollaborationClone(value);

function emptyMetrics(): CollaborationMetrics {
  return {
    activeCollaborations: 0,
    participants: 0,
    messages: 0,
    reviews: 0,
    conflicts: 0,
    reassignmentCount: 0,
    recoveryCount: 0,
    completionLatencyMs: 0,
  };
}

export class MemoryCollaborationStore implements CollaborationStore {
  private readonly sessions = new Map<string, CollaborationSession>();

  private key(tenantId: string, collaborationId: string): string {
    return `${tenantId}\0${collaborationId}`;
  }

  hydrate(session: CollaborationSession): void {
    this.sessions.set(this.key(session.tenantId, session.collaborationId), clone(session));
  }

  private require(tenantId: string, collaborationId: string): CollaborationSession {
    const session = this.sessions.get(this.key(tenantId, collaborationId));
    if (!session) throw new CollaborationError("collaboration_not_found", "Collaboration was not found.");
    return session;
  }

  private save(session: CollaborationSession): CollaborationSession {
    const copy = clone(session);
    this.sessions.set(this.key(copy.tenantId, copy.collaborationId), copy);
    return clone(copy);
  }

  private conflict(session: CollaborationSession, code: string, message: string): never {
    const timestamp = new Date().toISOString();
    const diagnostic: CollaborationDiagnostic = {
      diagnosticId: stableId("collaboration_diagnostic", {
        collaborationId: session.collaborationId,
        code,
        sequence: session.conflictCount + 1,
      }),
      code,
      message,
      retryable: false,
      details: {},
      timestamp,
    };
    this.sessions.set(this.key(session.tenantId, session.collaborationId), clone({
      ...session,
      conflictCount: session.conflictCount + 1,
      diagnostics: [...session.diagnostics, diagnostic],
      updatedAt: timestamp,
    }));
    throw new CollaborationError(code, message, { collaborationId: session.collaborationId });
  }

  private participant(
    session: CollaborationSession,
    runtimeId: string,
  ): CollaborationParticipant {
    const participant = session.participants.find((candidate) => candidate.runtimeId === runtimeId);
    if (!participant || participant.status === "removed") {
      this.conflict(session, "collaboration_participant_not_found", "Participant was not found.");
    }
    return participant;
  }

  private fenced(
    claim: CollaborationParticipantClaim,
    now = new Date(),
  ): { session: CollaborationSession; participant: CollaborationParticipant } {
    const session = this.require(claim.tenantId, claim.collaborationId);
    const participant = this.participant(session, claim.runtimeId);
    if (participant.capabilityVersion !== claim.capabilityVersion) {
      this.conflict(session, "stale_collaboration_capability", "Participant capability version is stale.");
    }
    if (participant.status !== "active" || !participant.lease ||
        participant.lease.claimToken !== claim.claimToken ||
        Date.parse(participant.lease.expiresAt) <= now.getTime()) {
      this.conflict(session, "stale_collaboration_lease", "Participant lease is stale.");
    }
    if (session.lifecycle !== "active") {
      this.conflict(session, "collaboration_not_active", "Collaboration is not active.");
    }
    return { session, participant };
  }

  private unit(
    session: CollaborationSession,
    workUnitId: string,
    workUnitVersion: string,
  ): CollaborationWorkUnit {
    const unit = session.workUnits.find((candidate) => candidate.workUnitId === workUnitId);
    if (!unit) this.conflict(session, "collaboration_work_unit_not_found", "Work unit was not found.");
    if (unit.workUnitVersion !== workUnitVersion) {
      this.conflict(session, "stale_collaboration_work_unit", "Work-unit version is stale.");
    }
    return unit;
  }

  private appendMessage(
    session: CollaborationSession,
    input: Omit<SendCollaborationMessageInput, "claim"> & {
      senderRuntimeId: string;
      claim?: CollaborationParticipantClaim;
    },
    quotas: CollaborationQuotas,
    now: Date,
  ): { session: CollaborationSession; message: CollaborationMessage } {
    if (session.messages.length >= quotas.messages) {
      throw new CollaborationError("collaboration_message_count_quota_exceeded",
        "Collaboration message quota exceeded.");
    }
    validateMessagePayload(input.messageType, input.payload, quotas);
    this.participant(session, input.senderRuntimeId);
    this.participant(session, input.receiverRuntimeId);
    this.unit(session, input.workUnitId, input.workUnitVersion);
    const payloadHash = stableHash(input.payload);
    const timestamp = now.toISOString();
    const message: CollaborationMessage = {
      messageId: stableId("collaboration_message", {
        collaborationId: session.collaborationId,
        sequence: session.messages.length + 1,
        messageType: input.messageType,
        senderRuntimeId: input.senderRuntimeId,
        receiverRuntimeId: input.receiverRuntimeId,
        executionVersion: session.executionVersion,
        workUnitVersion: input.workUnitVersion,
        payloadHash,
      }),
      collaborationId: session.collaborationId,
      messageType: input.messageType,
      senderRuntimeId: input.senderRuntimeId,
      receiverRuntimeId: input.receiverRuntimeId,
      executionVersion: session.executionVersion,
      workUnitId: input.workUnitId,
      workUnitVersion: input.workUnitVersion,
      timestamp,
      payloadSchemaVersion: COLLABORATION_MESSAGE_SCHEMA_VERSION,
      payloadHash,
      payload: clone(input.payload),
      orphaned: false,
    };
    return {
      message,
      session: {
        ...session,
        messages: [...session.messages, message],
        updatedAt: timestamp,
      },
    };
  }

  async create(
    input: CreateCollaborationInput,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationSession> {
    if (!input.tenantId.trim() || !input.executionId.trim() || !input.executionVersion.trim() ||
        !input.repositoryId.trim() || !input.repositoryRevision.trim() ||
        !input.planVersion.trim() || !input.coordinatorRuntimeId.trim()) {
      throw new CollaborationError("invalid_collaboration_identity",
        "Collaboration identity is incomplete.");
    }
    validateCollaborationWorkUnits(input.workUnits);
    const context = validateCollaborationContext(input);
    const active = [...this.sessions.values()].filter((session) =>
      session.tenantId === input.tenantId && !terminal.has(session.lifecycle)).length;
    if (active >= quotas.participants * 4) {
      throw new CollaborationError("collaboration_session_quota_exceeded",
        "Active collaboration quota exceeded.");
    }
    const collaborationId = collaborationIdentity(input);
    const existing = this.sessions.get(this.key(input.tenantId, collaborationId));
    if (existing) {
      const incomingHash = stableHash({ ...input, context });
      const existingHash = stableHash({
        tenantId: existing.tenantId,
        executionId: existing.executionId,
        executionVersion: existing.executionVersion,
        repositoryId: existing.repositoryId,
        repositoryRevision: existing.repositoryRevision,
        planVersion: existing.planVersion,
        coordinatorRuntimeId: existing.coordinatorRuntimeId,
        workUnits: existing.workUnits.map((unit) => ({
          workUnitId: unit.workUnitId,
          workUnitVersion: unit.workUnitVersion,
          order: unit.order,
          prerequisites: unit.prerequisites,
          eligibleAgentIds: unit.eligibleAgentIds,
          eligibleRoles: unit.eligibleRoles,
          reviewRequired: unit.reviewRequired,
          maxAttempts: unit.maxAttempts,
        })),
        context: existing.context,
      });
      if (incomingHash !== existingHash) {
        this.conflict(existing, "collaboration_identity_conflict",
          "Deterministic collaboration identity conflicts.");
      }
      return clone(existing);
    }
    const timestamp = now.toISOString();
    return this.save({
      collaborationId,
      tenantId: input.tenantId,
      executionId: input.executionId,
      executionVersion: input.executionVersion,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      planVersion: input.planVersion,
      participants: [],
      coordinatorRuntimeId: input.coordinatorRuntimeId,
      lifecycle: "created",
      workUnits: [...input.workUnits]
        .sort((left, right) => left.order - right.order ||
          left.workUnitId.localeCompare(right.workUnitId))
        .map((unit) => ({
          ...clone(unit),
          status: unit.prerequisites.length === 0 ? "ready" : "blocked",
          ownerRuntimeId: null,
          assignment: null,
          outputVersion: 0,
          retryCount: 0,
          blockerCode: null,
          updatedAt: timestamp,
        })),
      context,
      messages: [],
      reviews: [],
      diagnostics: [],
      recoveryState: [],
      conflictCount: 0,
      reassignmentCount: 0,
      recoveryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    });
  }

  async get(tenantId: string, collaborationId: string): Promise<CollaborationSession | null> {
    const session = this.sessions.get(this.key(tenantId, collaborationId));
    return session ? clone(session) : null;
  }

  async registerParticipant(
    input: RegisterParticipantInput,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationSession> {
    const session = this.require(input.tenantId, input.collaborationId);
    if (!["created", "assembling", "active"].includes(session.lifecycle)) {
      this.conflict(session, "collaboration_registration_closed",
        "Collaboration does not accept participants.");
    }
    if (!input.runtimeId.trim() || !input.agentId.trim() || !input.capabilityVersion.trim() ||
        !Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new CollaborationError("invalid_collaboration_participant",
        "Participant identity or lease is invalid.");
    }
    const existing = session.participants.find((participant) =>
      participant.runtimeId === input.runtimeId);
    if (existing) {
      if (existing.agentId !== input.agentId ||
          existing.capabilityVersion !== input.capabilityVersion ||
          existing.role !== input.role) {
        this.conflict(session, "duplicate_collaboration_participant",
          "Runtime already participates with incompatible identity.");
      }
      return clone(session);
    }
    if (session.participants.length >= quotas.participants) {
      throw new CollaborationError("collaboration_participant_quota_exceeded",
        "Participant quota exceeded.");
    }
    if (input.runtimeId === session.coordinatorRuntimeId && input.role !== "coordinator" ||
        input.runtimeId !== session.coordinatorRuntimeId && input.role === "coordinator") {
      this.conflict(session, "collaboration_coordinator_conflict",
        "Coordinator role does not match the collaboration identity.");
    }
    const timestamp = now.toISOString();
    const claimToken = stableHash({
      collaborationId: session.collaborationId,
      runtimeId: input.runtimeId,
      capabilityVersion: input.capabilityVersion,
      registeredAt: timestamp,
    });
    const participant: CollaborationParticipant = {
      runtimeId: input.runtimeId,
      agentId: input.agentId,
      capabilityVersion: input.capabilityVersion,
      assignedWorkUnits: [],
      lease: {
        leaseId: stableId("collaboration_lease", {
          collaborationId: session.collaborationId,
          runtimeId: input.runtimeId,
          capabilityVersion: input.capabilityVersion,
        }),
        claimToken,
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      },
      heartbeat: null,
      role: input.role,
      status: session.lifecycle === "active" ? "active" : "registered",
      registeredAt: timestamp,
      updatedAt: timestamp,
    };
    return this.save({
      ...session,
      lifecycle: session.lifecycle === "created" ? "assembling" : session.lifecycle,
      participants: [...session.participants, participant]
        .sort((left, right) => left.runtimeId.localeCompare(right.runtimeId)),
      updatedAt: timestamp,
    });
  }

  async activate(
    tenantId: string,
    collaborationId: string,
    coordinatorRuntimeId: string,
    now = new Date(),
  ): Promise<CollaborationSession> {
    const session = this.require(tenantId, collaborationId);
    if (session.coordinatorRuntimeId !== coordinatorRuntimeId) {
      this.conflict(session, "collaboration_coordinator_conflict", "Only the coordinator may activate.");
    }
    if (!["assembling", "paused", "active"].includes(session.lifecycle) ||
        session.participants.length < 2 ||
        !session.participants.some((participant) =>
          participant.runtimeId === coordinatorRuntimeId && participant.role === "coordinator")) {
      this.conflict(session, "collaboration_activation_invalid",
        "Collaboration requires a coordinator and multiple participants.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...session,
      lifecycle: "active",
      participants: session.participants.map((participant) => ({
        ...participant,
        status: participant.status === "registered" ? "active" : participant.status,
        updatedAt: timestamp,
      })),
      updatedAt: timestamp,
    });
  }

  async heartbeat(
    claim: CollaborationParticipantClaim,
    leaseMs: number,
    now = new Date(),
  ): Promise<CollaborationParticipant> {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new CollaborationError("invalid_collaboration_lease",
        "Heartbeat lease duration is invalid.");
    }
    const { session, participant } = this.fenced(claim, now);
    const timestamp = now.toISOString();
    const latencyMs = Math.max(0, now.getTime() -
      Date.parse(participant.lease?.heartbeatAt ?? timestamp));
    const updated: CollaborationParticipant = {
      ...participant,
      lease: {
        ...participant.lease!,
        heartbeatAt: timestamp,
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      },
      heartbeat: { recordedAt: timestamp, latencyMs },
      updatedAt: timestamp,
    };
    this.save({
      ...session,
      participants: session.participants.map((candidate) =>
        candidate.runtimeId === updated.runtimeId ? updated : candidate),
      updatedAt: timestamp,
    });
    return clone(updated);
  }

  async schedule(
    tenantId: string,
    collaborationId: string,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationSession> {
    let session = this.require(tenantId, collaborationId);
    if (session.lifecycle !== "active") {
      this.conflict(session, "collaboration_not_active", "Collaboration is not active.");
    }
    if (now.getTime() - Date.parse(session.createdAt) >= quotas.durationMs) {
      throw new CollaborationError("collaboration_duration_quota_exceeded",
        "Collaboration duration quota exceeded.");
    }
    session = { ...session, workUnits: propagateCollaborationReadiness(session) };
    const assignments = deterministicCollaborationAssignments(session);
    if (session.messages.length + assignments.length > quotas.messages) {
      throw new CollaborationError("collaboration_message_count_quota_exceeded",
        "Assignments would exceed the message quota.");
    }
    for (const scheduled of assignments) {
      const timestamp = now.toISOString();
      const assignment = {
        assignmentId: scheduled.assignmentId,
        runtimeId: scheduled.participant.runtimeId,
        assignedAt: timestamp,
        attempt: scheduled.unit.retryCount + 1,
      };
      session = {
        ...session,
        workUnits: session.workUnits.map((unit) =>
          unit.workUnitId === scheduled.unit.workUnitId
            ? { ...unit, status: "assigned", ownerRuntimeId: scheduled.participant.runtimeId,
                assignment, updatedAt: timestamp }
            : unit),
        participants: session.participants.map((participant) =>
          participant.runtimeId === scheduled.participant.runtimeId
            ? { ...participant,
                assignedWorkUnits: [...participant.assignedWorkUnits, scheduled.unit.workUnitId].sort(),
                updatedAt: timestamp }
            : participant),
        updatedAt: timestamp,
      };
      const appended = this.appendMessage(session, {
        senderRuntimeId: session.coordinatorRuntimeId,
        messageType: "assignment",
        receiverRuntimeId: scheduled.participant.runtimeId,
        workUnitId: scheduled.unit.workUnitId,
        workUnitVersion: scheduled.unit.workUnitVersion,
        payload: { assignmentId: scheduled.assignmentId, attempt: assignment.attempt },
      }, quotas, now);
      session = appended.session;
    }
    return this.save(session);
  }

  async startWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    now = new Date(),
  ): Promise<CollaborationSession> {
    const { session, participant } = this.fenced(claim, now);
    const unit = this.unit(session, workUnitId, workUnitVersion);
    if (unit.ownerRuntimeId !== participant.runtimeId || unit.status !== "assigned") {
      this.conflict(session, "collaboration_assignment_conflict",
        "Participant does not own an assigned work unit.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...session,
      workUnits: session.workUnits.map((candidate) =>
        candidate.workUnitId === workUnitId
          ? { ...candidate, status: "running", updatedAt: timestamp }
          : candidate),
      updatedAt: timestamp,
    });
  }

  async completeWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationSession> {
    let { session, participant } = this.fenced(claim, now);
    const unit = this.unit(session, workUnitId, workUnitVersion);
    if (unit.ownerRuntimeId !== participant.runtimeId ||
        !["assigned", "running"].includes(unit.status)) {
      this.conflict(session, "collaboration_assignment_conflict",
        "Participant does not own the running work unit.");
    }
    if (outputVersion !== unit.outputVersion + 1) {
      this.conflict(session, "stale_collaboration_output", "Output version is stale.");
    }
    const timestamp = now.toISOString();
    const nextStatus = unit.reviewRequired ? "awaiting_review" as const : "succeeded" as const;
    session = {
      ...session,
      workUnits: session.workUnits.map((candidate) =>
        candidate.workUnitId === workUnitId
          ? { ...candidate, status: nextStatus, outputVersion, updatedAt: timestamp }
          : candidate),
      updatedAt: timestamp,
    };
    if (!unit.reviewRequired) {
      session = {
        ...session,
        participants: session.participants.map((candidate) =>
          candidate.runtimeId === participant.runtimeId
            ? { ...candidate,
                assignedWorkUnits: candidate.assignedWorkUnits.filter((id) => id !== workUnitId),
                updatedAt: timestamp }
            : candidate),
      };
    }
    const appended = this.appendMessage(session, {
      senderRuntimeId: participant.runtimeId,
      receiverRuntimeId: session.coordinatorRuntimeId,
      messageType: "completion",
      workUnitId,
      workUnitVersion,
      payload: { outputVersion, status: nextStatus },
    }, quotas, now);
    session = appended.session;
    if (!unit.reviewRequired) session = this.finishAndPropagate(session, now);
    return this.save(session);
  }

  private releaseAssignment(
    session: CollaborationSession,
    unit: CollaborationWorkUnit,
    status: "ready" | "failed",
    now: Date,
  ): CollaborationSession {
    const timestamp = now.toISOString();
    return {
      ...session,
      workUnits: session.workUnits.map((candidate) =>
        candidate.workUnitId === unit.workUnitId
          ? { ...candidate, status, ownerRuntimeId: null, assignment: null,
              retryCount: status === "ready" ? candidate.retryCount + 1 : candidate.retryCount,
              updatedAt: timestamp }
          : candidate),
      participants: session.participants.map((participant) =>
        participant.runtimeId === unit.ownerRuntimeId
          ? { ...participant,
              assignedWorkUnits: participant.assignedWorkUnits.filter((id) => id !== unit.workUnitId),
              updatedAt: timestamp }
          : participant),
      reassignmentCount: status === "ready"
        ? session.reassignmentCount + 1
        : session.reassignmentCount,
      updatedAt: timestamp,
    };
  }

  async failWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    failureCode: string,
    retryable: boolean,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationSession> {
    const { session, participant } = this.fenced(claim, now);
    const unit = this.unit(session, workUnitId, workUnitVersion);
    if (unit.ownerRuntimeId !== participant.runtimeId ||
        !["assigned", "running"].includes(unit.status)) {
      this.conflict(session, "collaboration_assignment_conflict",
        "Participant does not own the work unit.");
    }
    const retry = retryable && unit.retryCount < Math.min(quotas.retries, unit.maxAttempts - 1);
    let next = this.releaseAssignment(session, unit, retry ? "ready" : "failed", now);
    next = {
      ...next,
      workUnits: next.workUnits.map((candidate) =>
        candidate.workUnitId === workUnitId ? { ...candidate, blockerCode: failureCode } : candidate),
    };
    if (!retry) next = this.finishAndPropagate(next, now);
    return this.save(next);
  }

  async sendMessage(
    input: SendCollaborationMessageInput,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationMessage> {
    const { session } = this.fenced(input.claim, now);
    const appended = this.appendMessage(session, {
      senderRuntimeId: input.claim.runtimeId,
      messageType: input.messageType,
      receiverRuntimeId: input.receiverRuntimeId,
      workUnitId: input.workUnitId,
      workUnitVersion: input.workUnitVersion,
      payload: input.payload,
    }, quotas, now);
    this.save(appended.session);
    return clone(appended.message);
  }

  async requestReview(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationReview> {
    let { session, participant } = this.fenced(claim, now);
    const unit = this.unit(session, workUnitId, workUnitVersion);
    if (unit.ownerRuntimeId !== participant.runtimeId || unit.status !== "awaiting_review" ||
        unit.outputVersion !== outputVersion) {
      this.conflict(session, "stale_collaboration_review_request",
        "Review request is stale or not owned.");
    }
    if (session.reviews.filter((review) => review.status === "pending").length >= quotas.pendingReviews) {
      throw new CollaborationError("collaboration_review_quota_exceeded",
        "Pending review quota exceeded.");
    }
    const reviewer = deterministicReviewer(session, participant.runtimeId);
    if (!reviewer) {
      throw new CollaborationError("collaboration_reviewer_unavailable",
        "No eligible peer reviewer is available.");
    }
    const timestamp = now.toISOString();
    const review: CollaborationReview = {
      reviewId: stableId("collaboration_review", {
        collaborationId: session.collaborationId,
        workUnitVersion,
        outputVersion,
        reviewerRuntimeId: reviewer.runtimeId,
      }),
      collaborationId: session.collaborationId,
      workUnitId,
      workUnitVersion,
      requesterRuntimeId: participant.runtimeId,
      reviewerRuntimeId: reviewer.runtimeId,
      reviewedOutputVersion: outputVersion,
      verdict: null,
      findings: [],
      status: "pending",
      requestedAt: timestamp,
      timestamp: null,
    };
    if (session.reviews.some((candidate) => candidate.reviewId === review.reviewId)) {
      return clone(session.reviews.find((candidate) => candidate.reviewId === review.reviewId)!);
    }
    session = { ...session, reviews: [...session.reviews, review], updatedAt: timestamp };
    const appended = this.appendMessage(session, {
      senderRuntimeId: participant.runtimeId,
      receiverRuntimeId: reviewer.runtimeId,
      messageType: "review_request",
      workUnitId,
      workUnitVersion,
      payload: { reviewId: review.reviewId, reviewedOutputVersion: outputVersion },
    }, quotas, now);
    this.save(appended.session);
    return clone(review);
  }

  async submitReview(
    input: SubmitCollaborationReviewInput,
    quotas: CollaborationQuotas,
    now = new Date(),
  ): Promise<CollaborationReview> {
    let { session, participant } = this.fenced(input.claim, now);
    const review = session.reviews.find((candidate) => candidate.reviewId === input.reviewId);
    if (!review || review.status !== "pending" ||
        review.reviewerRuntimeId !== participant.runtimeId ||
        review.reviewedOutputVersion !== input.reviewedOutputVersion) {
      this.conflict(session, "stale_collaboration_review", "Review is stale or routed elsewhere.");
    }
    const unit = this.unit(session, review.workUnitId, review.workUnitVersion);
    if (unit.status !== "awaiting_review" ||
        unit.outputVersion !== review.reviewedOutputVersion) {
      this.conflict(session, "stale_collaboration_review", "Reviewed output version is stale.");
    }
    if (input.findings.length > quotas.findings ||
        input.findings.some((finding) => typeof finding !== "string")) {
      throw new CollaborationError("collaboration_review_findings_quota_exceeded",
        "Review findings exceed their quota.");
    }
    const timestamp = now.toISOString();
    const completed: CollaborationReview = {
      ...review,
      verdict: input.verdict,
      findings: [...input.findings],
      status: "completed",
      timestamp,
    };
    const canRetry = input.verdict !== "approved" &&
      unit.retryCount < Math.min(quotas.retries, unit.maxAttempts - 1);
    session = {
      ...session,
      reviews: session.reviews.map((candidate) =>
        candidate.reviewId === review.reviewId ? completed : candidate),
      workUnits: session.workUnits.map((candidate) =>
        candidate.workUnitId === unit.workUnitId
          ? input.verdict === "approved"
            ? { ...candidate, status: "succeeded", updatedAt: timestamp }
            : { ...candidate, status: canRetry ? "ready" : "failed",
                ownerRuntimeId: null, assignment: null,
                retryCount: canRetry ? candidate.retryCount + 1 : candidate.retryCount,
                updatedAt: timestamp }
          : candidate),
      participants: session.participants.map((candidate) =>
          candidate.runtimeId === unit.ownerRuntimeId
            ? { ...candidate,
                assignedWorkUnits: candidate.assignedWorkUnits.filter((id) => id !== unit.workUnitId),
                updatedAt: timestamp }
            : candidate),
      reassignmentCount: canRetry
        ? session.reassignmentCount + 1
        : session.reassignmentCount,
      updatedAt: timestamp,
    };
    const appended = this.appendMessage(session, {
      senderRuntimeId: participant.runtimeId,
      receiverRuntimeId: review.requesterRuntimeId,
      messageType: "review_response",
      workUnitId: review.workUnitId,
      workUnitVersion: review.workUnitVersion,
      payload: {
        reviewId: review.reviewId,
        reviewedOutputVersion: review.reviewedOutputVersion,
        verdict: input.verdict,
      },
    }, quotas, now);
    session = this.finishAndPropagate(appended.session, now);
    this.save(session);
    return clone(completed);
  }

  private finishAndPropagate(session: CollaborationSession, now: Date): CollaborationSession {
    let workUnits = propagateCollaborationReadiness(session);
    const timestamp = now.toISOString();
    const failed = workUnits.some((unit) => unit.status === "failed");
    const completed = workUnits.every((unit) => unit.status === "succeeded");
    return {
      ...session,
      workUnits,
      lifecycle: failed ? "failed" : completed ? "completed" : session.lifecycle,
      completedAt: failed || completed ? timestamp : session.completedAt,
      updatedAt: timestamp,
    };
  }

  async transition(
    tenantId: string,
    collaborationId: string,
    coordinatorRuntimeId: string,
    lifecycle: Extract<CollaborationLifecycle, "paused" | "active" | "cancelled" | "failed" | "superseded">,
    now = new Date(),
  ): Promise<CollaborationSession> {
    const session = this.require(tenantId, collaborationId);
    if (session.coordinatorRuntimeId !== coordinatorRuntimeId) {
      this.conflict(session, "collaboration_coordinator_conflict",
        "Only the coordinator may transition the collaboration.");
    }
    const allowed = new Set([
      "active:paused", "paused:active", "created:cancelled", "assembling:cancelled",
      "active:cancelled", "paused:cancelled", "active:failed", "paused:failed",
      "created:superseded", "assembling:superseded", "active:superseded", "paused:superseded",
    ]);
    if (!allowed.has(`${session.lifecycle}:${lifecycle}`)) {
      this.conflict(session, "invalid_collaboration_transition",
        `Cannot transition ${session.lifecycle} to ${lifecycle}.`);
    }
    const timestamp = now.toISOString();
    return this.save({
      ...session,
      lifecycle,
      completedAt: terminal.has(lifecycle) ? timestamp : null,
      updatedAt: timestamp,
    });
  }

  async context(claim: CollaborationParticipantClaim): Promise<CollaborationSession["context"]> {
    return clone(this.fenced(claim).session.context);
  }

  async recover(now = new Date(), quotas?: CollaborationQuotas): Promise<number> {
    let recovered = 0;
    for (const current of [...this.sessions.values()]) {
      if (terminal.has(current.lifecycle)) continue;
      let session = current;
      const timestamp = now.toISOString();
      const abandoned = new Set(session.participants.filter((participant) =>
        participant.status === "abandoned" ||
        (participant.status === "active" && participant.lease &&
          Date.parse(participant.lease.expiresAt) <= now.getTime()))
        .map((participant) => participant.runtimeId));
      if (abandoned.size > 0) {
        for (const runtimeId of abandoned) {
          const wasActive = session.participants.some((participant) =>
            participant.runtimeId === runtimeId && participant.status === "active");
          const owned = session.workUnits.filter((unit) => unit.ownerRuntimeId === runtimeId &&
            !["succeeded", "failed", "cancelled"].includes(unit.status));
          for (const unit of owned) {
            const retry = unit.retryCount < Math.min(
              quotas?.retries ?? unit.maxAttempts - 1,
              unit.maxAttempts - 1,
            );
            session = this.releaseAssignment(session, unit, retry ? "ready" : "failed", now);
            session = this.addRecovery(session,
              wasActive ? "expired_lease" : "abandoned_participant", runtimeId,
              unit.workUnitId, unit.status, retry ? "ready" : "failed", now);
            recovered += 1;
          }
          session = {
            ...session,
            participants: session.participants.map((participant) =>
              participant.runtimeId === runtimeId
                ? { ...participant, status: "abandoned", lease: null, updatedAt: timestamp }
                : participant),
          };
          if (wasActive) {
            session = this.addRecovery(session, "abandoned_participant", runtimeId,
              null, "active", "abandoned", now);
            recovered += 1;
          }
        }
      }
      for (const review of session.reviews.filter((item) =>
        item.status === "pending" && abandoned.has(item.reviewerRuntimeId))) {
        const replacement = deterministicReviewer(session, review.requesterRuntimeId);
        session = {
          ...session,
          reviews: session.reviews.map((candidate) =>
            candidate.reviewId === review.reviewId
              ? replacement
                ? { ...candidate, reviewerRuntimeId: replacement.runtimeId }
                : { ...candidate, status: "cancelled" }
              : candidate),
        };
        session = this.addRecovery(session, "pending_review", review.reviewerRuntimeId,
          review.workUnitId, "pending", replacement ? "pending" : "cancelled", now);
        recovered += 1;
      }
      const participantIds = new Set(session.participants.map((participant) => participant.runtimeId));
      const orphanIds = new Set(session.messages.filter((message) =>
        !participantIds.has(message.senderRuntimeId) ||
        !participantIds.has(message.receiverRuntimeId)).map((message) => message.messageId));
      if (orphanIds.size > 0) {
        session = {
          ...session,
          messages: session.messages.map((message) =>
            orphanIds.has(message.messageId) ? { ...message, orphaned: true } : message),
        };
        for (const messageId of orphanIds) {
          session = this.addRecovery(session, "orphan_message", null,
            null, "attached", "orphaned", now, { messageId });
          recovered += 1;
        }
      }
      if (session.lifecycle === "active" &&
          !session.participants.some((participant) => participant.status === "active")) {
        session = { ...session, lifecycle: "paused", updatedAt: timestamp };
        session = this.addRecovery(session, "interrupted_session", null,
          null, "active", "paused", now);
        recovered += 1;
      }
      this.save(this.finishAndPropagate(session, now));
    }
    return recovered;
  }

  private addRecovery(
    session: CollaborationSession,
    reason: CollaborationRecoveryRecord["reason"],
    participantRuntimeId: string | null,
    workUnitId: string | null,
    previousState: string,
    recoveredState: string,
    now: Date,
    details: Readonly<Record<string, unknown>> = {},
  ): CollaborationSession {
    const timestamp = now.toISOString();
    const recovery: CollaborationRecoveryRecord = {
      recoveryId: stableId("collaboration_recovery", {
        collaborationId: session.collaborationId,
        reason,
        participantRuntimeId,
        workUnitId,
        sequence: session.recoveryState.length + 1,
      }),
      reason,
      participantRuntimeId,
      workUnitId,
      previousState,
      recoveredState,
      timestamp,
    };
    const diagnostic: CollaborationDiagnostic = {
      diagnosticId: stableId("collaboration_diagnostic", {
        collaborationId: session.collaborationId,
        recoveryId: recovery.recoveryId,
      }),
      code: `collaboration_recovery_${reason}`,
      message: "Collaboration recovery action recorded.",
      retryable: recoveredState === "ready" || recoveredState === "pending",
      details: { ...details, participantRuntimeId, workUnitId, previousState, recoveredState },
      timestamp,
    };
    return {
      ...session,
      recoveryState: [...session.recoveryState, recovery],
      diagnostics: [...session.diagnostics, diagnostic],
      recoveryCount: session.recoveryCount + 1,
      updatedAt: timestamp,
    };
  }

  async metrics(tenantId?: string): Promise<CollaborationMetrics> {
    const sessions = [...this.sessions.values()].filter((session) =>
      tenantId === undefined || session.tenantId === tenantId);
    return sessions.reduce<CollaborationMetrics>((metrics, session) => ({
      activeCollaborations: metrics.activeCollaborations +
        (["assembling", "active", "paused"].includes(session.lifecycle) ? 1 : 0),
      participants: metrics.participants + session.participants.length,
      messages: metrics.messages + session.messages.length,
      reviews: metrics.reviews + session.reviews.length,
      conflicts: metrics.conflicts + session.conflictCount,
      reassignmentCount: metrics.reassignmentCount + session.reassignmentCount,
      recoveryCount: metrics.recoveryCount + session.recoveryCount,
      completionLatencyMs: metrics.completionLatencyMs +
        (session.completedAt
          ? Math.max(0, Date.parse(session.completedAt) - Date.parse(session.createdAt))
          : 0),
    }), emptyMetrics());
  }

  async collect(tenantId: string, retentionCount: number): Promise<number> {
    const candidates = [...this.sessions.entries()].filter(([, session]) =>
      session.tenantId === tenantId && terminal.has(session.lifecycle))
      .sort((left, right) => right[1].createdAt.localeCompare(left[1].createdAt) ||
        right[1].collaborationId.localeCompare(left[1].collaborationId));
    let removed = 0;
    for (const [key] of candidates.slice(Math.max(1, retentionCount))) {
      this.sessions.delete(key);
      removed += 1;
    }
    return removed;
  }

  async verify(): Promise<void> {
    for (const session of this.sessions.values()) {
      validateCollaborationContext(session);
      validateCollaborationWorkUnits(session.workUnits);
      const participantIds = new Set(session.participants.map((participant) => participant.runtimeId));
      const assignedOwners = new Map<string, string>();
      let invalidOwnership = false;
      for (const participant of session.participants) {
        for (const workUnitId of participant.assignedWorkUnits) {
          const previous = assignedOwners.get(workUnitId);
          if (previous && previous !== participant.runtimeId) invalidOwnership = true;
          assignedOwners.set(workUnitId, participant.runtimeId);
        }
      }
      if (participantIds.size !== session.participants.length ||
          session.participants.some((participant) =>
            !participant.agentId.trim() || !participant.capabilityVersion.trim()) ||
          session.workUnits.some((unit) =>
            unit.ownerRuntimeId !== null &&
            (!participantIds.has(unit.ownerRuntimeId) ||
              (["assigned", "running", "awaiting_review"].includes(unit.status) &&
                assignedOwners.get(unit.workUnitId) !== unit.ownerRuntimeId))) ||
          invalidOwnership) {
        throw new CollaborationError("collaboration_startup_validation_failed",
          "Participant ownership integrity is invalid.");
      }
      for (const message of session.messages) {
        const unit = session.workUnits.find((candidate) =>
          candidate.workUnitId === message.workUnitId);
        if (message.executionVersion !== session.executionVersion ||
            unit?.workUnitVersion !== message.workUnitVersion ||
            stableHash(message.payload) !== message.payloadHash) {
          throw new CollaborationError("collaboration_startup_validation_failed",
            "Message version or payload integrity is invalid.");
        }
      }
      for (const review of session.reviews) {
        const unit = session.workUnits.find((candidate) =>
          candidate.workUnitId === review.workUnitId);
        if (!unit || unit.workUnitVersion !== review.workUnitVersion ||
            review.reviewedOutputVersion > unit.outputVersion) {
          throw new CollaborationError("collaboration_startup_validation_failed",
            "Review output fencing is invalid.");
        }
      }
    }
  }
}

interface RpcQuery extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {}
interface DatabaseClient { rpc(name: string, parameters?: Record<string, unknown>): RpcQuery }

function first(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : undefined;
}

export class PostgresCollaborationStore implements CollaborationStore {
  constructor(private readonly client: DatabaseClient) {}

  private async call(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code = error.message?.match(/collaboration_[a-z_]+/u)?.[0] ??
        "collaboration_persistence_failed";
      throw new CollaborationError(code, error.message ?? "Collaboration persistence failed.");
    }
    return data;
  }

  private async load(tenantId: string, collaborationId: string): Promise<CollaborationSession | null> {
    const data = await this.call("get_collaboration", {
      input_tenant_id: tenantId,
      input_collaboration_id: collaborationId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.collaboration ?? data) as CollaborationSession);
  }

  private async persist(
    session: CollaborationSession,
    expectedUpdatedAt: string | null,
  ): Promise<CollaborationSession> {
    const data = await this.call("save_collaboration_state", {
      input_collaboration: session,
      input_expected_updated_at: expectedUpdatedAt,
    });
    return clone((first(data)?.collaboration ?? data) as CollaborationSession);
  }

  private async mutate<T>(
    tenantId: string,
    collaborationId: string,
    operation: (memory: MemoryCollaborationStore) => Promise<T>,
  ): Promise<{ value: T; session: CollaborationSession }> {
    const existing = await this.load(tenantId, collaborationId);
    if (!existing) throw new CollaborationError("collaboration_not_found", "Collaboration was not found.");
    const memory = new MemoryCollaborationStore();
    memory.hydrate(existing);
    try {
      const value = await operation(memory);
      const updated = await memory.get(tenantId, collaborationId);
      if (!updated) throw new CollaborationError("collaboration_not_found", "Collaboration was not found.");
      const persisted = await this.persist(updated, existing.updatedAt);
      return { value, session: persisted };
    } catch (error) {
      if (error instanceof CollaborationError &&
          error.details.collaborationId === collaborationId) {
        await this.call("record_collaboration_conflict", {
          input_tenant_id: tenantId,
          input_collaboration_id: collaborationId,
          input_code: error.code,
          input_message: error.message,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  async create(input: CreateCollaborationInput, quotas: CollaborationQuotas, now?: Date) {
    const existingId = collaborationIdentity(input);
    const existing = await this.load(input.tenantId, existingId);
    const memory = new MemoryCollaborationStore();
    if (existing) memory.hydrate(existing);
    try {
      const session = await memory.create(input, quotas, now);
      return this.persist(session, existing?.updatedAt ?? null);
    } catch (error) {
      if (existing && error instanceof CollaborationError &&
          error.details.collaborationId === existingId) {
        await this.call("record_collaboration_conflict", {
          input_tenant_id: input.tenantId,
          input_collaboration_id: existingId,
          input_code: error.code,
          input_message: error.message,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  async get(tenantId: string, collaborationId: string) {
    return this.load(tenantId, collaborationId);
  }

  async registerParticipant(input: RegisterParticipantInput, quotas: CollaborationQuotas, now?: Date) {
    return (await this.mutate(input.tenantId, input.collaborationId,
      (memory) => memory.registerParticipant(input, quotas, now))).session;
  }

  async activate(tenantId: string, collaborationId: string, coordinatorRuntimeId: string, now?: Date) {
    return (await this.mutate(tenantId, collaborationId,
      (memory) => memory.activate(tenantId, collaborationId, coordinatorRuntimeId, now))).session;
  }

  async heartbeat(claim: CollaborationParticipantClaim, leaseMs: number, now?: Date) {
    const result = await this.mutate(claim.tenantId, claim.collaborationId,
      (memory) => memory.heartbeat(claim, leaseMs, now));
    return result.session.participants.find((participant) =>
      participant.runtimeId === claim.runtimeId)!;
  }

  async schedule(tenantId: string, collaborationId: string, quotas: CollaborationQuotas, now?: Date) {
    return (await this.mutate(tenantId, collaborationId,
      (memory) => memory.schedule(tenantId, collaborationId, quotas, now))).session;
  }

  async startWork(claim: CollaborationParticipantClaim, workUnitId: string, workUnitVersion: string, now?: Date) {
    return (await this.mutate(claim.tenantId, claim.collaborationId,
      (memory) => memory.startWork(claim, workUnitId, workUnitVersion, now))).session;
  }

  async completeWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
    quotas: CollaborationQuotas,
    now?: Date,
  ) {
    return (await this.mutate(claim.tenantId, claim.collaborationId,
      (memory) => memory.completeWork(
        claim, workUnitId, workUnitVersion, outputVersion, quotas, now,
      ))).session;
  }

  async failWork(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    failureCode: string,
    retryable: boolean,
    quotas: CollaborationQuotas,
    now?: Date,
  ) {
    return (await this.mutate(claim.tenantId, claim.collaborationId,
      (memory) => memory.failWork(
        claim, workUnitId, workUnitVersion, failureCode, retryable, quotas, now,
      ))).session;
  }

  async sendMessage(input: SendCollaborationMessageInput, quotas: CollaborationQuotas, now?: Date) {
    const result = await this.mutate(input.claim.tenantId, input.claim.collaborationId,
      (memory) => memory.sendMessage(input, quotas, now));
    return result.session.messages.find((message) =>
      message.messageId === (result.value as CollaborationMessage).messageId)!;
  }

  async requestReview(
    claim: CollaborationParticipantClaim,
    workUnitId: string,
    workUnitVersion: string,
    outputVersion: number,
    quotas: CollaborationQuotas,
    now?: Date,
  ) {
    const result = await this.mutate(claim.tenantId, claim.collaborationId,
      (memory) => memory.requestReview(
        claim, workUnitId, workUnitVersion, outputVersion, quotas, now,
      ));
    return result.session.reviews.find((review) =>
      review.reviewId === (result.value as CollaborationReview).reviewId)!;
  }

  async submitReview(input: SubmitCollaborationReviewInput, quotas: CollaborationQuotas, now?: Date) {
    const result = await this.mutate(input.claim.tenantId, input.claim.collaborationId,
      (memory) => memory.submitReview(input, quotas, now));
    return result.session.reviews.find((review) => review.reviewId === input.reviewId)!;
  }

  async transition(
    tenantId: string,
    collaborationId: string,
    coordinatorRuntimeId: string,
    lifecycle: Extract<CollaborationLifecycle, "paused" | "active" | "cancelled" | "failed" | "superseded">,
    now?: Date,
  ) {
    return (await this.mutate(tenantId, collaborationId,
      (memory) => memory.transition(
        tenantId, collaborationId, coordinatorRuntimeId, lifecycle, now,
      ))).session;
  }

  async context(claim: CollaborationParticipantClaim) {
    const session = await this.load(claim.tenantId, claim.collaborationId);
    if (!session) throw new CollaborationError("collaboration_not_found", "Collaboration was not found.");
    const memory = new MemoryCollaborationStore();
    memory.hydrate(session);
    return memory.context(claim);
  }

  async recover(now = new Date(), quotas?: CollaborationQuotas) {
    const data = await this.call("list_recoverable_collaborations");
    const sessions = (first(data)?.collaborations ?? data ?? []) as CollaborationSession[];
    let recovered = 0;
    for (const session of sessions) {
      const memory = new MemoryCollaborationStore();
      memory.hydrate(session);
      const count = await memory.recover(now, quotas);
      const updated = await memory.get(session.tenantId, session.collaborationId);
      if (updated && count > 0) await this.persist(updated, session.updatedAt);
      recovered += count;
    }
    return recovered;
  }

  async metrics(tenantId?: string) {
    const data = await this.call("collaboration_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone((first(data)?.metrics ?? data) as CollaborationMetrics);
  }

  async collect(tenantId: string, retentionCount: number) {
    const data = await this.call("collect_collaborations", {
      input_tenant_id: tenantId,
      input_retention_count: retentionCount,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async verify() {
    const data = await this.call("verify_collaboration_contract", {
      input_engine_version: COLLABORATION_ENGINE_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new CollaborationError("collaboration_startup_validation_failed",
        "Collaboration database contract is invalid.", { problems: row.problems ?? [] });
    }
  }
}

export const runtimeCollaborationStore: CollaborationStore =
  new PostgresCollaborationStore(supabase as unknown as SupabaseClient);
