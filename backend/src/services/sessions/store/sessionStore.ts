import type { Message, Session } from "../types.js";
import type { MaybePromise } from "../../../lib/maybePromise.js";

export interface SessionStore {
  createSession(session: Session): MaybePromise<Session>;
  getSession(id: string): MaybePromise<Session | null>;
  listSessions(): MaybePromise<Session[]>;
  updateSession(session: Session): MaybePromise<Session>;
  deleteSession(id: string): MaybePromise<boolean>;
  appendMessage(sessionId: string, message: Message, updatedAt: string): MaybePromise<Session | null>;
  clear(): MaybePromise<void>;
}
