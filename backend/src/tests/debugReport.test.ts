import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRetrievalDebugReport } from "../services/retrieval/debugReport.js";
import { scoreContextConfidence } from "../services/retrieval/confidenceScorer.js";
import type { EnrichedContextChunk } from "../services/context/contextTypes.js";
import type { RerankStatistics } from "../services/retrieval/qualityReranker.js";

function chunk(overrides?: Partial<EnrichedContextChunk>): EnrichedContextChunk {
  return {
    filePath: "src/a.ts",
    language: "typescript",
    content: "const a = 1;",
    startLine: 1,
    endLine: 10,
    score: 0.5,
    source: "semantic",
    signals: { semantic: 0.5 },
    ...overrides,
  };
}

const STATS: RerankStatistics = {
  originalChunkCount: 12,
  rerankedChunkCount: 8,
  duplicateChunksRemoved: 3,
  boostedChunkCount: 4,
  crossFileBoostedChunkCount: 2,
};

test("1. empty input returns zeroed report, no throw", () => {
  const r = buildRetrievalDebugReport([]);
  assert.equal(r.totalChunksBeforeRerank, 0);
  assert.equal(r.totalChunksAfterRerank, 0);
  assert.equal(r.totalChunksAfterBudget, 0);
  assert.equal(r.duplicateChunksRemoved, 0);
  assert.equal(r.boostedChunks, 0);
  assert.equal(r.crossFileBoostedChunks, 0);
  assert.equal(r.averageConfidence, 0);
  assert.equal(r.filesRepresented, 0);
  assert.deepEqual(r.sourcesRepresented, []);
});

test("2. distinct file counting", () => {
  const r = buildRetrievalDebugReport([
    chunk({ filePath: "a.ts" }),
    chunk({ filePath: "a.ts", startLine: 20 }),
    chunk({ filePath: "b.ts" }),
  ]);
  assert.equal(r.filesRepresented, 2);
});

test("3. distinct source counting (deduped)", () => {
  const r = buildRetrievalDebugReport([
    chunk({ filePath: "a.ts", source: "semantic" }),
    chunk({ filePath: "b.ts", source: "semantic" }),
    chunk({ filePath: "c.ts", source: "keyword" }),
  ]);
  assert.deepEqual(r.sourcesRepresented, ["keyword", "semantic"]);
});

test("4. confidence aggregation equals scoreContextConfidence", () => {
  const finalChunks = [
    chunk({ filePath: "a.ts", signals: { semantic: 0.8 } }),
    chunk({ filePath: "b.ts", signals: { keyword: 0.6 } }),
  ];
  const r = buildRetrievalDebugReport(finalChunks);
  assert.equal(r.averageConfidence, scoreContextConfidence(finalChunks).confidence);
});

test("5. statistics propagation + default fallback", () => {
  const withStats = buildRetrievalDebugReport([chunk()], STATS);
  assert.equal(withStats.totalChunksBeforeRerank, 12);
  assert.equal(withStats.totalChunksAfterRerank, 8);
  assert.equal(withStats.duplicateChunksRemoved, 3);
  assert.equal(withStats.boostedChunks, 4);
  assert.equal(withStats.crossFileBoostedChunks, 2);
  assert.equal(withStats.totalChunksAfterBudget, 1); // always finalChunks.length

  const noStats = buildRetrievalDebugReport([chunk(), chunk({ filePath: "b.ts" })]);
  assert.equal(noStats.totalChunksBeforeRerank, 2); // falls back to length
  assert.equal(noStats.totalChunksAfterRerank, 2);
  assert.equal(noStats.duplicateChunksRemoved, 0);
  assert.equal(noStats.boostedChunks, 0);
  assert.equal(noStats.crossFileBoostedChunks, 0);
});

test("6. deterministic repeated execution", () => {
  const finalChunks = [
    chunk({ filePath: "a.ts", source: "keyword", signals: { keyword: 0.4 } }),
    chunk({ filePath: "b.ts", source: "graph", signals: { graph: 0.9 } }),
  ];
  assert.deepEqual(
    buildRetrievalDebugReport(finalChunks, STATS),
    buildRetrievalDebugReport(finalChunks, STATS),
  );
});

test("7. input chunk array is not mutated", () => {
  const finalChunks = [chunk({ signals: { semantic: 0.5 } }), chunk({ filePath: "b.ts" })];
  const snapshot = finalChunks.map((c) => ({ ...c, signals: { ...c.signals } }));
  buildRetrievalDebugReport(finalChunks, STATS);
  assert.deepEqual(finalChunks, snapshot);
});

test("8. sourcesRepresented stably sorted regardless of input order", () => {
  const r = buildRetrievalDebugReport([
    chunk({ filePath: "a.ts", source: "symbol" }),
    chunk({ filePath: "b.ts", source: "file-search" }),
    chunk({ filePath: "c.ts", source: "graph" }),
    chunk({ filePath: "d.ts", source: "keyword" }),
  ]);
  assert.deepEqual(r.sourcesRepresented, ["file-search", "graph", "keyword", "symbol"]);
});
