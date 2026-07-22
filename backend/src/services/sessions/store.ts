// Session storage compatibility API. The persistence boundary is the
// SessionStore interface; this module preserves the historical synchronous
// function surface used by routes and tests.

import { MemorySessionStore } from "./store/memorySessionStore.js";
import { SupabaseSessionStore } from "./store/supabaseSessionStore.js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import type { MaybePromise } from "../../lib/maybePromise.js";
import type { SessionStore } from "./store/sessionStore.js";
import type { Message, Session, SessionListCursor } from "./types.js";

export const sessionStore: SessionStore = env.NODE_ENV === "test"
  ? new MemorySessionStore()
  : new SupabaseSessionStore(supabase);

export function createSession(session: Session): MaybePromise<Session> {
  return sessionStore.createSession(session);
}

export function getSession(id: string): MaybePromise<Session | null> {
  return sessionStore.getSession(id);
}

export function getSessionForOwner(id: string, ownerUserId: string) {
  return sessionStore.getSessionForOwner(id, ownerUserId);
}

export function listSessionSummaries(input: { ownerUserId: string; cursor?: SessionListCursor; limit: number }) {
  return sessionStore.listSessionSummaries(input);
}

export function listSessions(): MaybePromise<Session[]> {
  return sessionStore.listSessions();
}

export function updateSession(session: Session): MaybePromise<Session> {
  return sessionStore.updateSession(session);
}

export function deleteSession(id: string): MaybePromise<boolean> {
  return sessionStore.deleteSession(id);
}

export function appendMessage(
  sessionId: string,
  message: Message,
  updatedAt: string,
): MaybePromise<Session | null> {
  return sessionStore.appendMessage(sessionId, message, updatedAt);
}

export function clearAllSessions(): MaybePromise<void> {
  return sessionStore.clear();
}
