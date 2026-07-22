import type { Message, Session, SessionListCursor, SessionSummary, SessionSummaryPage } from "../types.js";
import type { MaybePromise } from "../../../lib/maybePromise.js";
import type {
  CommitSessionTurnInput,
  CommitSessionTurnResult,
  SessionTurnLookupInput,
} from "../sessionTurn.js";

export interface SessionStore {
  createSession(session: Session): MaybePromise<Session>;
  getSession(id: string): MaybePromise<Session | null>;
  getSessionForOwner(id: string, ownerUserId: string): MaybePromise<Session | null>;
  getSessionSummary(id: string): MaybePromise<SessionSummary | null>;
  listSessions(): MaybePromise<Session[]>;
  listAllSessionSummaries(): MaybePromise<SessionSummary[]>;
  listSessionSummaries(input: {
    ownerUserId: string;
    cursor?: SessionListCursor;
    limit: number;
  }): MaybePromise<SessionSummaryPage>;
  updateSession(session: Session): MaybePromise<Session>;
  deleteSession(id: string): MaybePromise<boolean>;
  appendMessage(sessionId: string, message: Message, updatedAt: string): MaybePromise<Session | null>;
  getSessionTurnResult(input: SessionTurnLookupInput): Promise<CommitSessionTurnResult | null>;
  commitSessionTurn(input: CommitSessionTurnInput): Promise<CommitSessionTurnResult>;
  cleanupExpiredTurnIdempotency(signal?: AbortSignal): Promise<number>;
  verifyTurnPersistence(signal?: AbortSignal): Promise<void>;
  clear(): MaybePromise<void>;
}
