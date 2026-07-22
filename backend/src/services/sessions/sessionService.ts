// Session business logic. Owns mutation rules; delegates persistence to SessionStore.

import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { flatMapMaybePromise, mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import { sessionStore } from "./store.js";
import type { SessionStore } from "./store/sessionStore.js";
import type {
  AddMessageInput,
  CreateSessionInput,
  Message,
  SelectedContextChunk,
  Session,
  SessionSummary,
  SessionListCursor,
  SessionSummaryPage,
} from "./types.js";
import type { CommitSessionTurnInput, CommitSessionTurnResult, SessionTurnLookupInput } from "./sessionTurn.js";

function nowIso(): string {
  return new Date().toISOString();
}

const store: SessionStore = sessionStore;

export function createNewSession(input: CreateSessionInput): Session;
export function createNewSession(input: CreateSessionInput): MaybePromise<Session> {
  const timestamp = nowIso();
  const session: Session = {
    id: randomUUID(),
    userId: input.userId,
    owner: input.owner,
    repo: input.repo,
    title: input.title ?? `${input.owner}/${input.repo} session`,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    selectedContext: [],
  };

  return mapMaybePromise(store.createSession(session), (created) => {
    logger.info("session_created", {
      sessionId: created.id,
      repository: `${input.owner}/${input.repo}`,
    });
    return created;
  });
}

export function getSessionById(id: string): Session | null;
export function getSessionById(id: string): MaybePromise<Session | null> {
  return store.getSession(id);
}

export function getSessionByIdForOwner(id: string, ownerUserId: string): MaybePromise<Session | null> {
  return store.getSessionForOwner(id, ownerUserId);
}

export function getSessionSummaryById(id: string): MaybePromise<SessionSummary | null> {
  return store.getSessionSummary(id);
}

export function listUserSessionSummaries(input: {
  ownerUserId: string;
  cursor?: SessionListCursor;
  limit: number;
}): MaybePromise<SessionSummaryPage> {
  return store.listSessionSummaries(input);
}

export function listAllSessions(): SessionSummary[];
export function listAllSessions(): MaybePromise<SessionSummary[]> {
  return store.listAllSessionSummaries();
}

export function addMessageToSession(
  sessionId: string,
  input: AddMessageInput,
): Session | null;
export function addMessageToSession(
  sessionId: string,
  input: AddMessageInput,
): MaybePromise<Session | null> {
  return flatMapMaybePromise(store.getSession(sessionId), (session) => {
    if (!session) return null;

    const message = createSessionMessage(input);

    return mapMaybePromise(store.appendMessage(sessionId, message, nowIso()), (saved) => {
      if (!saved) return null;
      logger.info("session_message_added", {
        sessionId,
        messageId: message.id,
        role: message.role,
      });
      return saved;
    });
  });
}

export function createSessionMessage(input: AddMessageInput, createdAt = nowIso()): Message {
  return {
    id: randomUUID(),
    role: input.role,
    content: input.content,
    citations: input.citations ?? [],
    evidence: input.evidence ? [...input.evidence] : undefined,
    retrievalMetadata: input.retrievalMetadata
      ? {
          ...input.retrievalMetadata,
          sourceCounts: { ...input.retrievalMetadata.sourceCounts },
          confidence: input.retrievalMetadata.confidence
            ? {
                ...input.retrievalMetadata.confidence,
                reasons: [...input.retrievalMetadata.confidence.reasons],
              }
            : undefined,
        }
      : undefined,
    createdAt,
  };
}

export function getSessionTurnResult(input: SessionTurnLookupInput): Promise<CommitSessionTurnResult | null> {
  return store.getSessionTurnResult(input);
}

export function commitSessionTurn(input: CommitSessionTurnInput): Promise<CommitSessionTurnResult> {
  return store.commitSessionTurn(input);
}

export function replaceSelectedContext(
  sessionId: string,
  chunks: SelectedContextChunk[],
): Session | null;
export function replaceSelectedContext(
  sessionId: string,
  chunks: SelectedContextChunk[],
): MaybePromise<Session | null> {
  return flatMapMaybePromise(store.getSession(sessionId), (session) => {
    if (!session) return null;

    const updated: Session = {
      ...session,
      selectedContext: [...chunks],
      updatedAt: nowIso(),
    };

    return mapMaybePromise(store.updateSession(updated), (saved) => {
      logger.info("selected_context_updated", {
        sessionId,
        chunkCount: chunks.length,
      });
      return saved;
    });
  });
}

export function removeSession(id: string): boolean;
export function removeSession(id: string): MaybePromise<boolean> {
  return store.deleteSession(id);
}
