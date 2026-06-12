import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveRepositorySymbols,
  getRepositorySymbols,
  getRepositorySymbolsForFile,
  removeRepositorySymbolsForFiles,
  clearRepositorySymbols,
  symbolRecordsFromFileMaps,
  type RepositorySymbolRecord,
} from "../services/repository/symbolIndexStore.js";
import type { FileSymbolMap } from "../services/graph/types.js";

const REPO = "acme/demo";

function sym(
  filePath: string,
  symbolName: string,
  startLine = 1,
  overrides?: Partial<RepositorySymbolRecord>,
): RepositorySymbolRecord {
  return {
    filePath,
    symbolName,
    kind: "function",
    startLine,
    endLine: startLine,
    ...overrides,
  };
}

beforeEach(() => {
  clearRepositorySymbols();
});

test("1. saving symbols creates a retrievable repository symbol index", () => {
  saveRepositorySymbols(REPO, [sym("src/a.ts", "foo"), sym("src/b.ts", "bar")]);
  const all = getRepositorySymbols(REPO);
  assert.equal(all.length, 2);
  // sorted by filePath: src/a.ts (foo) then src/b.ts (bar)
  assert.deepEqual(all.map((s) => s.symbolName), ["foo", "bar"]);
});

test("2. symbols are sorted deterministically", () => {
  saveRepositorySymbols(REPO, [
    sym("src/z.ts", "zeta", 5),
    sym("src/a.ts", "beta", 10),
    sym("src/a.ts", "alpha", 2),
  ]);
  const all = getRepositorySymbols(REPO);
  // sorted by filePath, then startLine, then name
  assert.deepEqual(
    all.map((s) => `${s.filePath}:${s.startLine}:${s.symbolName}`),
    ["src/a.ts:2:alpha", "src/a.ts:10:beta", "src/z.ts:5:zeta"],
  );
});

test("3. duplicate symbol records are de-duplicated", () => {
  saveRepositorySymbols(REPO, [
    sym("src/a.ts", "foo", 1),
    sym("src/a.ts", "foo", 1),
    sym("src/a.ts", "foo", 1),
  ]);
  assert.equal(getRepositorySymbols(REPO).length, 1);
});

test("4. getRepositorySymbolsForFile returns only that file", () => {
  saveRepositorySymbols(REPO, [
    sym("src/a.ts", "foo"),
    sym("src/b.ts", "bar"),
    sym("src/a.ts", "baz", 9),
  ]);
  const aSymbols = getRepositorySymbolsForFile(REPO, "src/a.ts");
  assert.equal(aSymbols.length, 2);
  assert.ok(aSymbols.every((s) => s.filePath === "src/a.ts"));
});

test("5. removing symbols for deleted files removes only those files", () => {
  saveRepositorySymbols(REPO, [
    sym("src/a.ts", "foo"),
    sym("src/b.ts", "bar"),
    sym("src/c.ts", "qux"),
  ]);
  removeRepositorySymbolsForFiles(REPO, ["src/b.ts"]);
  const remaining = getRepositorySymbols(REPO).map((s) => s.filePath);
  assert.deepEqual(remaining, ["src/a.ts", "src/c.ts"]);
});

test("6. removing unknown files / unknown repo is safe", () => {
  saveRepositorySymbols(REPO, [sym("src/a.ts", "foo")]);
  assert.doesNotThrow(() => removeRepositorySymbolsForFiles(REPO, ["nope.ts"]));
  assert.doesNotThrow(() => removeRepositorySymbolsForFiles("ghost/missing", ["x.ts"]));
  assert.equal(getRepositorySymbols(REPO).length, 1);
});

test("7. returned symbols are isolated from store mutation", () => {
  saveRepositorySymbols(REPO, [sym("src/a.ts", "foo")]);
  const first = getRepositorySymbols(REPO);
  first.push(sym("src/hacked.ts", "evil"));
  if (first[0]) first[0].symbolName = "tampered";
  const fresh = getRepositorySymbols(REPO);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]?.symbolName, "foo");
});

test("8. clearing the store resets everything", () => {
  saveRepositorySymbols(REPO, [sym("src/a.ts", "foo")]);
  clearRepositorySymbols();
  assert.deepEqual(getRepositorySymbols(REPO), []);
});

test("9. inputs are not mutated by save", () => {
  const input = [sym("src/b.ts", "two"), sym("src/a.ts", "one")];
  const copy = JSON.parse(JSON.stringify(input));
  saveRepositorySymbols(REPO, input);
  assert.deepEqual(input, copy);
});

test("10. symbolRecordsFromFileMaps maps ExtractedSymbol shape compatibly", () => {
  const maps: FileSymbolMap[] = [
    {
      filePath: "src/a.ts",
      language: "typescript",
      symbols: [
        { name: "foo", kind: "function", exported: true, line: 3 },
        { name: "Bar", kind: "class", exported: true, line: 8 },
      ],
      imports: [],
    },
  ];
  const records = symbolRecordsFromFileMaps(maps);
  assert.equal(records.length, 2);
  const foo = records.find((r) => r.symbolName === "foo");
  assert.equal(foo?.startLine, 3);
  assert.equal(foo?.endLine, 3);
  assert.equal(foo?.kind, "function");
});

test("11. cleanup integration: removing files clears their symbols", () => {
  // Simulates the connect cleanup path calling removeRepositorySymbolsForFiles
  // with the cleanup plan's removed files.
  saveRepositorySymbols(REPO, [
    sym("src/keep.ts", "keep"),
    sym("src/gone.ts", "gone"),
  ]);
  const removedByCleanup = ["src/gone.ts"];
  removeRepositorySymbolsForFiles(REPO, removedByCleanup);
  const remaining = getRepositorySymbols(REPO);
  assert.deepEqual(remaining.map((s) => s.filePath), ["src/keep.ts"]);
});
