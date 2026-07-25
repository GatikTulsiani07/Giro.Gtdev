import { Buffer } from "node:buffer";

import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  CollaborationContext,
  CollaborationMessageType,
  CollaborationQuotas,
  CollaborationSession,
  CollaborationWorkUnitDefinition,
  CreateCollaborationInput,
} from "./types.js";
import { CollaborationError } from "./types.js";

export function immutableCollaborationClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
}

export function validateCollaborationContext(
  input: Pick<CreateCollaborationInput,
    "tenantId" | "executionId" | "executionVersion" | "repositoryId"
    | "repositoryRevision" | "planVersion" | "context">,
): CollaborationContext {
  const artifacts = Object.values(input.context);
  if (artifacts.some((artifact) => artifact.published !== true || !artifact.version.trim())) {
    throw new CollaborationError("unpublished_collaboration_context",
      "Only immutable published artifacts may be shared.");
  }
  if (artifacts.some((artifact) =>
    artifact.tenantId !== input.tenantId ||
    artifact.repositoryId !== input.repositoryId ||
    artifact.repositoryRevision !== input.repositoryRevision)) {
    throw new CollaborationError("collaboration_context_scope_conflict",
      "Collaboration context contains cross-tenant or conflicting revision artifacts.");
  }
  const metadata = input.context.executionMetadata.payload;
  if (metadata.executionId !== input.executionId ||
      metadata.executionVersion !== input.executionVersion ||
      metadata.planVersion !== input.planVersion) {
    throw new CollaborationError("collaboration_execution_fence_conflict",
      "Published execution metadata does not match the collaboration.");
  }
  return immutableCollaborationClone(input.context);
}

export function validateCollaborationWorkUnits(
  units: readonly CollaborationWorkUnitDefinition[],
): void {
  if (units.length === 0) {
    throw new CollaborationError("collaboration_work_units_empty",
      "A collaboration requires at least one work unit.");
  }
  const ids = new Set<string>();
  for (const unit of units) {
    if (!unit.workUnitId.trim() || !unit.workUnitVersion.trim() ||
        !Number.isInteger(unit.order) || unit.order < 0 ||
        !Number.isInteger(unit.maxAttempts) || unit.maxAttempts <= 0) {
      throw new CollaborationError("invalid_collaboration_work_unit",
        "Work-unit identity or limits are invalid.");
    }
    if (ids.has(unit.workUnitId)) {
      throw new CollaborationError("duplicate_collaboration_work_unit",
        "Duplicate collaboration work-unit ID.");
    }
    ids.add(unit.workUnitId);
  }
  const byId = new Map(units.map((unit) => [unit.workUnitId, unit]));
  for (const unit of units) {
    if (unit.prerequisites.includes(unit.workUnitId) ||
        unit.prerequisites.some((id) => !byId.has(id))) {
      throw new CollaborationError("invalid_collaboration_dependency",
        "Work-unit dependency is missing or self-referential.");
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) {
      throw new CollaborationError("invalid_collaboration_dependency",
        "Collaboration work-unit graph is cyclic.");
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)?.prerequisites ?? []) visit(dependency);
    active.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

const messageRequiredFields: Readonly<Record<CollaborationMessageType, readonly string[]>> = {
  assignment: ["assignmentId", "attempt"],
  progress: ["status", "percentage"],
  question: ["question", "questionId"],
  answer: ["answer", "questionId"],
  review_request: ["reviewId", "reviewedOutputVersion"],
  review_response: ["reviewId", "reviewedOutputVersion", "verdict"],
  blocker: ["code", "reason"],
  completion: ["outputVersion", "status"],
  diagnostic: ["code", "message"],
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function validateMessageFieldTypes(
  messageType: CollaborationMessageType,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  switch (messageType) {
    case "assignment":
      return isNonEmptyString(payload.assignmentId) && isVersion(payload.attempt);
    case "progress":
      return isNonEmptyString(payload.status) &&
        typeof payload.percentage === "number" &&
        Number.isFinite(payload.percentage) &&
        payload.percentage >= 0 && payload.percentage <= 100;
    case "question":
      return isNonEmptyString(payload.question) && isNonEmptyString(payload.questionId);
    case "answer":
      return isNonEmptyString(payload.answer) && isNonEmptyString(payload.questionId);
    case "review_request":
      return isNonEmptyString(payload.reviewId) &&
        isVersion(payload.reviewedOutputVersion);
    case "review_response":
      return isNonEmptyString(payload.reviewId) &&
        isVersion(payload.reviewedOutputVersion) &&
        ["approved", "changes_requested", "rejected"].includes(String(payload.verdict));
    case "blocker":
      return isNonEmptyString(payload.code) && isNonEmptyString(payload.reason);
    case "completion":
      return isVersion(payload.outputVersion) &&
        ["awaiting_review", "succeeded"].includes(String(payload.status));
    case "diagnostic":
      return isNonEmptyString(payload.code) && isNonEmptyString(payload.message);
  }
}

export function validateMessagePayload(
  messageType: CollaborationMessageType,
  payload: Readonly<Record<string, unknown>>,
  quotas: CollaborationQuotas,
): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      messageRequiredFields[messageType].some((field) => !(field in payload)) ||
      !validateMessageFieldTypes(messageType, payload)) {
    throw new CollaborationError("invalid_collaboration_message",
      `Structured ${messageType} payload does not match its schema.`);
  }
  let serialized: string;
  const validateJson = (value: unknown, path: string): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => validateJson(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object" &&
        Object.getPrototypeOf(value) === Object.prototype) {
      for (const [key, item] of Object.entries(value)) validateJson(item, `${path}.${key}`);
      return;
    }
    throw new CollaborationError("collaboration_message_serialization_failed",
      `Collaboration message contains a non-JSON value at ${path}.`);
  };
  validateJson(payload, "$");
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new CollaborationError("collaboration_message_serialization_failed",
      "Collaboration message payload is not serializable.");
  }
  if (Buffer.byteLength(serialized) > quotas.messageBytes) {
    throw new CollaborationError("collaboration_message_quota_exceeded",
      "Collaboration message exceeds its byte quota.");
  }
}

export function collaborationIdentity(input: CreateCollaborationInput): string {
  return stableId("collaboration", {
    tenantId: input.tenantId,
    executionId: input.executionId,
    executionVersion: input.executionVersion,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    planVersion: input.planVersion,
  });
}

export function collaborationIntegrityHash(session: CollaborationSession): string {
  return stableHash({
    collaborationId: session.collaborationId,
    executionVersion: session.executionVersion,
    repositoryRevision: session.repositoryRevision,
    planVersion: session.planVersion,
    coordinatorRuntimeId: session.coordinatorRuntimeId,
    workUnits: session.workUnits.map((unit) => ({
      workUnitId: unit.workUnitId,
      workUnitVersion: unit.workUnitVersion,
      prerequisites: unit.prerequisites,
    })),
  });
}
