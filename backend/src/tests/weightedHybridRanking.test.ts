import assert from "node:assert/strict";
import { test } from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import { RetrievalCache, buildRetrievalCacheKey } from "../services/retrieval/cache/retrievalCache.js";
import {
  rankRuntimeHybridCandidates,
  recordRuntimeRankingCacheHit,
} from "../services/retrieval/ranking/runtimeWeightedRanker.js";
import type {
  RankingWeights,
  WeightedRankingCandidate,
} from "../services/retrieval/ranking/rankingTypes.js";
import { rankWeightedHybridCandidates } from "../services/retrieval/ranking/weightedHybridRanker.js";
import type { RetrievalResult } from "../services/retrieval/types.js";

type LogEntry = { event: string; fields?: Record<string, unknown> };

const ZERO_WEIGHTS: RankingWeights = {
  semantic: 0,
  keyword: 0,
  symbol: 0,
  graph: 0,
  summary: 0,
  entrypoint: 0,
  stitchBonus: 0,
  diversityBonus: 0,
  duplicatePenalty: 0,
};

function result(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    repository: "acme/widgets",
    filePath: "src/a.ts",
    language: "typescript",
    content: "export const value = true;",
    startLine: 1,
    endLine: 2,
    score: 0,
    source: "semantic",
    signals: {},
    chunkId: "a-1",
    ...overrides,
  };
}

function candidate(overrides: Partial<WeightedRankingCandidate> = {}): WeightedRankingCandidate {
  return {
    result: result(),
    expandedScoreMultiplier: 1,
    summaryRelevance: 0,
    entrypointImportance: 0,
    exportedSymbolImportance: 0,
    fileImportance: 0,
    adjacentStitchPotential: 0,
    citationConfidence: 0,
    ...overrides,
  };
}

function rankOne(
  rankingCandidate: WeightedRankingCandidate,
  weights: Partial<RankingWeights>,
) {
  return rankWeightedHybridCandidates({
    candidates: [rankingCandidate],
    weights: { ...ZERO_WEIGHTS, ...weights },
    limit: 1,
  }).ranked[0]!;
}

test("semantic, keyword, symbol, and graph signals use their calibrated weights", () => {
  const signals = { semantic: 0.8, keyword: 0.6, symbol: 0.4, graph: 0.2 };
  assert.equal(rankOne(candidate({ result: result({ signals }) }), { semantic: 1 }).result.score, 0.8);
  assert.equal(rankOne(candidate({ result: result({ signals }) }), { keyword: 1 }).result.score, 0.6);
  assert.equal(rankOne(candidate({ result: result({ signals }) }), { symbol: 1 }).result.score, 0.4);
  assert.equal(rankOne(candidate({ result: result({ signals }) }), { graph: 1 }).result.score, 0.2);
});

test("repository summary and entrypoint importance are weighted independently", () => {
  const summary = rankOne(candidate({ summaryRelevance: 0.75 }), { summary: 0.4 });
  const entrypoint = rankOne(candidate({ entrypointImportance: 0.5 }), { entrypoint: 0.6 });
  assert.equal(summary.trace.summaryScore, 0.3);
  assert.equal(summary.result.score, 0.3);
  assert.equal(entrypoint.trace.entrypointScore, 0.3);
  assert.equal(entrypoint.result.score, 0.3);
});

test("exported symbols, file importance, and citation confidence calibrate existing weighted signals", () => {
  const exported = rankOne(candidate({
    result: result({ signals: { semantic: 0.8 } }),
    exportedSymbolImportance: 1,
  }), { symbol: 1 });
  const importantFile = rankOne(candidate({ fileImportance: 1 }), { summary: 1 });
  const grounded = rankOne(candidate({ citationConfidence: 1 }), { summary: 1 });

  assert.equal(exported.trace.symbolScore, 0.4);
  assert.equal(importantFile.trace.summaryScore, 1);
  assert.equal(grounded.trace.summaryScore, 0.25);
});

test("query expansion penalty proportionally lowers only expanded candidates", () => {
  const primary = rankOne(candidate({
    result: result({ signals: { semantic: 1 } }),
    expandedScoreMultiplier: 1,
  }), { semantic: 1 });
  const expanded = rankOne(candidate({
    result: result({ signals: { semantic: 1 } }),
    expandedScoreMultiplier: 0.85,
  }), { semantic: 1 });
  assert.equal(primary.result.score, 1);
  assert.equal(expanded.trace.expansionPenalty, 0.15);
  assert.equal(expanded.result.score, 0.85);
});

test("duplicate suppression merges signals and applies a bounded penalty", () => {
  const ranking = rankWeightedHybridCandidates({
    candidates: [
      candidate({ result: result({ signals: { semantic: 1 } }) }),
      candidate({ result: result({ source: "keyword", signals: { keyword: 1 } }) }),
    ],
    weights: { ...ZERO_WEIGHTS, semantic: 0.5, keyword: 0.5, duplicatePenalty: 0.3 },
    limit: 5,
  });
  assert.equal(ranking.ranked.length, 1);
  assert.equal(ranking.duplicateCount, 1);
  assert.equal(ranking.ranked[0]?.trace.duplicatePenalty, 0.1);
  assert.equal(ranking.ranked[0]?.result.score, 0.9);
});

test("adjacent stitch and retrieval diversity bonuses improve rank deterministically", () => {
  const stitched = rankOne(candidate({ adjacentStitchPotential: 1 }), { stitchBonus: 0.2 });
  assert.equal(stitched.trace.stitchBonus, 0.2);
  assert.equal(stitched.result.score, 0.2);

  const ranking = rankWeightedHybridCandidates({
    candidates: [
      candidate({ result: result({ filePath: "src/a.ts", startLine: 1, endLine: 2 }) }),
      candidate({ result: result({ filePath: "src/a.ts", startLine: 10, endLine: 12, chunkId: "a-10" }) }),
      candidate({ result: result({ filePath: "src/b.ts", chunkId: "b-1" }) }),
    ],
    weights: { ...ZERO_WEIGHTS, diversityBonus: 0.2 },
    limit: 3,
  });
  assert.equal(ranking.ranked[0]?.result.filePath, "src/b.ts");
  assert.equal(ranking.ranked[0]?.trace.diversityBonus, 0.2);
});

test("all signals normalize to zero through one and missing values degrade gracefully", () => {
  const high = rankOne(candidate({
    result: result({ signals: { semantic: 100, keyword: Number.POSITIVE_INFINITY } }),
  }), { semantic: 1, keyword: 1 });
  const low = rankOne(candidate({
    result: result({ signals: { semantic: -100 } }),
  }), { semantic: 1 });
  assert.equal(high.trace.semanticScore, 1);
  assert.equal(high.trace.keywordScore, 0);
  assert.equal(high.result.score, 1);
  assert.equal(low.result.score, 0);
});

test("ranking and stable tie ordering are deterministic without input mutation", () => {
  const candidates = [
    candidate({ result: result({ filePath: "src/b.ts", chunkId: "b" }) }),
    candidate({ result: result({ filePath: "src/a.ts", chunkId: "a" }) }),
  ];
  const before = structuredClone(candidates);
  const input = { candidates, weights: { ...ZERO_WEIGHTS }, limit: 2 };
  const first = rankWeightedHybridCandidates(input);
  const second = rankWeightedHybridCandidates(input);
  assert.deepEqual(second, first);
  assert.deepEqual(first.ranked.map((item) => item.result.filePath), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(candidates, before);
});

test("ranking cache keys include weights and retain repository version invalidation", async () => {
  const base = {
    repositoryId: "acme/widgets",
    query: "find widgets",
    mode: "hybrid",
    repositoryVersion: "v1",
  };
  assert.notEqual(
    buildRetrievalCacheKey({ ...base, options: { rankingWeights: { semantic: 0.3 } } }),
    buildRetrievalCacheKey({ ...base, options: { rankingWeights: { semantic: 0.4 } } }),
  );

  let version = "v1";
  let loads = 0;
  const metrics = new MetricsRegistry();
  const cache = new RetrievalCache({
    ttlMs: 10_000,
    maxEntries: 5,
    metrics,
    logger: { info: () => undefined },
    versionProvider: () => version,
  });
  const key = { ...base, options: { rankingWeights: ZERO_WEIGHTS } };
  const loader = async () => ({ load: ++loads });
  await cache.getOrLoad(key, loader);
  await cache.getOrLoad(key, loader);
  version = "v2";
  await cache.getOrLoad(key, loader);
  assert.equal(loads, 2);
});

test("runtime metrics and logging use bounded counts and never expose candidate data", () => {
  const metrics = new MetricsRegistry();
  const logs: LogEntry[] = [];
  const rankingLogger = {
    info: (event: string, fields?: Record<string, unknown>) => logs.push({ event, fields }),
  };
  let now = 100;
  rankRuntimeHybridCandidates({
    repositoryId: "acme/widgets",
    repositoryVersion: "unversioned",
    candidates: [{
      result: result({ filePath: "src/private/customer.ts", content: "private source" }),
      isExpanded: false,
    }],
    graphNodes: null,
    expandedScoreMultiplier: 0.85,
    limit: 1,
  }, {
    metrics,
    logger: rankingLogger,
    weights: { ...ZERO_WEIGHTS, semantic: 1 },
    now: () => { const value = now; now += 12; return value; },
  });
  recordRuntimeRankingCacheHit(1, { logger: rankingLogger });

  const output = metrics.render();
  assert.match(output, /giro_ranking_operations_total 1/);
  assert.match(output, /giro_ranking_candidates_total 1/);
  assert.match(output, /giro_ranking_duration_ms 12/);
  assert.deepEqual(logs.map((entry) => entry.event), [
    "ranking_started",
    "ranking_completed",
    "ranking_cache_hit",
  ]);
  assert.equal(JSON.stringify(logs).includes("src/private"), false);
  assert.equal(JSON.stringify(logs).includes("private source"), false);
  assert.equal(JSON.stringify(logs).includes("acme/widgets"), false);
});
