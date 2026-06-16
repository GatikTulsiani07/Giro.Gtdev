import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { detectRepositoryStaleness } from "../services/repository/staleDetectionService.js";
import { evaluateRepositoryStaleness } from "../services/repository/staleEvaluationService.js";
import {
  setRepositoryIndexed,
  setRepositoryIndexing,
  setRepositoryFailed,
  markRepositoryStale,
  clearRepositoryStale,
  getRepositoryIndexMetadata,
  clearRepositoryIndexRegistry,
  type IndexedCounts,
} from "../services/repository/indexingService.js";

const COUNTS: IndexedCounts = {
  chunkCount: 0,
  fileCount: 0,
  symbolCount: 0,
  graphNodeCount: 0,
  graphEdgeCount: 0,
  summaryAvailable: false,
};

const detect = (a: string[], b: string[]) => detectRepositoryStaleness("o", "r", a, b);

beforeEach(() => {
  clearRepositoryIndexRegistry();
});

test("1. identical file sets -> not stale", () => {
  assert.equal(detect(["a", "b", "c"], ["a", "b", "c"]), false);
});

test("2. added file -> stale", () => {
  assert.equal(detect(["a", "b", "c"], ["a", "b"]), true);
});

test("3. removed file -> stale", () => {
  assert.equal(detect(["a", "b"], ["a", "b", "c"]), true);
});

test("4. different ordering, same members -> not stale", () => {
  assert.equal(detect(["c", "a", "b"], ["b", "c", "a"]), false);
});

test("5. duplicate input values handled deterministically", () => {
  assert.equal(detect(["a", "a", "b"], ["a", "b"]), false);
  assert.equal(detect(["a", "b"], ["a", "b", "b"]), false);
});

test("6. markRepositoryStale only affects an indexed repo (indexed -> stale)", () => {
  setRepositoryIndexed("o", "r", COUNTS);
  markRepositoryStale("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "stale");
});

test("7. a failed repo stays failed after markRepositoryStale", () => {
  setRepositoryFailed("o", "r");
  markRepositoryStale("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "failed");
});

test("8. an indexing repo stays indexing after markRepositoryStale", () => {
  setRepositoryIndexing("o", "r");
  markRepositoryStale("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "indexing");
});

test("9. clearRepositoryStale restores stale -> indexed (no-op otherwise)", () => {
  setRepositoryIndexed("o", "r", COUNTS);
  markRepositoryStale("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "stale");
  clearRepositoryStale("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "indexed");
  // no-op on a non-stale (now indexed) repo
  clearRepositoryStale("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "indexed");
  // no-op on failed
  setRepositoryFailed("o", "f");
  clearRepositoryStale("o", "f");
  assert.equal(getRepositoryIndexMetadata("o", "f")?.status, "failed");
});

test("10. evaluate marks an indexed repo stale when files differ", () => {
  setRepositoryIndexed("o", "r", COUNTS);
  const isStale = evaluateRepositoryStaleness("o", "r", ["a", "b", "c"], ["a", "b"]);
  assert.equal(isStale, true);
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "stale");
});

test("11. evaluate clears stale (-> indexed) when files match again", () => {
  setRepositoryIndexed("o", "r", COUNTS);
  evaluateRepositoryStaleness("o", "r", ["a", "b", "c"], ["a", "b"]); // -> stale
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "stale");
  const isStale = evaluateRepositoryStaleness("o", "r", ["a", "b"], ["a", "b"]); // match
  assert.equal(isStale, false);
  assert.equal(getRepositoryIndexMetadata("o", "r")?.status, "indexed");
});

test("12. ownership isolation: evaluating repoA never affects repoB", () => {
  setRepositoryIndexed("o", "a", COUNTS);
  setRepositoryIndexed("o", "b", COUNTS);
  const bBefore = getRepositoryIndexMetadata("o", "b");
  evaluateRepositoryStaleness("o", "a", ["x"], ["y"]); // a -> stale
  assert.equal(getRepositoryIndexMetadata("o", "a")?.status, "stale");
  assert.deepEqual(getRepositoryIndexMetadata("o", "b"), bBefore);
  assert.equal(getRepositoryIndexMetadata("o", "b")?.status, "indexed");
});

test("13. repeated evaluations with identical inputs are deterministic", () => {
  setRepositoryIndexed("o", "r", COUNTS);
  const first = evaluateRepositoryStaleness("o", "r", ["a", "b", "c"], ["a", "b"]);
  const statusAfterFirst = getRepositoryIndexMetadata("o", "r")?.status;
  const second = evaluateRepositoryStaleness("o", "r", ["a", "b", "c"], ["a", "b"]);
  const statusAfterSecond = getRepositoryIndexMetadata("o", "r")?.status;
  assert.equal(first, second);
  assert.equal(statusAfterFirst, statusAfterSecond);
  assert.equal(statusAfterSecond, "stale");
});

test("14. inputs are not mutated by detection", () => {
  const a = ["b", "a", "a"];
  const b = ["a", "b"];
  const aCopy = [...a];
  const bCopy = [...b];
  detect(a, b);
  assert.deepEqual(a, aCopy);
  assert.deepEqual(b, bCopy);
});
