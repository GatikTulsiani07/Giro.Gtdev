import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MemorySessionStore } from "../services/sessions/store/memorySessionStore.js";
import { SupabaseSessionStore } from "../services/sessions/store/supabaseSessionStore.js";
import {
  SessionTurnIdempotencyConflictError,
  sessionTurnPayloadHash,
  type CommitSessionTurnInput,
} from "../services/sessions/sessionTurn.js";
import type { Message, Session } from "../services/sessions/types.js";

function session(id: string, userId: string, updatedAt: string): Session {
  return {
    id, userId, owner: "acme", repo: id, title: `Session ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt,
    messages: [], selectedContext: [],
  };
}

function message(id: string, role: "user" | "assistant", content: string): Message {
  return { id, role, content, citations: [], createdAt: "2026-01-02T00:00:00.000Z" };
}

function turn(sessionId = "s1", key = "turn-1", hash = "a".repeat(64)): CommitSessionTurnInput {
  return {
    sessionId, ownerUserId: "user-a", idempotencyKey: key, payloadHash: hash,
    userMessage: message(`${key}-u`, "user", `question ${key}`),
    assistantMessage: message(`${key}-a`, "assistant", `answer ${key}`),
    selectedContext: [{
      filePath: "src/index.ts", language: "typescript", content: "export {}",
      startLine: 1, endLine: 1, score: 1,
    }],
    response: { answer: `answer ${key}` },
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

test("owner-filtered cursor pages return summaries without message bodies", async () => {
  const store = new MemorySessionStore();
  store.createSession(session("s1", "user-a", "2026-01-03T00:00:00.000Z"));
  store.createSession(session("s2", "user-a", "2026-01-02T00:00:00.000Z"));
  store.createSession(session("s3", "user-a", "2026-01-01T00:00:00.000Z"));
  store.createSession(session("foreign", "user-b", "2026-01-04T00:00:00.000Z"));
  store.appendMessage("s1", message("m1", "user", "secret body"), "2026-01-03T00:00:00.000Z");

  const first = store.listSessionSummaries({ ownerUserId: "user-a", limit: 2 });
  assert.deepEqual(first.sessions.map((item) => item.id), ["s1", "s2"]);
  assert.equal(first.sessions[0]?.messageCount, 1);
  assert.equal("messages" in first.sessions[0]!, false);
  assert.ok(first.nextCursor);
  const second = store.listSessionSummaries({
    ownerUserId: "user-a", limit: 2, cursor: first.nextCursor!,
  });
  assert.deepEqual(second.sessions.map((item) => item.id), ["s3"]);
  assert.equal(second.nextCursor, null);
});

test("Supabase summary listing uses one owner-filtered RPC and never loads message rows", async () => {
  const calls: Array<{ name: string; parameters?: Record<string, unknown> }> = [];
  const store = new SupabaseSessionStore({
    from: () => { throw new Error("full-table query attempted"); },
    rpc: (name: string, parameters?: Record<string, unknown>) => {
      calls.push({ name, parameters });
      return Promise.resolve({ data: [{
        session_id: "s1", owner_user_id: "user-a", repository_owner: "acme",
        repository_name: "api", title: "API", created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z", message_count: 7,
      }], error: null });
    },
  });
  const page = await store.listSessionSummaries({ ownerUserId: "user-a", limit: 20 });
  assert.equal(page.sessions[0]?.messageCount, 7);
  assert.equal(calls[0]?.name, "list_session_summaries");
  assert.equal(calls[0]?.parameters?.input_owner_user_id, "user-a");
  assert.equal(calls[0]?.parameters?.input_page_size, 21);
});

test("Supabase single-session retrieval filters ownership before loading messages", async () => {
  const equals: Array<{ table: string; column: string; value: unknown }> = [];
  const from = (table: string) => {
    const data = table === "sessions" ? {
      session_id: "s1", owner_user_id: "user-a", repository_id: "acme/api",
      repository_owner: "acme", repository_name: "api", title: "API",
      selected_context: [], created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z", message_count: 1, session_version: 1,
    } : [{
      message_id: "m1", session_id: "s1", role: "user", content: "body",
      citations: [], evidence: null, retrieval_metadata: null,
      created_at: "2026-01-02T00:00:00.000Z", message_order: 1,
    }];
    const result = { data, error: null };
    const query = {
      select: () => query,
      insert: () => query,
      update: () => query,
      delete: () => query,
      eq: (column: string, value: unknown) => {
        equals.push({ table, column, value });
        return query;
      },
      order: () => query,
      maybeSingle: () => Promise.resolve(result),
      then: <TResult1 = typeof result, TResult2 = never>(
        onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(result).then(onfulfilled, onrejected),
    };
    return query;
  };
  const store = new SupabaseSessionStore({ from });
  const loaded = await store.getSessionForOwner("s1", "user-a");
  assert.equal(loaded?.messages[0]?.content, "body");
  assert.deepEqual(equals.slice(0, 2), [
    { table: "sessions", column: "session_id", value: "s1" },
    { table: "sessions", column: "owner_user_id", value: "user-a" },
  ]);
  assert.equal(equals.filter((call) => call.table === "session_messages").length, 1);
});

test("atomic turn commits both messages, context, and response together", async () => {
  const store = new MemorySessionStore();
  store.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  const result = await store.commitSessionTurn(turn());
  assert.deepEqual(result, { response: { answer: "answer turn-1" }, replayed: false });
  const saved = store.getSession("s1")!;
  assert.deepEqual(saved.messages.map((item) => item.role), ["user", "assistant"]);
  assert.equal(saved.selectedContext.length, 1);
});

test("identical turn retry replays without duplicate messages", async () => {
  const store = new MemorySessionStore();
  store.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  const first = await store.commitSessionTurn(turn());
  const replay = await store.commitSessionTurn(turn());
  assert.deepEqual(replay.response, first.response);
  assert.equal(replay.replayed, true);
  assert.equal(store.getSession("s1")?.messages.length, 2);
});

test("conflicting turn retry is rejected without mutation", async () => {
  const store = new MemorySessionStore();
  store.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  await store.commitSessionTurn(turn());
  await assert.rejects(store.commitSessionTurn(turn("s1", "turn-1", "b".repeat(64))),
    SessionTurnIdempotencyConflictError);
  assert.equal(store.getSession("s1")?.messages.length, 2);
});

test("concurrent turns remain non-interleaved and deterministically ordered", async () => {
  const store = new MemorySessionStore();
  store.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  await Promise.all([
    store.commitSessionTurn(turn("s1", "turn-1", "1".repeat(64))),
    store.commitSessionTurn(turn("s1", "turn-2", "2".repeat(64))),
  ]);
  assert.deepEqual(store.getSession("s1")?.messages.map((item) => item.content), [
    "question turn-1", "answer turn-1", "question turn-2", "answer turn-2",
  ]);
});

test("failed atomic persistence rolls back messages, context, and idempotency", async () => {
  const store = new MemorySessionStore({ beforeTurnCommit: () => { throw new Error("write failed"); } });
  store.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  await assert.rejects(store.commitSessionTurn(turn()), /write failed/);
  const saved = store.getSession("s1")!;
  assert.deepEqual(saved.messages, []);
  assert.deepEqual(saved.selectedContext, []);
  assert.equal(await store.getSessionTurnResult(turn()), null);
});

test("turn idempotency cleanup expires records deterministically", async () => {
  let now = 1_000;
  const store = new MemorySessionStore({ now: () => now, retentionMs: 100 });
  store.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  await store.commitSessionTurn(turn());
  assert.equal(await store.cleanupExpiredTurnIdempotency(), 0);
  now += 101;
  assert.equal(await store.cleanupExpiredTurnIdempotency(), 1);
});

test("memory and Supabase atomic turn stores expose equivalent results", async () => {
  const memory = new MemorySessionStore();
  memory.createSession(session("s1", "user-a", "2026-01-01T00:00:00.000Z"));
  const expected = await memory.commitSessionTurn(turn());
  let parameters: Record<string, unknown> | undefined;
  const supabase = new SupabaseSessionStore({
    from: () => { throw new Error("unexpected table query"); },
    rpc: (_name: string, input?: Record<string, unknown>) => {
      parameters = input;
      return Promise.resolve({ data: [{ response: expected.response, replayed: false }], error: null });
    },
  });
  const actual = await supabase.commitSessionTurn(turn());
  assert.deepEqual(actual, expected);
  assert.equal((parameters?.input_user_message as Record<string, unknown>).role, "user");
  assert.equal((parameters?.input_assistant_message as Record<string, unknown>).role, "assistant");
});

test("turn payload hashes are stable and tenant/session scoped", () => {
  const first = sessionTurnPayloadHash({ sessionId: "s1", ownerUserId: "u1", question: "hello" });
  assert.equal(first, sessionTurnPayloadHash({ sessionId: "s1", ownerUserId: "u1", question: "hello" }));
  assert.notEqual(first, sessionTurnPayloadHash({ sessionId: "s2", ownerUserId: "u1", question: "hello" }));
});

test("session migration defines pagination, atomic turns, fencing, cleanup, and restricted access", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260731000000_add_scalable_sessions_and_atomic_turns.sql",
    import.meta.url,
  ), "utf8");
  for (const contract of [
    "sessions_owner_cursor_idx", "list_session_summaries", "owner_user_id = input_owner_user_id",
    "for update", "commit_session_turn", "session_turn_idempotency", "session_version",
    "session_turn_idempotency_conflict", "cleanup_session_turn_idempotency",
    "verify_session_persistence_contract", "statement_timeout", "enable row level security",
  ]) assert.match(migration, new RegExp(contract, "i"));
});
