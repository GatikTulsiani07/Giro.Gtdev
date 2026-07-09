import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { MemoryRepositoryStore } from "../services/repository/store/memoryRepositoryStore.js";
import type {
  RepositoryRecord,
  RepositoryStoreCounts,
} from "../services/repository/store/repositoryStore.js";

const COUNTS: RepositoryStoreCounts = {
  chunkCount: 5,
  fileCount: 3,
  symbolCount: 7,
  graphNodeCount: 2,
  graphEdgeCount: 1,
  summaryAvailable: true,
};

let store: MemoryRepositoryStore;

beforeEach(() => {
  store = new MemoryRepositoryStore();
});

function connect(repository = { owner: "acme", repo: "demo" }): RepositoryRecord {
  return store.connectRepository({
    owner: repository.owner,
    repo: repository.repo,
    ownerUserId: "user-1",
  });
}

test("connect repository creates metadata state", () => {
  const record = connect();

  assert.equal(record.repositoryId, "acme/demo");
  assert.equal(record.owner, "acme");
  assert.equal(record.repo, "demo");
  assert.equal(record.ownerUserId, "user-1");
  assert.equal(record.status, "connected");
  assert.equal(record.chunkCount, 0);
  assert.equal(record.indexedAt, null);
  assert.equal(store.repositoryExists("acme/demo"), true);
});

test("update repository changes metadata only", () => {
  connect();

  const updated = store.updateRepository("acme/demo", {
    status: "stale",
    counts: { symbolCount: 12, summaryAvailable: true },
    lastChangedFileCount: 4,
  });

  assert.equal(updated?.status, "stale");
  assert.equal(updated?.symbolCount, 12);
  assert.equal(updated?.summaryAvailable, true);
  assert.equal(updated?.lastChangedFileCount, 4);
  assert.equal(store.getRepository("acme/demo")?.repo, "demo");
});

test("delete repository removes one entry", () => {
  connect();
  connect({ owner: "beta", repo: "api" });

  assert.equal(store.deleteRepository("acme/demo"), true);
  assert.equal(store.repositoryExists("acme/demo"), false);
  assert.equal(store.repositoryExists("beta/api"), true);
  assert.equal(store.deleteRepository("missing/repo"), false);
});

test("list ordering is deterministic by owner then repo", () => {
  connect({ owner: "zeta", repo: "web" });
  connect({ owner: "acme", repo: "demo" });
  connect({ owner: "acme", repo: "api" });

  assert.deepEqual(
    store.listRepositories().map((record) => record.repositoryId),
    ["acme/api", "acme/demo", "zeta/web"],
  );
});

test("duplicate repository handling updates existing entry", () => {
  const first = connect();
  const second = store.connectRepository({
    owner: "acme",
    repo: "demo",
    ownerUserId: "user-2",
  });

  assert.equal(first.repositoryId, second.repositoryId);
  assert.equal(store.listRepositories().length, 1);
  assert.equal(store.getRepository("acme/demo")?.ownerUserId, "user-2");
  assert.equal(store.getRepository("acme/demo")?.connectedAt, first.connectedAt);
});

test("mark indexing updates status", () => {
  connect();

  const record = store.markIndexing("acme/demo");

  assert.equal(record?.status, "indexing");
  assert.equal(store.markIndexing("missing/repo"), null);
});

test("mark indexed records counts and index timestamps", () => {
  connect();

  const record = store.markIndexed("acme/demo", {
    counts: COUNTS,
    indexMode: "full",
    changedFileCount: 3,
  });

  assert.equal(record?.status, "indexed");
  assert.equal(record?.chunkCount, 5);
  assert.equal(record?.fileCount, 3);
  assert.equal(record?.lastIndexMode, "full");
  assert.equal(record?.lastChangedFileCount, 3);
  assert.equal(record?.totalIndexedFiles, 3);
  assert.notEqual(record?.indexedAt, null);
  assert.equal(record?.firstIndexedAt, record?.indexedAt);
  assert.equal(record?.lastIndexedAt, record?.indexedAt);
});

test("mark failed records failure metadata", () => {
  connect();

  const record = store.markFailed("acme/demo", {
    reason: "clone failed",
    failedFileCount: 2,
    lastSuccessfulFile: "src/index.ts",
  });

  assert.equal(record?.status, "failed");
  assert.equal(record?.failureReason, "clone failed");
  assert.equal(record?.failedFileCount, 2);
  assert.equal(record?.lastSuccessfulFile, "src/index.ts");
  assert.notEqual(record?.lastFailureAt, null);
});

test("access timestamp update is isolated to existing repositories", () => {
  connect();

  const record = store.touchAccess("acme/demo");

  assert.notEqual(record?.lastAccessedAt, null);
  assert.equal(record?.lastAccessedAt, record?.updatedAt);
  assert.equal(store.touchAccess("missing/repo"), null);
});

test("clear store removes every repository", () => {
  connect();
  connect({ owner: "beta", repo: "api" });

  store.clear();

  assert.deepEqual(store.listRepositories(), []);
  assert.equal(store.getRepository("acme/demo"), null);
  assert.equal(store.repositoryExists("beta/api"), false);
});

test("repeated reads are deterministic", () => {
  connect({ owner: "zeta", repo: "web" });
  connect({ owner: "acme", repo: "demo" });
  store.markIndexed("acme/demo", { counts: COUNTS });

  const firstGet = store.getRepository("acme/demo");
  const secondGet = store.getRepository("acme/demo");
  const firstList = store.listRepositories();
  const secondList = store.listRepositories();

  assert.deepEqual(secondGet, firstGet);
  assert.deepEqual(secondList, firstList);
  assert.equal(JSON.stringify(secondList), JSON.stringify(firstList));
});

test("outputs are immutable defensive copies", () => {
  const connected = connect();

  assert.equal(Object.isFrozen(connected), true);
  assert.throws(() => {
    (connected as unknown as { status: string }).status = "mutated";
  }, TypeError);

  const found = store.getRepository("acme/demo");
  assert.ok(found);
  assert.equal(Object.isFrozen(found), true);
  assert.throws(() => {
    (found as unknown as { repo: string }).repo = "mutated";
  }, TypeError);

  const listed = store.listRepositories();
  assert.equal(Object.isFrozen(listed[0]), true);
  assert.throws(() => {
    (listed[0] as unknown as { owner: string }).owner = "mutated";
  }, TypeError);

  assert.equal(store.getRepository("acme/demo")?.status, "connected");
  assert.equal(store.getRepository("acme/demo")?.repo, "demo");
  assert.equal(store.getRepository("acme/demo")?.owner, "acme");
});
