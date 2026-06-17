import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildContextPackage } from "../services/context/contextAssemblyService.js";
import type { EnrichedContextChunk } from "../services/context/contextTypes.js";
import {
  setFileSymbolMap,
  clearGraphSourceStore,
} from "../services/repository/graphSourceStore.js";
import {
  saveRepositorySymbols,
  symbolRecordsFromFileMaps,
  clearRepositorySymbolIndex,
} from "../services/repository/symbolIndexStore.js";
import type { FileImport, FileSymbolMap, SymbolKind } from "../services/graph/types.js";

function chunk(
  filePath: string,
  score: number,
  startLine = 1,
  endLine = 10,
  overrides?: Partial<EnrichedContextChunk>,
): EnrichedContextChunk {
  return {
    filePath,
    language: "typescript",
    content: `// ${filePath}`,
    startLine,
    endLine,
    score,
    source: "semantic",
    signals: {},
    ...overrides,
  };
}

function imp(source: string): FileImport {
  return { source, specifiers: [], isRelative: source.startsWith(".") };
}

function fileMap(
  filePath: string,
  symbols: Array<[string, SymbolKind, boolean, number]>,
  imports: string[] = [],
): FileSymbolMap {
  return {
    filePath,
    language: "typescript",
    symbols: symbols.map(([name, kind, exported, line]) => ({ name, kind, exported, line })),
    imports: imports.map(imp),
  };
}

// Seed both stores (graph source + symbol index) for a repo.
function seed(repoId: string, maps: FileSymbolMap[]): void {
  for (const m of maps) setFileSymbolMap(repoId, m);
  saveRepositorySymbols(repoId, symbolRecordsFromFileMaps(maps));
}

beforeEach(() => {
  clearGraphSourceStore();
  clearRepositorySymbolIndex();
});

test("1. code dedup collapses same file:lines, keeps highest score", () => {
  const pkg = buildContextPackage({
    owner: "o",
    repo: "r",
    retrievedChunks: [chunk("src/a.ts", 0.5), chunk("src/a.ts", 0.9), chunk("src/b.ts", 0.3)],
  });
  assert.equal(pkg.code.length, 2);
  assert.equal(pkg.stats.deduplicatedCount, 1);
  const a = pkg.code.find((c) => c.filePath === "src/a.ts");
  assert.equal(a?.score, 0.9); // highest kept
});

test("2. code ranking (score desc, filePath, startLine) + maxCodeChunks cap", () => {
  const pkg = buildContextPackage({
    owner: "o",
    repo: "r",
    retrievedChunks: [
      chunk("src/b.ts", 0.5),
      chunk("src/a.ts", 0.9),
      chunk("src/c.ts", 0.5),
    ],
    maxCodeChunks: 2,
  });
  assert.equal(pkg.code.length, 2);
  assert.deepEqual(pkg.code.map((c) => c.filePath), ["src/a.ts", "src/b.ts"]); // 0.9 first, then tie -> filePath asc
});

test("3. symbols limited to involved files, ordered, capped", () => {
  seed("o/r", [
    fileMap("src/a.ts", [["beta", "function", true, 9], ["alpha", "function", true, 2]]),
    fileMap("src/b.ts", [["gamma", "class", false, 1]]),
    fileMap("src/unused.ts", [["delta", "function", true, 1]]),
  ]);
  const pkg = buildContextPackage({
    owner: "o",
    repo: "r",
    retrievedChunks: [chunk("src/a.ts", 0.9), chunk("src/b.ts", 0.8)],
  });
  // unused.ts not involved -> excluded
  assert.ok(!pkg.symbols.some((s) => s.filePath === "src/unused.ts"));
  assert.deepEqual(
    pkg.symbols.map((s) => `${s.filePath}:${s.line}:${s.symbolName}`),
    ["src/a.ts:2:alpha", "src/a.ts:9:beta", "src/b.ts:1:gamma"],
  );
  // exported propagated
  assert.equal(pkg.symbols.find((s) => s.symbolName === "gamma")?.exported, false);
});

test("4. graph neighborhood seeded by code files, seeds excluded, capped", () => {
  // a -> b -> c ; seed a. neighbors: b (dist1), c (dist2)
  seed("o/r", [
    fileMap("src/a.ts", [["x", "function", true, 1]], ["./b.js"]),
    fileMap("src/b.ts", [["y", "function", true, 1]], ["./c.js"]),
    fileMap("src/c.ts", [["z", "function", true, 1]]),
  ]);
  const pkg = buildContextPackage({
    owner: "o",
    repo: "r",
    retrievedChunks: [chunk("src/a.ts", 0.9)],
    maxNeighbors: 5,
  });
  assert.ok(!pkg.graphNeighborhood.some((n) => n.filePath === "src/a.ts")); // seed excluded
  assert.deepEqual(pkg.graphNeighborhood.map((n) => n.filePath), ["src/b.ts", "src/c.ts"]);
  assert.equal(pkg.graphNeighborhood.find((n) => n.filePath === "src/b.ts")?.distance, 1);
});

test("5. empty retrievedChunks -> empty everything, zeroed stats", () => {
  seed("o/r", [fileMap("src/a.ts", [["x", "function", true, 1]])]);
  const pkg = buildContextPackage({ owner: "o", repo: "r", retrievedChunks: [] });
  assert.deepEqual(pkg.code, []);
  assert.deepEqual(pkg.symbols, []);
  assert.deepEqual(pkg.graphNeighborhood, []);
  assert.deepEqual(pkg.stats, { codeCount: 0, symbolCount: 0, neighborCount: 0, deduplicatedCount: 0 });
});

test("6. determinism: repeated calls deepEqual", () => {
  seed("o/r", [
    fileMap("src/a.ts", [["x", "function", true, 1]], ["./b.js"]),
    fileMap("src/b.ts", [["y", "function", true, 1]]),
  ]);
  const input = {
    owner: "o",
    repo: "r",
    retrievedChunks: [chunk("src/a.ts", 0.9), chunk("src/a.ts", 0.5)],
  };
  assert.deepEqual(buildContextPackage(input), buildContextPackage(input));
});

test("7. input immutability (chunks unchanged)", () => {
  const chunks = [chunk("src/a.ts", 0.9), chunk("src/b.ts", 0.5)];
  const snapshot = JSON.parse(JSON.stringify(chunks));
  buildContextPackage({ owner: "o", repo: "r", retrievedChunks: chunks });
  assert.deepEqual(chunks, snapshot);
});

test("8. ownership isolation: package for repoA uses only repoA stores", () => {
  seed("o/a", [fileMap("src/a.ts", [["aSym", "function", true, 1]])]);
  seed("o/b", [fileMap("src/a.ts", [["bSym", "function", true, 1]])]);
  const pkg = buildContextPackage({
    owner: "o",
    repo: "a",
    retrievedChunks: [chunk("src/a.ts", 0.9)],
  });
  assert.ok(pkg.symbols.some((s) => s.symbolName === "aSym"));
  assert.ok(!pkg.symbols.some((s) => s.symbolName === "bSym"));
});

test("9. JSON round-trip deep-equals; no undefined fields", () => {
  seed("o/r", [
    fileMap("src/a.ts", [["x", "function", true, 1]], ["./b.js"]),
    fileMap("src/b.ts", [["y", "function", true, 1]]),
  ]);
  const pkg = buildContextPackage({
    owner: "o",
    repo: "r",
    retrievedChunks: [chunk("src/a.ts", 0.9)],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(pkg)), pkg);
  const walk = (v: unknown): void => {
    assert.notEqual(v, undefined);
    if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(pkg);
});
