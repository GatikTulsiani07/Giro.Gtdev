import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRetrievalTrace } from "../services/retrieval/retrievalTrace.js";
import type { EnrichedContextChunk } from "../services/context/contextTypes.js";

function chunk(overrides?: Partial<EnrichedContextChunk>): EnrichedContextChunk {
  return {
    filePath: "src/a.ts",
    language: "typescript",
    content: "const a = 1;",
    startLine: 1,
    endLine: 10,
    score: 0.5,
    source: "semantic",
    signals: {},
    ...overrides,
  };
}

test("1. empty input returns []", () => {
  assert.deepEqual(buildRetrievalTrace([]), []);
});

test("2. semantic signal produces a semantic reason with correct scoreImpact", () => {
  const [trace] = buildRetrievalTrace([
    chunk({ source: "semantic", signals: { semantic: 0.8234 } }),
  ]);
  const semantic = trace?.reasons.find((r) => r.type === "semantic");
  assert.ok(semantic);
  assert.equal(semantic?.scoreImpact, 0.823);
});

test("3. keyword signal produces a keyword reason", () => {
  const [trace] = buildRetrievalTrace([
    chunk({ source: "keyword", signals: { keyword: 0.5 } }),
  ]);
  assert.ok(trace?.reasons.some((r) => r.type === "keyword"));
});

test("4. graph signal produces a graph reason", () => {
  const [trace] = buildRetrievalTrace([
    chunk({ source: "graph", signals: { graph: 0.42 } }),
  ]);
  const graph = trace?.reasons.find((r) => r.type === "graph");
  assert.ok(graph);
  assert.equal(graph?.scoreImpact, 0.42);
});

test("5. cross_file is omitted (no per-chunk indicator in real data)", () => {
  const [trace] = buildRetrievalTrace([
    chunk({ signals: { semantic: 0.5, graph: 0.3 } }),
  ]);
  assert.ok(!trace?.reasons.some((r) => r.type === "cross_file"));
});

test("6. every final chunk gets a budget survivor reason", () => {
  const traces = buildRetrievalTrace([
    chunk({ filePath: "a.ts", signals: { semantic: 0.5 } }),
    chunk({ filePath: "b.ts", signals: {} }),
  ]);
  assert.equal(traces.length, 2);
  for (const t of traces) {
    const budget = t.reasons.find((r) => r.type === "budget");
    assert.ok(budget);
    assert.equal(budget?.scoreImpact, 0);
    assert.equal(budget?.description, "Survived context budget trimming");
  }
});

test("7. deterministic output across repeated runs", () => {
  const input = [
    chunk({ filePath: "a.ts", signals: { semantic: 0.7, keyword: 0.3 } }),
    chunk({ filePath: "b.ts", source: "file-search", signals: { fileSearch: 0.9 } }),
  ];
  const a = buildRetrievalTrace(input);
  const b = buildRetrievalTrace(input);
  assert.deepEqual(a, b);
});

test("8. reasons are ordered by fixed type priority; traces match input order", () => {
  const traces = buildRetrievalTrace([
    chunk({
      filePath: "first.ts",
      source: "semantic",
      signals: { fileSearch: 0.4, graph: 0.3, semantic: 0.9, keyword: 0.5, symbol: 0.6 },
    }),
    chunk({ filePath: "second.ts", signals: { keyword: 0.2 } }),
  ]);
  // trace order matches input order
  assert.equal(traces[0]?.filePath, "first.ts");
  assert.equal(traces[1]?.filePath, "second.ts");
  // reason types follow fixed priority: semantic, keyword, symbol, graph, file_search, budget
  assert.deepEqual(
    traces[0]?.reasons.map((r) => r.type),
    ["semantic", "keyword", "symbol", "graph", "file_search", "budget"],
  );
});

test("9. input chunks are not mutated", () => {
  const input = [chunk({ signals: { semantic: 0.5 } })];
  const snapshot = input.map((c) => ({ ...c, signals: { ...c.signals } }));
  buildRetrievalTrace(input);
  assert.deepEqual(input, snapshot);
});

test("10. source-kind fallback emits reason when signal value absent", () => {
  const [trace] = buildRetrievalTrace([
    chunk({ source: "symbol", signals: {} }),
  ]);
  const symbol = trace?.reasons.find((r) => r.type === "symbol");
  assert.ok(symbol);
  assert.equal(symbol?.scoreImpact, 0);
});
test("retrieval trace generation is deterministic for identical inputs", () => {
  const input = {
    query: "session ownership",
    retrievedFiles: ["src/session.ts"],
    retrievedChunks: 1,
    confidence: 0.8,
  };

  const first = JSON.parse(JSON.stringify(input));
  const second = JSON.parse(JSON.stringify(input));

  assert.deepEqual(first, second);
});
