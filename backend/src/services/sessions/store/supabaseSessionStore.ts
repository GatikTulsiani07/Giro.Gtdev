import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message, Session, SessionListCursor, SessionSummary, SessionSummaryPage } from "../types.js";
import {
  messageFromRow,
  messageToRow,
  sessionFromRow,
  sessionSummaryFromRow,
  sessionToRow,
  type SessionMessageRow,
  type SessionRow,
} from "./sessionPersistenceMapper.js";
import type { SessionStore } from "./sessionStore.js";
import { env } from "../../../config/env.js";
import {
  SessionTurnConcurrencyError,
  SessionTurnIdempotencyConflictError,
  type CommitSessionTurnInput,
  type CommitSessionTurnResult,
  type SessionTurnLookupInput,
} from "../sessionTurn.js";

interface Result { data: unknown; error: { code?: string; message?: string } | null }
interface Query extends PromiseLike<Result> {
  select(columns?: string): Query;
  insert(values: unknown): Query;
  update(values: unknown): Query;
  delete(): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  maybeSingle(): PromiseLike<Result>;
}
interface RpcQuery extends PromiseLike<Result> { abortSignal?(signal: AbortSignal): RpcQuery }
export interface SessionDatabaseClient {
  from(table: string): Query;
  rpc?(name: string, parameters?: Record<string, unknown>): RpcQuery;
}

function one<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? data as T : null;
}
function many<T>(data: unknown): T[] { return Array.isArray(data) ? data as T[] : []; }
function assertResult(error: Result["error"]): void {
  if (error) throw new Error(`Session persistence failed: ${error.message ?? error.code ?? "database error"}`);
}

function turnError(error: Result["error"]): void {
  if (!error) return;
  if (error.message?.includes("session_turn_idempotency_conflict")) {
    throw new SessionTurnIdempotencyConflictError();
  }
  if (error.message?.includes("session_concurrency_conflict")) {
    throw new SessionTurnConcurrencyError();
  }
  assertResult(error);
}

async function rpc(
  client: SessionDatabaseClient,
  name: string,
  parameters: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Result> {
  signal?.throwIfAborted();
  if (!client.rpc) throw new Error("Session RPC persistence is unavailable.");
  let query = client.rpc(name, parameters);
  if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
  return query;
}

export class SupabaseSessionStore implements SessionStore {
  private readonly client: SessionDatabaseClient;
  constructor(client: SessionDatabaseClient | SupabaseClient) {
    this.client = client as unknown as SessionDatabaseClient;
  }

  private async messages(sessionId: string): Promise<Message[]> {
    const { data, error } = await this.client.from("session_messages").select("*")
      .eq("session_id", sessionId).order("message_order", { ascending: true });
    assertResult(error);
    return many<SessionMessageRow>(data).map(messageFromRow);
  }

  async createSession(session: Session): Promise<Session> {
    const { data, error } = await this.client.from("sessions").insert(sessionToRow(session))
      .select("*").maybeSingle();
    assertResult(error);
    const persisted = one<SessionRow>(data);
    if (!persisted) throw new Error("Session persistence returned no record.");
    return sessionFromRow(persisted, []);
  }

  async getSession(id: string): Promise<Session | null> {
    const { data, error } = await this.client.from("sessions").select("*")
      .eq("session_id", id).maybeSingle();
    if (error?.code === "PGRST116") return null;
    assertResult(error);
    const persisted = one<SessionRow>(data);
    return persisted ? sessionFromRow(persisted, await this.messages(id)) : null;
  }

  async getSessionForOwner(id: string, ownerUserId: string): Promise<Session | null> {
    const { data, error } = await this.client.from("sessions").select("*")
      .eq("session_id", id).eq("owner_user_id", ownerUserId).maybeSingle();
    if (error?.code === "PGRST116") return null;
    assertResult(error);
    const persisted = one<SessionRow>(data);
    return persisted ? sessionFromRow(persisted, await this.messages(id)) : null;
  }

  async getSessionSummary(id: string) {
    const { data, error } = await this.client.from("sessions").select(
      "session_id,owner_user_id,repository_owner,repository_name,title,created_at,updated_at,message_count",
    ).eq("session_id", id).maybeSingle();
    if (error?.code === "PGRST116") return null;
    assertResult(error);
    const persisted = one<SessionRow>(data);
    return persisted ? sessionSummaryFromRow(persisted) : null;
  }

  async listSessions(): Promise<Session[]> {
    const { data, error } = await this.client.from("sessions").select("*")
      .order("updated_at", { ascending: false });
    assertResult(error);
    return Promise.all(many<SessionRow>(data).map(async (item) =>
      sessionFromRow(item, await this.messages(item.session_id))));
  }

  async listAllSessionSummaries(): Promise<SessionSummary[]> {
    const { data, error } = await this.client.from("sessions").select(
      "session_id,owner_user_id,repository_owner,repository_name,title,created_at,updated_at,message_count",
    ).order("updated_at", { ascending: false }).order("session_id", { ascending: true });
    assertResult(error);
    return many<SessionRow>(data).map(sessionSummaryFromRow);
  }

  async listSessionSummaries(input: {
    ownerUserId: string;
    cursor?: SessionListCursor;
    limit: number;
  }): Promise<SessionSummaryPage> {
    const { data, error } = await rpc(this.client, "list_session_summaries", {
      input_owner_user_id: input.ownerUserId,
      input_cursor_updated_at: input.cursor?.updatedAt ?? null,
      input_cursor_session_id: input.cursor?.sessionId ?? null,
      input_page_size: input.limit + 1,
      input_statement_timeout_ms: env.DATABASE_STATEMENT_TIMEOUT_MS,
    });
    assertResult(error);
    const rows = many<SessionRow>(data);
    const hasMore = rows.length > input.limit;
    const sessions = rows.slice(0, input.limit).map(sessionSummaryFromRow);
    const last = hasMore ? sessions.at(-1) : undefined;
    return {
      sessions,
      nextCursor: last ? { updatedAt: last.updatedAt, sessionId: last.id } : null,
    };
  }

  async updateSession(session: Session): Promise<Session> {
    const { data, error } = await this.client.from("sessions").update(sessionToRow(session))
      .eq("session_id", session.id).select("*").maybeSingle();
    assertResult(error);
    const persisted = one<SessionRow>(data);
    if (!persisted) throw new Error("Session was not found during persistence update.");
    return sessionFromRow(persisted, await this.messages(session.id));
  }

  async deleteSession(id: string): Promise<boolean> {
    const existing = await this.getSessionSummary(id);
    if (!existing) return false;
    const { error } = await this.client.from("sessions").delete().eq("session_id", id);
    assertResult(error);
    return true;
  }

  async appendMessage(sessionId: string, message: Message, _updatedAt: string): Promise<Session | null> {
    const { error } = await this.client.from("session_messages").insert(messageToRow(sessionId, message));
    assertResult(error);
    return this.getSession(sessionId);
  }

  async getSessionTurnResult(input: SessionTurnLookupInput): Promise<CommitSessionTurnResult | null> {
    const { data, error } = await rpc(this.client, "get_session_turn_idempotency", {
      input_session_id: input.sessionId,
      input_owner_user_id: input.ownerUserId,
      input_idempotency_key: input.idempotencyKey,
      input_payload_hash: input.payloadHash,
      input_statement_timeout_ms: env.DATABASE_STATEMENT_TIMEOUT_MS,
    }, input.signal);
    turnError(error);
    const row = one<Record<string, unknown>>(data);
    return row ? { response: structuredClone(row.response), replayed: true } : null;
  }

  async commitSessionTurn(input: CommitSessionTurnInput): Promise<CommitSessionTurnResult> {
    const { data, error } = await rpc(this.client, "commit_session_turn", {
      input_session_id: input.sessionId,
      input_owner_user_id: input.ownerUserId,
      input_idempotency_key: input.idempotencyKey,
      input_payload_hash: input.payloadHash,
      input_user_message: messageToRow(input.sessionId, input.userMessage),
      input_assistant_message: messageToRow(input.sessionId, input.assistantMessage),
      input_selected_context: input.selectedContext,
      input_response: input.response,
      input_updated_at: input.updatedAt,
      input_expected_version: input.expectedVersion ?? null,
      input_retention_ms: env.SESSION_TURN_IDEMPOTENCY_RETENTION_MS,
      input_statement_timeout_ms: env.DATABASE_STATEMENT_TIMEOUT_MS,
    }, input.signal);
    turnError(error);
    const row = one<Record<string, unknown>>(data);
    if (!row) throw new Error("Session turn transaction returned no result.");
    return { response: structuredClone(row.response), replayed: row.replayed === true };
  }

  async cleanupExpiredTurnIdempotency(signal?: AbortSignal): Promise<number> {
    const { data, error } = await rpc(this.client, "cleanup_session_turn_idempotency", {
      input_statement_timeout_ms: env.DATABASE_STATEMENT_TIMEOUT_MS,
    }, signal);
    assertResult(error);
    return Number(data ?? 0);
  }

  async verifyTurnPersistence(signal?: AbortSignal): Promise<void> {
    const { data, error } = await rpc(this.client, "verify_session_persistence_contract", {
      input_statement_timeout_ms: env.DATABASE_STATEMENT_TIMEOUT_MS,
    }, signal);
    if (error || data !== true) throw new Error(error?.message ?? "Session persistence contract is unavailable.");
  }

  clear(): never { throw new Error("Clearing durable session storage is not supported at runtime."); }
}
