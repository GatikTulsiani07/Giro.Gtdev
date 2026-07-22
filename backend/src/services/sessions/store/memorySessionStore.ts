import type { Message, Session } from "../types.js";
import type { SessionStore } from "./sessionStore.js";
import { env } from "../../../config/env.js";
import type { SessionListCursor, SessionSummary } from "../types.js";
import {
  SessionTurnConcurrencyError,
  SessionTurnIdempotencyConflictError,
  type CommitSessionTurnInput,
  type CommitSessionTurnResult,
  type SessionTurnLookupInput,
} from "../sessionTurn.js";

function cloneMessage(message: Message): Message {
  return {
    ...message,
    citations: message.citations.map((citation) => ({ ...citation })),
    evidence: message.evidence?.map((chunk) => ({
      ...chunk,
      signals: chunk.signals ? { ...chunk.signals } : undefined,
    })),
    retrievalMetadata: message.retrievalMetadata
      ? {
          ...message.retrievalMetadata,
          sourceCounts: { ...message.retrievalMetadata.sourceCounts },
          confidence: message.retrievalMetadata.confidence
            ? {
                ...message.retrievalMetadata.confidence,
                reasons: [...message.retrievalMetadata.confidence.reasons],
              }
            : undefined,
        }
      : undefined,
  };
}

function cloneSession(session: Session): Session {
  return {
    ...session,
    messages: session.messages.map(cloneMessage),
    selectedContext: session.selectedContext.map((chunk) => ({
      ...chunk,
      signals: chunk.signals ? { ...chunk.signals } : undefined,
    })),
  };
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly versions = new Map<string, number>();
  private readonly turnRecords = new Map<string, {
    payloadHash: string;
    response: unknown;
    expiresAt: number;
  }>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly options: {
    now?: () => number;
    retentionMs?: number;
    beforeTurnCommit?: () => void | Promise<void>;
  } = {}) {}

  createSession(session: Session): Session {
    this.sessions.set(session.id, cloneSession(session));
    this.versions.set(session.id, 1);
    return cloneSession(session);
  }

  getSession(id: string): Session | null {
    const found = this.sessions.get(id);
    return found ? cloneSession(found) : null;
  }

  getSessionForOwner(id: string, ownerUserId: string): Session | null {
    const found = this.sessions.get(id);
    return found?.userId === ownerUserId ? cloneSession(found) : null;
  }

  getSessionSummary(id: string): SessionSummary | null {
    const found = this.sessions.get(id);
    return found ? summary(found) : null;
  }

  listSessions(): Session[] {
    return [...this.sessions.values()]
      .map(cloneSession)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
  }

  listAllSessionSummaries(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
      .map(summary);
  }

  listSessionSummaries(input: {
    ownerUserId: string;
    cursor?: SessionListCursor;
    limit: number;
  }) {
    const eligible = [...this.sessions.values()]
      .filter((session) => session.userId === input.ownerUserId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .filter((session) => !input.cursor ||
        session.updatedAt < input.cursor.updatedAt ||
        (session.updatedAt === input.cursor.updatedAt && session.id > input.cursor.sessionId));
    const hasMore = eligible.length > input.limit;
    const sessions = eligible.slice(0, input.limit).map(summary);
    const last = hasMore ? sessions.at(-1) : undefined;
    return {
      sessions,
      nextCursor: last ? { updatedAt: last.updatedAt, sessionId: last.id } : null,
    };
  }

  updateSession(session: Session): Session {
    this.sessions.set(session.id, cloneSession(session));
    this.versions.set(session.id, (this.versions.get(session.id) ?? 0) + 1);
    return cloneSession(session);
  }

  deleteSession(id: string): boolean {
    this.versions.delete(id);
    for (const key of this.turnRecords.keys()) if (key.startsWith(`${id}:`)) this.turnRecords.delete(key);
    return this.sessions.delete(id);
  }

  appendMessage(
    sessionId: string,
    message: Message,
    updatedAt: string,
  ): Session | null {
    const existing = this.sessions.get(sessionId);
    if (!existing) return null;

    const updated: Session = {
      ...existing,
      messages: [...existing.messages, cloneMessage(message)],
      updatedAt,
    };

    this.sessions.set(sessionId, updated);
    this.versions.set(sessionId, (this.versions.get(sessionId) ?? 0) + 1);
    return cloneSession(updated);
  }

  async getSessionTurnResult(input: SessionTurnLookupInput): Promise<CommitSessionTurnResult | null> {
    input.signal?.throwIfAborted();
    await this.cleanupExpiredTurnIdempotency(input.signal);
    const record = this.turnRecords.get(this.turnKey(input));
    if (!record) return null;
    if (record.payloadHash !== input.payloadHash) throw new SessionTurnIdempotencyConflictError();
    return { response: structuredClone(record.response), replayed: true };
  }

  async commitSessionTurn(input: CommitSessionTurnInput): Promise<CommitSessionTurnResult> {
    return this.exclusive(input.sessionId, async () => {
      input.signal?.throwIfAborted();
      await this.cleanupExpiredTurnIdempotency(input.signal);
      const key = this.turnKey(input);
      const record = this.turnRecords.get(key);
      if (record) {
        if (record.payloadHash !== input.payloadHash) throw new SessionTurnIdempotencyConflictError();
        return { response: structuredClone(record.response), replayed: true };
      }
      const existing = this.sessions.get(input.sessionId);
      if (!existing || existing.userId !== input.ownerUserId) throw new Error("session_not_found");
      if (input.expectedVersion !== undefined && input.expectedVersion !== this.versions.get(input.sessionId)) {
        throw new SessionTurnConcurrencyError();
      }
      const updated: Session = {
        ...existing,
        messages: [
          ...existing.messages,
          cloneMessage(input.userMessage),
          cloneMessage(input.assistantMessage),
        ],
        selectedContext: input.selectedContext.map((chunk) => ({
          ...chunk,
          signals: chunk.signals ? { ...chunk.signals } : undefined,
        })),
        updatedAt: input.updatedAt,
      };
      await this.options.beforeTurnCommit?.();
      input.signal?.throwIfAborted();
      this.sessions.set(input.sessionId, updated);
      this.versions.set(input.sessionId, (this.versions.get(input.sessionId) ?? 0) + 1);
      this.turnRecords.set(key, {
        payloadHash: input.payloadHash,
        response: structuredClone(input.response),
        expiresAt: this.now() + (this.options.retentionMs ?? env.SESSION_TURN_IDEMPOTENCY_RETENTION_MS),
      });
      return { response: structuredClone(input.response), replayed: false };
    });
  }

  async cleanupExpiredTurnIdempotency(signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    const now = this.now();
    let removed = 0;
    for (const [key, record] of this.turnRecords) {
      if (record.expiresAt > now) continue;
      this.turnRecords.delete(key);
      removed += 1;
    }
    return removed;
  }

  async verifyTurnPersistence(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
  }

  clear(): void {
    this.sessions.clear();
    this.versions.clear();
    this.turnRecords.clear();
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private turnKey(input: SessionTurnLookupInput): string {
    return `${input.sessionId}:${input.ownerUserId}:${input.idempotencyKey}`;
  }
  private async exclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(sessionId, next);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.locks.get(sessionId) === next) this.locks.delete(sessionId);
    }
  }
}

function summary(session: Session): SessionSummary {
  return {
    id: session.id,
    userId: session.userId,
    owner: session.owner,
    repo: session.repo,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}
