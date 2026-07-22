import { createHash } from "node:crypto";
import type { Message, SelectedContextChunk } from "./types.js";

export interface SessionTurnLookupInput {
  sessionId: string;
  ownerUserId: string;
  idempotencyKey: string;
  payloadHash: string;
  signal?: AbortSignal;
}

export interface CommitSessionTurnInput extends SessionTurnLookupInput {
  userMessage: Message;
  assistantMessage: Message;
  selectedContext: SelectedContextChunk[];
  response: unknown;
  updatedAt: string;
  expectedVersion?: number;
}

export interface CommitSessionTurnResult {
  response: unknown;
  replayed: boolean;
}

export class SessionTurnIdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";
  constructor() {
    super("The idempotency key was already used with a different session turn payload.");
    this.name = "SessionTurnIdempotencyConflictError";
  }
}

export class SessionTurnConcurrencyError extends Error {
  readonly code = "session_concurrency_conflict";
  constructor() {
    super("The session changed before the turn could be committed.");
    this.name = "SessionTurnConcurrencyError";
  }
}

export function sessionTurnPayloadHash(input: {
  sessionId: string;
  ownerUserId: string;
  question: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
