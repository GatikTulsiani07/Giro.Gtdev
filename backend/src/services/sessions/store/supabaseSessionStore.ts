import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message, Session } from "../types.js";
import {
  messageFromRow,
  messageToRow,
  sessionFromRow,
  sessionToRow,
  type SessionMessageRow,
  type SessionRow,
} from "./sessionPersistenceMapper.js";
import type { SessionStore } from "./sessionStore.js";

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
export interface SessionDatabaseClient { from(table: string): Query }

function one<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? data as T : null;
}
function many<T>(data: unknown): T[] { return Array.isArray(data) ? data as T[] : []; }
function assertResult(error: Result["error"]): void {
  if (error) throw new Error(`Session persistence failed: ${error.message ?? error.code ?? "database error"}`);
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

  async listSessions(): Promise<Session[]> {
    const { data, error } = await this.client.from("sessions").select("*")
      .order("updated_at", { ascending: false });
    assertResult(error);
    return Promise.all(many<SessionRow>(data).map(async (item) =>
      sessionFromRow(item, await this.messages(item.session_id))));
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
    const existing = await this.getSession(id);
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

  clear(): never { throw new Error("Clearing durable session storage is not supported at runtime."); }
}
