import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MemoryRepositoryStore } from "../services/repository/store/memoryRepositoryStore.js";
import {
  RepositoryConcurrencyError,
  REPOSITORY_CONCURRENCY_ERROR_CODE,
} from "../services/repository/store/repositoryStore.js";
import { repositoryUpdateToRow } from "../services/repository/store/repositoryPersistenceMapper.js";

const COUNTS = {
  chunkCount: 8,
  fileCount: 4,
  symbolCount: 12,
  graphNodeCount: 6,
  graphEdgeCount: 5,
  summaryAvailable: true,
} as const;

function connected(ownerUserId: string | null = "user-1") {
  const store = new MemoryRepositoryStore();
  const record = store.connectRepository({
    owner: "acme",
    repo: "api",
    ownerUserId,
  });
  return { store, record };
}

test("concurrent CAS update succeeds exactly once and stale version is deterministic", () => {
  const { store, record } = connected();
  const expectedVersion = record.persistenceVersion!;

  const winner = store.updateRepository(
    record.repositoryId,
    { status: "indexing" },
    expectedVersion,
  );
  assert.equal(winner?.persistenceVersion, expectedVersion + 1);
  assert.throws(
    () => store.updateRepository(
      record.repositoryId,
      { status: "failed" },
      expectedVersion,
    ),
    (error: unknown) => error instanceof RepositoryConcurrencyError &&
      error.code === REPOSITORY_CONCURRENCY_ERROR_CODE &&
      error.expectedVersion === expectedVersion,
  );
  assert.equal(store.getRepository(record.repositoryId)?.status, "indexing");
});

test("touch access cannot overwrite a newer indexed revision", () => {
  const { store, record } = connected();
  const staleVersion = record.persistenceVersion!;
  const indexed = store.markIndexed(record.repositoryId, {
    counts: COUNTS,
    indexedRevision: "a".repeat(40),
  })!;

  assert.throws(() => store.updateRepository(
    record.repositoryId,
    { lastAccessedAt: "2026-07-23T00:00:00.000Z" },
    staleVersion,
  ), RepositoryConcurrencyError);
  const touched = store.touchAccess(record.repositoryId)!;
  assert.equal(touched.indexedRevision, indexed.indexedRevision);
  assert.equal(touched.status, "indexed");
  assert.equal(touched.fileCount, COUNTS.fileCount);
});

test("ownership update race preserves the winning owner", () => {
  const { store, record } = connected(null);
  const expectedVersion = record.persistenceVersion!;
  const winner = store.updateRepository(
    record.repositoryId,
    { ownerUserId: "user-a" },
    expectedVersion,
  );
  assert.equal(winner?.ownerUserId, "user-a");
  assert.throws(() => store.updateRepository(
    record.repositoryId,
    { ownerUserId: "user-b" },
    expectedVersion,
  ), RepositoryConcurrencyError);
  assert.equal(store.getRepository(record.repositoryId)?.ownerUserId, "user-a");
});

test("indexing completion race cannot restore stale status, revision, or counters", () => {
  const { store, record } = connected();
  const expectedVersion = record.persistenceVersion!;
  const firstRevision = "b".repeat(40);
  const secondRevision = "c".repeat(40);
  store.updateRepository(record.repositoryId, {
    status: "indexed",
    indexedRevision: firstRevision,
    counts: COUNTS,
  }, expectedVersion);

  assert.throws(() => store.updateRepository(record.repositoryId, {
    status: "failed",
    indexedRevision: secondRevision,
    counts: { fileCount: 1, chunkCount: 1 },
  }, expectedVersion), RepositoryConcurrencyError);
  const current = store.getRepository(record.repositoryId)!;
  assert.equal(current.status, "indexed");
  assert.equal(current.indexedRevision, firstRevision);
  assert.equal(current.fileCount, COUNTS.fileCount);
  assert.equal(current.chunkCount, COUNTS.chunkCount);
});

test("partial persistence patch contains no unrelated columns", () => {
  assert.deepEqual(repositoryUpdateToRow({ lastAccessedAt: "2026-07-23T00:00:00.000Z" }), {
    last_accessed_at: "2026-07-23T00:00:00.000Z",
  });
  assert.deepEqual(repositoryUpdateToRow({ counts: { symbolCount: 7 } }), {
    symbol_count: 7,
  });
});

test("concurrent stress permits one winner for one expected version", async () => {
  const { store, record } = connected();
  const expectedVersion = record.persistenceVersion!;
  const attempts = await Promise.allSettled(Array.from({ length: 200 }, async (_, index) =>
    store.updateRepository(record.repositoryId, {
      counts: { symbolCount: index + 1 },
    }, expectedVersion)));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected" &&
    attempt.reason instanceof RepositoryConcurrencyError).length, 199);
  assert.equal(store.getRepository(record.repositoryId)?.persistenceVersion, expectedVersion + 1);
});

test("migration versions ordinary updates and transactional snapshot publication", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260723000000_add_repository_cas_version.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /repository_version bigint not null default 1/i);
  assert.match(migration, /before update on public\.repositories/i);
  assert.match(migration, /new\.repository_version := old\.repository_version \+ 1/i);
  assert.match(migration, /raise serialization_failure using message = 'repository_concurrency_conflict'/i);
  assert.doesNotMatch(migration, /lock table/i);

  const snapshotMigration = await readFile(new URL(
    "../../supabase/migrations/20260716000000_create_revision_safe_snapshots.sql",
    import.meta.url,
  ), "utf8");
  assert.match(snapshotMigration, /where repository_id = input_repository_id for update/i);
  assert.match(snapshotMigration, /update public\.repositories set/i);
});
