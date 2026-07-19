import assert from "node:assert/strict";
import { test } from "node:test";
import { SupabaseRepositoryStore, type RepositoryDatabaseClient } from "../services/repository/store/supabaseRepositoryStore.js";
import { SupabaseSessionStore, type SessionDatabaseClient } from "../services/sessions/store/supabaseSessionStore.js";
import type { Session } from "../services/sessions/types.js";

type Row = Record<string, unknown>;
type Operation = "select" | "insert" | "update" | "delete";

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private operation: Operation = "select";
  private values: unknown;
  private readonly filters: Array<[string, unknown]> = [];
  private readonly orders: Array<[string, boolean]> = [];

  constructor(private readonly database: FakeDatabase, private readonly table: string) {}
  select(): this { return this; }
  insert(values: unknown): this { this.operation = "insert"; this.values = values; return this; }
  update(values: unknown): this { this.operation = "update"; this.values = values; return this; }
  delete(): this { this.operation = "delete"; return this; }
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this; }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push([column, options?.ascending !== false]); return this;
  }
  maybeSingle(): PromiseLike<{ data: unknown; error: null }> {
    return Promise.resolve(this.execute(true));
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }

  private execute(single: boolean) {
    let table = this.database.table(this.table);
    const matches = (row: Row) => this.filters.every(([column, value]) => row[column] === value);
    if (this.operation === "insert") {
      const inserted = structuredClone(this.values) as Row;
      if (this.table === "session_messages") {
        inserted.message_order = this.database.nextMessageOrder++;
        const session = this.database.table("sessions").find((item) => item.session_id === inserted.session_id);
        if (session && String(inserted.created_at) > String(session.updated_at)) session.updated_at = inserted.created_at;
      }
      table.push(inserted);
      return { data: single ? structuredClone(inserted) : [structuredClone(inserted)], error: null };
    }
    if (this.operation === "update") {
      const updated: Row[] = [];
      for (const item of table.filter(matches)) {
        Object.assign(item, structuredClone(this.values));
        updated.push(structuredClone(item));
      }
      return { data: single ? updated[0] ?? null : updated, error: null };
    }
    if (this.operation === "delete") {
      const deleted = table.filter(matches);
      this.database.replace(this.table, table.filter((item) => !matches(item)));
      return { data: structuredClone(deleted), error: null };
    }
    table = table.filter(matches);
    for (const [column, ascending] of [...this.orders].reverse()) {
      table.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    const data = table.map((item) => structuredClone(item));
    return { data: single ? data[0] ?? null : data, error: null };
  }
}

class FakeDatabase implements RepositoryDatabaseClient, SessionDatabaseClient {
  private readonly tables = new Map<string, Row[]>();
  nextMessageOrder = 1;
  from(table: string): FakeQuery { return new FakeQuery(this, table); }
  table(name: string): Row[] {
    const current = this.tables.get(name) ?? [];
    this.tables.set(name, current);
    return current;
  }
  replace(name: string, rows: Row[]): void { this.tables.set(name, rows); }
}

test("repository ownership, indexing state, and revision survive store recreation", async () => {
  const database = new FakeDatabase();
  const firstProcess = new SupabaseRepositoryStore(database);
  await firstProcess.connectRepository({ owner: "acme", repo: "api", ownerUserId: "user-1" });
  await firstProcess.markIndexed("acme/api", {
    counts: { chunkCount: 8, fileCount: 4, symbolCount: 12, graphNodeCount: 6, graphEdgeCount: 5, summaryAvailable: true },
    indexMode: "full",
    changedFileCount: 4,
    indexedRevision: "job-1:1",
  });

  const restartedProcess = new SupabaseRepositoryStore(database);
  const repository = await restartedProcess.getRepository("acme/api");
  assert.equal(repository?.ownerUserId, "user-1");
  assert.equal(repository?.status, "indexed");
  assert.equal(repository?.indexedRevision, "job-1:1");
  assert.equal(repository?.fileCount, 4);
});

test("session history, citations, evidence, and retrieval metadata survive store recreation", async () => {
  const database = new FakeDatabase();
  const repositoryStore = new SupabaseRepositoryStore(database);
  await repositoryStore.connectRepository({ owner: "acme", repo: "api", ownerUserId: "user-1" });
  const session: Session = {
    id: "session-1", userId: "user-1", owner: "acme", repo: "api", title: "Trace auth",
    createdAt: "2026-07-19T10:00:00.000Z", updatedAt: "2026-07-19T10:00:00.000Z",
    messages: [], selectedContext: [],
  };
  const firstProcess = new SupabaseSessionStore(database);
  await firstProcess.createSession(session);
  await firstProcess.appendMessage(session.id, {
    id: "message-1", role: "assistant", content: "Authentication starts in the router.",
    citations: [{ filePath: "src/routes/auth.ts", startLine: 10, endLine: 18 }],
    evidence: [{ filePath: "src/routes/auth.ts", language: "typescript", content: "router.post", startLine: 10, endLine: 18, score: 0.91 }],
    retrievalMetadata: {
      repositoryId: "acme/api", retrievedAt: "2026-07-19T10:01:00.000Z",
      sourceCounts: { semantic: 1, keyword: 0, symbol: 0, graph: 0, fileSearch: 0 },
      estimatedContextTokens: 40, selectedChunkCount: 1, droppedChunkCount: 0,
    },
    createdAt: "2026-07-19T10:01:00.000Z",
  }, "2026-07-19T10:01:00.000Z");

  const restartedProcess = new SupabaseSessionStore(database);
  const restored = await restartedProcess.getSession(session.id);
  assert.equal(restored?.userId, "user-1");
  assert.equal(restored?.messages[0]?.citations[0]?.filePath, "src/routes/auth.ts");
  assert.equal(restored?.messages[0]?.evidence?.[0]?.score, 0.91);
  assert.equal(restored?.messages[0]?.retrievalMetadata?.repositoryId, "acme/api");
});
