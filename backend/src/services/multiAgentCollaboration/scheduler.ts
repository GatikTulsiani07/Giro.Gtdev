import { stableId } from "../repositoryExecution/determinism.js";
import type {
  CollaborationParticipant,
  CollaborationSession,
  CollaborationWorkUnit,
} from "./types.js";

function participantEligible(
  participant: CollaborationParticipant,
  unit: CollaborationWorkUnit,
): boolean {
  return participant.status === "active" &&
    participant.role !== "observer" &&
    (unit.eligibleAgentIds.length === 0 || unit.eligibleAgentIds.includes(participant.agentId)) &&
    (unit.eligibleRoles.length === 0 || unit.eligibleRoles.includes(participant.role));
}

export function propagateCollaborationReadiness(
  session: CollaborationSession,
): CollaborationWorkUnit[] {
  const states = new Map(session.workUnits.map((unit) => [unit.workUnitId, unit.status]));
  return session.workUnits.map((unit) => {
    if (!["blocked", "ready"].includes(unit.status)) return unit;
    const prerequisites = unit.prerequisites.map((id) => states.get(id));
    const downstreamFailure = prerequisites.some((status) =>
      status === "failed" || status === "cancelled");
    const satisfied = prerequisites.every((status) => status === "succeeded");
    return {
      ...unit,
      status: downstreamFailure ? "blocked" as const
        : satisfied ? "ready" as const
        : "blocked" as const,
      blockerCode: downstreamFailure ? "upstream_failed" : null,
    };
  });
}

export interface ScheduledCollaborationAssignment {
  readonly unit: CollaborationWorkUnit;
  readonly participant: CollaborationParticipant;
  readonly assignmentId: string;
}

export function deterministicCollaborationAssignments(
  session: CollaborationSession,
): readonly ScheduledCollaborationAssignment[] {
  const available = session.participants.filter((participant) =>
    participant.status === "active" && participant.role !== "observer");
  const load = new Map(available.map((participant) => [
    participant.runtimeId,
    participant.assignedWorkUnits.length,
  ]));
  const assignments: ScheduledCollaborationAssignment[] = [];
  const ready = propagateCollaborationReadiness(session)
    .filter((unit) => unit.status === "ready" && !unit.ownerRuntimeId)
    .sort((left, right) => left.order - right.order ||
      left.workUnitId.localeCompare(right.workUnitId));
  for (const unit of ready) {
    const participant = available.filter((candidate) => participantEligible(candidate, unit))
      .sort((left, right) =>
        (load.get(left.runtimeId) ?? 0) - (load.get(right.runtimeId) ?? 0) ||
        left.role.localeCompare(right.role) ||
        left.runtimeId.localeCompare(right.runtimeId))[0];
    if (!participant) continue;
    const attempt = unit.retryCount + 1;
    assignments.push({
      unit,
      participant,
      assignmentId: stableId("collaboration_assignment", {
        collaborationId: session.collaborationId,
        executionVersion: session.executionVersion,
        workUnitVersion: unit.workUnitVersion,
        runtimeId: participant.runtimeId,
        capabilityVersion: participant.capabilityVersion,
        attempt,
      }),
    });
    load.set(participant.runtimeId, (load.get(participant.runtimeId) ?? 0) + 1);
  }
  return Object.freeze(assignments);
}

export function deterministicReviewer(
  session: CollaborationSession,
  requesterRuntimeId: string,
): CollaborationParticipant | null {
  const pendingByReviewer = new Map<string, number>();
  for (const review of session.reviews.filter((item) => item.status === "pending")) {
    pendingByReviewer.set(review.reviewerRuntimeId,
      (pendingByReviewer.get(review.reviewerRuntimeId) ?? 0) + 1);
  }
  return session.participants.filter((participant) =>
    participant.status === "active" &&
    participant.runtimeId !== requesterRuntimeId &&
    (participant.role === "reviewer" || participant.role === "coordinator"))
    .sort((left, right) =>
      (pendingByReviewer.get(left.runtimeId) ?? 0) -
        (pendingByReviewer.get(right.runtimeId) ?? 0) ||
      (left.role === "reviewer" ? 0 : 1) - (right.role === "reviewer" ? 0 : 1) ||
      left.runtimeId.localeCompare(right.runtimeId))[0] ?? null;
}
