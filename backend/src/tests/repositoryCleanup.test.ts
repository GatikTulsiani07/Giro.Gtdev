import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupRepository,
  isRepositoryCleaned,
  evaluateRepositoryCleanup,
} from "../services/repository/repositoryCleanupService.js";
import {
  setRepositoryIndexed,
  getRepositoryIndexMetadata,
  listIndexedRepositories,
  clearRepositoryIndexRegistry,
  type IndexedCounts,
} from "../services/repository/indexingService.js";
import {
  saveRepositorySymbols,
  getRepositorySymbolCount,
  symbolRecordsFromFileMaps,
  clearRepositorySymbolIndex,
} from "../services/repository/symbolIndexStore.js";
import {
  setFileSymbolMap,
  getFileSymbolMaps,
  clearGraphSourceStore,
} from "../services/repository/graphSourceStore.js";
import {
  saveRepositoryFileSnapshot,
  getRepositoryFileSnapshot,
  clearRepositoryFileSnapshots,
} from "../services/repository/fileSnapshotStore.js";
import type { FileSymbolMap } from "../services/graph/types.js";
import type { ScannedFile } from "../services/repository/scanner.js";

const COUNTS: IndexedCounts = {
  chunkCount: 1,
  fileCount: 1,
  symbolCount: 1,
  graphNodeCount: 1,
  graphEdgeCount: 0,
  summaryAvailable: false,
};

function fileMap(filePath: string): FileSymbolMap {
  return {
    filePath,
    language: "typescript",
    symbols: [{ name: "x", kind: "function", exported: true, line: 1 }],
    imports: [],
  };
}

function scanned(filePath: string): ScannedFile {
  return { filePath, size: 1, language: ".ts" };
}

function seed(owner: string, repo: string): void {
  const repoId = `${owner}/${repo}`;
  setRepositoryIndexed(owner, repo, COUNTS);
  saveRepositorySymbols(repoId, symbolRecordsFromFileMaps([fileMap("src/a.ts")]));
  setFileSymbolMap(repoId, fileMap("src/a.ts"));
  saveRepositoryFileSnapshot(repoId, [scanned("src/a.ts")]);
}

beforeEach(() => {
  clearRepositoryIndexRegistry();
  clearRepositorySymbolIndex();
  clearGraphSourceStore();
  clearRepositoryFileSnapshots();
});

test("1. cleanup removes repository metadata", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r"), null);
});

test("2. cleanup removes symbol records", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.equal(getRepositorySymbolCount("o/r"), 0);
});

test("3. cleanup removes graph source records", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.deepEqual(getFileSymbolMaps("o/r"), []);
});

test("4. cleanup removes snapshots", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.equal(getRepositoryFileSnapshot("o/r"), null);
});

test("5. repository no longer appears indexed", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.equal(getRepositoryIndexMetadata("o", "r"), null);
  assert.ok(!listIndexedRepositories().some((m) => m.owner === "o" && m.repo === "r"));
});

test("6. cleanup is idempotent (twice -> same final state)", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  const afterFirst = isRepositoryCleaned("o", "r");
  cleanupRepository("o", "r");
  assert.equal(isRepositoryCleaned("o", "r"), afterFirst);
  assert.equal(isRepositoryCleaned("o", "r"), true);
});

test("7. isRepositoryCleaned -> true after cleanup", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.equal(isRepositoryCleaned("o", "r"), true);
});

test("8. isRepositoryCleaned -> false before cleanup", () => {
  seed("o", "r");
  assert.equal(isRepositoryCleaned("o", "r"), false);
});

test("9. evaluateRepositoryCleanup correct before cleanup", () => {
  seed("o", "r");
  assert.deepEqual(evaluateRepositoryCleanup("o", "r"), {
    exists: true,
    indexed: true,
    cleaned: false,
  });
});

test("10. evaluateRepositoryCleanup correct after cleanup", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  assert.deepEqual(evaluateRepositoryCleanup("o", "r"), {
    exists: false,
    indexed: false,
    cleaned: true,
  });
});

test("11. ownership isolation: cleaning repoA never affects repoB", () => {
  seed("o", "a");
  seed("o", "b");
  const bMetaBefore = getRepositoryIndexMetadata("o", "b");
  const bSymbolsBefore = getRepositorySymbolCount("o/b");
  const bGraphBefore = getFileSymbolMaps("o/b");
  const bSnapBefore = getRepositoryFileSnapshot("o/b");

  cleanupRepository("o", "a");

  assert.equal(isRepositoryCleaned("o", "a"), true);
  assert.deepEqual(getRepositoryIndexMetadata("o", "b"), bMetaBefore);
  assert.equal(getRepositorySymbolCount("o/b"), bSymbolsBefore);
  assert.deepEqual(getFileSymbolMaps("o/b"), bGraphBefore);
  assert.deepEqual(getRepositoryFileSnapshot("o/b"), bSnapBefore);
});

test("12. cleaning a nonexistent repository is safe (no throw; cleaned:true)", () => {
  assert.doesNotThrow(() => cleanupRepository("ghost", "missing"));
  assert.equal(isRepositoryCleaned("ghost", "missing"), true);
  assert.deepEqual(evaluateRepositoryCleanup("ghost", "missing"), {
    exists: false,
    indexed: false,
    cleaned: true,
  });
});

test("13. repeated cleanup maintains deterministic state", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  const s1 = evaluateRepositoryCleanup("o", "r");
  cleanupRepository("o", "r");
  cleanupRepository("o", "r");
  const s2 = evaluateRepositoryCleanup("o", "r");
  assert.deepEqual(s1, s2);
});

test("14. deepEqual final state after multiple cleanup calls", () => {
  seed("o", "r");
  cleanupRepository("o", "r");
  const state1 = {
    meta: getRepositoryIndexMetadata("o", "r"),
    symbols: getRepositorySymbolCount("o/r"),
    graph: getFileSymbolMaps("o/r"),
    snapshot: getRepositoryFileSnapshot("o/r"),
  };
  cleanupRepository("o", "r");
  const state2 = {
    meta: getRepositoryIndexMetadata("o", "r"),
    symbols: getRepositorySymbolCount("o/r"),
    graph: getFileSymbolMaps("o/r"),
    snapshot: getRepositoryFileSnapshot("o/r"),
  };
  assert.deepEqual(state1, state2);
});
