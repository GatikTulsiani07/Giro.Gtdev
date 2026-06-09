import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getRepositoryIndexMetadata,
  setRepositoryIndexing,
  setRepositoryIndexed,
  setRepositoryFailed,
  markRepositoryStale,
  touchRepositoryAccess,
  listIndexedRepositories,
  isRepositoryHealthy,
  isRepositoryStale,
  clearRepositoryIndexRegistry,
  type IndexedCounts,
} from "../services/repository/indexingService.js";

const COUNTS: IndexedCounts = {
  chunkCount: 10,
  fileCount: 20,
  symbolCount: 30,
  graphNodeCount: 40,
  graphEdgeCount: 50,
  summaryAvailable: true,
};

function assertNoUndefined(value: unknown, path = "value"): void {
  if (value === undefined) assert.fail(`undefined value at ${path}`);
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

beforeEach(() => {
  clearRepositoryIndexRegistry();
});

test("1. empty registry lists []", () => {
  assert.deepEqual(listIndexedRepositories(), []);
});

test("2. one indexed repo -> single entry", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  const list = listIndexedRepositories();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.owner, "acme");
  assert.equal(list[0]?.repo, "demo");
});

test("3. multiple distinct repos -> one entry each", () => {
  setRepositoryIndexed("acme", "a", COUNTS);
  setRepositoryIndexed("acme", "b", COUNTS);
  setRepositoryIndexed("beta", "c", COUNTS);
  assert.equal(listIndexedRepositories().length, 3);
});

test("4. re-index same repo updates in place (no duplicate, latest counts)", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  setRepositoryIndexed("acme", "demo", { ...COUNTS, chunkCount: 999 });
  const list = listIndexedRepositories();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.chunkCount, 999);
});

test("5. repeated updates keep list length stable", () => {
  for (let i = 0; i < 5; i++) {
    setRepositoryIndexed("acme", "demo", { ...COUNTS, chunkCount: i });
  }
  assert.equal(listIndexedRepositories().length, 1);
});

test("6. stable sorting (owner asc, repo asc)", () => {
  setRepositoryIndexed("zeta", "z", COUNTS);
  setRepositoryIndexed("alpha", "b", COUNTS);
  setRepositoryIndexed("alpha", "a", COUNTS);
  const keys = listIndexedRepositories().map((m) => `${m.owner}/${m.repo}`);
  assert.deepEqual(keys, ["alpha/a", "alpha/b", "zeta/z"]);
});

test("7. indexed-only list; excluded repos still exist with their statuses", () => {
  setRepositoryIndexed("acme", "ok", COUNTS);
  setRepositoryIndexing("acme", "pending");
  setRepositoryFailed("acme", "broken");
  setRepositoryIndexed("acme", "old", COUNTS);
  markRepositoryStale("acme", "old");

  const list = listIndexedRepositories();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.repo, "ok");

  assert.equal(getRepositoryIndexMetadata("acme", "pending")?.status, "indexing");
  assert.equal(getRepositoryIndexMetadata("acme", "broken")?.status, "failed");
  assert.equal(getRepositoryIndexMetadata("acme", "old")?.status, "stale");
});

test("8. counts preserved exactly", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  const m = getRepositoryIndexMetadata("acme", "demo");
  assert.equal(m?.chunkCount, 10);
  assert.equal(m?.fileCount, 20);
  assert.equal(m?.symbolCount, 30);
  assert.equal(m?.graphNodeCount, 40);
  assert.equal(m?.graphEdgeCount, 50);
  assert.equal(m?.summaryAvailable, true);
});

test("9. JSON round-trip of list deep-equals original", () => {
  setRepositoryIndexed("acme", "a", COUNTS);
  setRepositoryIndexed("beta", "b", COUNTS);
  const list = listIndexedRepositories();
  assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
});

test("10. no undefined fields in metadata", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  assertNoUndefined(listIndexedRepositories());
  assertNoUndefined(getRepositoryIndexMetadata("acme", "demo"));
});

test("11. repeated read stability (no intervening writes)", () => {
  setRepositoryIndexed("acme", "a", COUNTS);
  setRepositoryIndexed("beta", "b", COUNTS);
  assert.deepEqual(listIndexedRepositories(), listIndexedRepositories());
});

test("12. clear resets everything", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  clearRepositoryIndexRegistry();
  assert.deepEqual(listIndexedRepositories(), []);
  assert.equal(getRepositoryIndexMetadata("acme", "demo"), null);
});

test("13. snapshot isolation: mutating a list entry does not corrupt store", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  const first = listIndexedRepositories();
  const entry = first[0];
  assert.ok(entry);
  entry.chunkCount = -1;
  entry.owner = "hacked";
  const fresh = listIndexedRepositories();
  assert.equal(fresh[0]?.chunkCount, 10);
  assert.equal(fresh[0]?.owner, "acme");
});

test("14. snapshot isolation: mutating a single-read does not corrupt store", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  const m = getRepositoryIndexMetadata("acme", "demo");
  assert.ok(m);
  m.chunkCount = -99;
  m.status = "failed";
  const fresh = getRepositoryIndexMetadata("acme", "demo");
  assert.equal(fresh?.chunkCount, 10);
  assert.equal(fresh?.status, "indexed");
});

test("15. multiple repos under same owner sort correctly", () => {
  setRepositoryIndexed("acme", "c", COUNTS);
  setRepositoryIndexed("acme", "a", COUNTS);
  setRepositoryIndexed("acme", "b", COUNTS);
  const repos = listIndexedRepositories().map((m) => m.repo);
  assert.deepEqual(repos, ["a", "b", "c"]);
});

test("16. same repo name under different owners -> distinct entries, sorted by owner", () => {
  setRepositoryIndexed("zeta", "shared", COUNTS);
  setRepositoryIndexed("alpha", "shared", COUNTS);
  const list = listIndexedRepositories();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((m) => m.owner), ["alpha", "zeta"]);
});

test("17. unknown repo -> getRepositoryIndexMetadata returns null", () => {
  assert.equal(getRepositoryIndexMetadata("ghost", "missing"), null);
});

test("18. setRepositoryIndexing produces expected defaults", () => {
  setRepositoryIndexing("acme", "pending");
  const m = getRepositoryIndexMetadata("acme", "pending");
  assert.ok(m);
  assert.equal(m?.status, "indexing");
  assert.equal(m?.indexedAt, null);
  assert.equal(m?.lastAccessedAt, null);
  assert.equal(m?.chunkCount, 0);
  assert.equal(m?.fileCount, 0);
  assert.equal(m?.symbolCount, 0);
  assert.equal(m?.graphNodeCount, 0);
  assert.equal(m?.graphEdgeCount, 0);
  assert.equal(m?.summaryAvailable, false);
});

test("19. healthy/stale helpers reflect status", () => {
  setRepositoryIndexed("acme", "ok", COUNTS);
  assert.equal(isRepositoryHealthy("acme", "ok"), true);
  assert.equal(isRepositoryStale("acme", "ok"), false);

  markRepositoryStale("acme", "ok");
  assert.equal(isRepositoryStale("acme", "ok"), true);
  assert.equal(isRepositoryHealthy("acme", "ok"), false);
});

test("20. touchRepositoryAccess sets lastAccessedAt without changing status", () => {
  setRepositoryIndexed("acme", "demo", COUNTS);
  touchRepositoryAccess("acme", "demo");
  const m = getRepositoryIndexMetadata("acme", "demo");
  assert.equal(m?.status, "indexed");
  assert.notEqual(m?.lastAccessedAt, null);
});
