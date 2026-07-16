import assert from "node:assert/strict";
import { test } from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import { RetrievalCache } from "../services/retrieval/cache/retrievalCache.js";
import { buildRetrievalPipeline } from "../services/retrieval/retrievalPipeline.js";
import { stitchAdjacentChunks } from "../services/retrieval/stitching/adjacentChunkStitcher.js";
import { stitchRuntimeChunks } from "../services/retrieval/stitching/runtimeChunkStitcher.js";
import type { StitchableChunk } from "../services/retrieval/stitching/stitchingTypes.js";

type TestCitation = { chunkId: string; startLine: number; endLine: number };
type LogEntry = { event: string; fields?: Record<string, unknown> };

function chunk(
  startLine: number,
  endLine: number,
  overrides: Partial<StitchableChunk<TestCitation>> = {},
): StitchableChunk<TestCitation> {
  return {
    repositoryId: "acme/widgets",
    filePath: "src/widgets.ts",
    repositoryVersion: "v1",
    retrievalOperation: "hybrid:request-1",
    content: Array.from(
      { length: endLine - startLine + 1 },
      (_, index) => `line ${startLine + index}`,
    ).join("\n"),
    startLine,
    endLine,
    score: 1 - startLine / 100,
    symbol: `symbol${startLine}`,
    citations: [{ chunkId: `chunk-${startLine}`, startLine, endLine }],
    ...overrides,
  };
}

test("single chunk remains unchanged and records its provenance", () => {
  const input = chunk(1, 3);
  const result = stitchAdjacentChunks([input], { configuredLineGap: 0 });

  assert.equal(result.stitchCount, 0);
  assert.equal(result.chunksMerged, 0);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0]?.content, input.content);
  assert.deepEqual(result.chunks[0]?.contributors, [input]);
});

test("adjacent chunks merge in line order while primary ranking remains authoritative", () => {
  const higherRanked = chunk(4, 6, { score: 0.99, symbol: "higherRanked" });
  const earlierLines = chunk(1, 3, { score: 0.8, symbol: "earlierLines" });
  const result = stitchAdjacentChunks([higherRanked, earlierLines], {
    configuredLineGap: 0,
  });

  assert.equal(result.stitchCount, 1);
  assert.equal(result.chunksMerged, 2);
  assert.equal(result.chunks[0]?.startLine, 1);
  assert.equal(result.chunks[0]?.endLine, 6);
  assert.equal(result.chunks[0]?.score, 0.99);
  assert.equal(result.chunks[0]?.symbol, "higherRanked");
  assert.deepEqual(result.chunks[0]?.symbols, ["earlierLines", "higherRanked"]);
  assert.deepEqual(result.chunks[0]?.retrievalScores, [0.8, 0.99]);
  assert.match(result.chunks[0]?.content ?? "", /^line 1/);
});

test("three adjacent chunks form one deterministic stitched block", () => {
  const result = stitchAdjacentChunks([chunk(5, 6), chunk(1, 2), chunk(3, 4)], {
    configuredLineGap: 0,
  });

  assert.equal(result.chunks.length, 1);
  assert.equal(result.stitchCount, 1);
  assert.equal(result.chunksMerged, 3);
  assert.deepEqual(
    result.chunks[0]?.contributors.map((contributor) => contributor.startLine),
    [1, 3, 5],
  );
});

test("configured gap includes near neighbors and rejects chunks beyond it", () => {
  const accepted = stitchAdjacentChunks([chunk(1, 2), chunk(5, 6)], {
    configuredLineGap: 2,
  });
  const rejected = stitchAdjacentChunks([chunk(1, 2), chunk(5, 6)], {
    configuredLineGap: 1,
  });

  assert.equal(accepted.chunks.length, 1);
  assert.equal(rejected.chunks.length, 2);
});

test("only adjacent candidates enrich authoritative primary chunks", () => {
  const primary = chunk(10, 12, { score: 1 });
  const adjacentNeighbor = chunk(13, 15, { score: 0.2 });
  const unrelatedCandidate = chunk(30, 32, { score: 0.1 });
  const result = stitchAdjacentChunks(
    [primary, adjacentNeighbor, unrelatedCandidate],
    { configuredLineGap: 0, primaryChunkCount: 1 },
  );

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0]?.primaryChunk, primary);
  assert.deepEqual(
    result.chunks[0]?.contributors.map((contributor) => contributor.startLine),
    [10, 13],
  );
  assert.equal(result.chunks[0]?.contributors.includes(unrelatedCandidate), false);
});

test("different files, versions, repositories, and retrieval operations never stitch", () => {
  const candidates = [
    chunk(1, 2),
    chunk(3, 4, { filePath: "src/other.ts" }),
    chunk(3, 4, { repositoryVersion: "v2" }),
    chunk(3, 4, { repositoryId: "other/widgets" }),
    chunk(3, 4, { retrievalOperation: "hybrid:request-2" }),
  ];
  const result = stitchAdjacentChunks(candidates, { configuredLineGap: 0 });

  assert.equal(result.chunks.length, candidates.length);
  assert.equal(result.stitchCount, 0);
});

test("every contributing citation is retained without widening its range", () => {
  const result = stitchAdjacentChunks([chunk(10, 12), chunk(13, 15)], {
    configuredLineGap: 0,
  });

  assert.deepEqual(result.chunks[0]?.citations, [
    { chunkId: "chunk-10", startLine: 10, endLine: 12 },
    { chunkId: "chunk-13", startLine: 13, endLine: 15 },
  ]);
});

test("stitched blocks are trimmed before assembly and full budget drops are counted", () => {
  const metrics = new MetricsRegistry();
  const logger = { info: () => undefined };
  const candidates = [
    { filePath: "src/a.ts", content: "12345", score: 0.9, startLine: 1, endLine: 1, repositoryVersion: "v1" },
    { filePath: "src/a.ts", content: "67890", score: 0.8, startLine: 2, endLine: 2, repositoryVersion: "v1" },
  ];
  const trimmed = buildRetrievalPipeline(candidates, {
    repositoryId: "acme/widgets",
    repositoryVersion: "v1",
    minScore: 0,
    maxCandidates: 2,
    maxCharacters: 7,
    stitchingLineGap: 0,
    stitchingMetrics: metrics,
    stitchingLogger: logger,
  });
  assert.equal(trimmed.chunkCount, 1);
  assert.match(trimmed.content, /12345\n6/);

  const dropped = buildRetrievalPipeline(candidates, {
    repositoryId: "acme/widgets",
    repositoryVersion: "v1",
    minScore: 0,
    maxCandidates: 2,
    maxCharacters: 0,
    stitchingLineGap: 0,
    stitchingMetrics: metrics,
    stitchingLogger: logger,
  });
  assert.equal(dropped.chunkCount, 0);
  assert.match(metrics.render(), /giro_stitch_budget_drops_total 1/);
});

test("retrieval cache stores and replays stitched results unchanged", async () => {
  const metrics = new MetricsRegistry();
  const cache = new RetrievalCache({
    ttlMs: 1_000,
    maxEntries: 2,
    metrics,
    logger: { info: () => undefined },
  });
  let loads = 0;
  const key = { repositoryId: "acme/widgets", query: "widgets", mode: "hybrid" };
  const loader = async () => {
    loads += 1;
    return stitchAdjacentChunks([chunk(1, 2), chunk(3, 4)], {
      configuredLineGap: 0,
    });
  };
  const first = await cache.getOrLoad(key, loader);
  const cached = await cache.getOrLoad(key, loader);

  assert.equal(loads, 1);
  assert.strictEqual(cached, first);
  assert.equal(cached.chunks.length, 1);
  assert.equal(Object.isFrozen(cached.chunks[0]?.citations), true);
});

test("runtime metrics and safe structured logs describe completed and skipped stitching", () => {
  const metrics = new MetricsRegistry();
  const logs: LogEntry[] = [];
  const logger = { info: (event: string, fields?: Record<string, unknown>) => logs.push({ event, fields }) };
  const secretContent = "private source text";
  stitchRuntimeChunks([
    chunk(1, 2, { content: secretContent }),
    chunk(3, 4),
  ], { configuredLineGap: 0, metrics, logger });
  stitchRuntimeChunks([chunk(20, 21)], { configuredLineGap: 0, metrics, logger });

  const rendered = metrics.render();
  assert.match(rendered, /giro_chunk_stitches_total 1/);
  assert.match(rendered, /giro_chunks_merged_total 2/);
  assert.match(rendered, /giro_stitch_budget_drops_total 0/);
  assert.deepEqual(logs.map((entry) => entry.event), [
    "chunk_stitch_started",
    "chunk_stitch_completed",
    "chunk_stitch_started",
    "chunk_stitch_skipped",
  ]);
  assert.equal(JSON.stringify(logs).includes(secretContent), false);
  assert.equal(JSON.stringify(logs).includes("src/widgets.ts"), false);
});
