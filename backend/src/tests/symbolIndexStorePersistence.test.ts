// Symbol persistence coverage for the connect-success path logic, exercised at
// the PURE store level (no real clone). Mirrors how POST /repos/connect now
// persists extracted symbols: symbolRecordsFromFileMaps(symbolMaps) ->
// saveRepositorySymbols(repoId, ...), with symbolCount = flattened count.
//
// NOTE: the originating task assumed no symbol store existed and prescribed a
// fresh API (PersistedRepositorySymbol / saveRepositorySymbols(fileMaps) /
// clearRepositorySymbolIndex). A symbolIndexStore.ts already exists here with a
// records-based API + its own test file, and the route already depends on it.
// To avoid regressions, these tests use the real store API (extended additively
// with getRepositorySymbolCount + clearRepositorySymbolIndex) in a separate file.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveRepositorySymbols,
  getRepositorySymbols,
  getRepositorySymbolCount,
  symbolRecordsFromFileMaps,
  clearRepositorySymbolIndex,
} from "../services/repository/symbolIndexStore.js";
import type { FileSymbolMap, SymbolKind } from "../services/graph/types.js";

const REPO_A = "acme/demo";
const REPO_B = "acme/other";

function fileMap(filePath: string, symbols: Array<[string, SymbolKind, number]>): FileSymbolMap {
  return {
    filePath,
    language: "typescript",
    symbols: symbols.map(([name, kind, line]) => ({ name, kind, exported: true, line })),
    imports: [],
  };
}

// Mirrors the route: maps -> records -> save; returns the flattened count.
function persist(repoId: string, maps: FileSymbolMap[]): number {
  saveRepositorySymbols(repoId, symbolRecordsFromFileMaps(maps));
  return maps.reduce((n, m) => n + m.symbols.length, 0);
}

beforeEach(() => {
  clearRepositorySymbolIndex();
});

test("1. symbols persist after save and are retrievable", () => {
  persist(REPO_A, [fileMap("src/a.ts", [["foo", "function", 1]])]);
  const symbols = getRepositorySymbols(REPO_A);
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0]?.symbolName, "foo");
  assert.equal(symbols[0]?.filePath, "src/a.ts");
});

test("2. multiple files persist; symbols carry originating filePath", () => {
  persist(REPO_A, [
    fileMap("src/a.ts", [["foo", "function", 1]]),
    fileMap("src/b.ts", [["Bar", "class", 2]]),
  ]);
  const symbols = getRepositorySymbols(REPO_A);
  const foo = symbols.find((s) => s.symbolName === "foo");
  const bar = symbols.find((s) => s.symbolName === "Bar");
  assert.equal(foo?.filePath, "src/a.ts");
  assert.equal(bar?.filePath, "src/b.ts");
});

test("3. empty symbol sets persist correctly", () => {
  const count = persist(REPO_A, []);
  assert.deepEqual(getRepositorySymbols(REPO_A), []);
  assert.equal(getRepositorySymbolCount(REPO_A), 0);
  assert.equal(count, 0);

  // file maps with no symbols also yield an empty persisted set
  persist(REPO_A, [fileMap("src/empty.ts", [])]);
  assert.deepEqual(getRepositorySymbols(REPO_A), []);
  assert.equal(getRepositorySymbolCount(REPO_A), 0);
});

test("4. re-saving the same repo overwrites atomically (no duplicates, old gone)", () => {
  persist(REPO_A, [fileMap("src/a.ts", [["foo", "function", 1]])]);
  persist(REPO_A, [fileMap("src/c.ts", [["baz", "function", 5]])]);
  const symbols = getRepositorySymbols(REPO_A);
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0]?.symbolName, "baz");
  assert.ok(!symbols.some((s) => s.symbolName === "foo"));
});

test("5. getRepositorySymbolCount equals flattened count", () => {
  const count = persist(REPO_A, [
    fileMap("src/a.ts", [["foo", "function", 1], ["Bar", "class", 2]]),
    fileMap("src/b.ts", [["baz", "variable", 3]]),
  ]);
  assert.equal(count, 3);
  assert.equal(getRepositorySymbolCount(REPO_A), 3);
});

test("6. deterministic ordering + deepEqual across repeated saves", () => {
  const maps = [
    fileMap("src/z.ts", [["zeta", "function", 5]]),
    fileMap("src/a.ts", [["beta", "function", 10], ["alpha", "function", 2]]),
  ];
  persist(REPO_A, maps);
  const first = getRepositorySymbols(REPO_A);
  persist(REPO_A, maps);
  const second = getRepositorySymbols(REPO_A);
  assert.deepEqual(first, second);
  // sorted by filePath, then line, then name
  assert.deepEqual(
    first.map((s) => `${s.filePath}:${s.startLine}:${s.symbolName}`),
    ["src/a.ts:2:alpha", "src/a.ts:10:beta", "src/z.ts:5:zeta"],
  );
});

test("7. a skipped save leaves another repo's symbols intact", () => {
  persist(REPO_A, [fileMap("src/a.ts", [["foo", "function", 1]])]);
  // REPO_B is never saved (simulating a failed index that never calls save)
  assert.equal(getRepositorySymbolCount(REPO_A), 1);
  assert.deepEqual(getRepositorySymbols(REPO_B), []);
  assert.equal(getRepositorySymbolCount(REPO_B), 0);
});

test("8. read isolation + clear resets", () => {
  persist(REPO_A, [fileMap("src/a.ts", [["foo", "function", 1]])]);
  const returned = getRepositorySymbols(REPO_A);
  returned.push({ filePath: "x", symbolName: "evil", kind: "function", startLine: 0, endLine: 0 });
  if (returned[0]) returned[0].symbolName = "tampered";
  const fresh = getRepositorySymbols(REPO_A);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]?.symbolName, "foo");

  clearRepositorySymbolIndex();
  assert.deepEqual(getRepositorySymbols(REPO_A), []);
  assert.equal(getRepositorySymbolCount(REPO_A), 0);
});
