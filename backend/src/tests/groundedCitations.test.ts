import assert from "node:assert/strict";
import { test } from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import { buildContextCitations } from "../services/context/enrichedAssembler.js";
import {
  buildCitations,
  repositoryRelativePath,
  type CitationCandidate,
} from "../services/retrieval/citations.js";
import { RetrievalCache } from "../services/retrieval/cache/retrievalCache.js";
import { assembleAnswer } from "../services/sessions/answerAssembler.js";
import type { Citation as LegacyCitation } from "../services/sessions/types.js";

type LogEntry = { event: string; fields?: Record<string, unknown> };

const base: CitationCandidate = {
  repositoryId: "acme/widgets",
  filePath: "src/widgets.ts",
  language: "typescript",
  chunkId: "chunk-1",
  startLine: 10,
  endLine: 18,
  retrievalType: "semantic",
  score: 0.91,
  symbol: "createWidget",
  repositoryVersion: "job-1:1:completed:completed:100",
};

function observedBuild(candidates: CitationCandidate[]) {
  const metrics = new MetricsRegistry();
  const logs: LogEntry[] = [];
  const citations = buildCitations(candidates, {
    surface: "hybrid",
    metrics,
    logger: { info: (event, fields) => logs.push({ event, fields }) },
  });
  return { citations, metrics, logs };
}

test("builds a single complete grounded citation with exact line and version metadata", () => {
  const { citations } = observedBuild([base]);
  assert.deepEqual(citations, [{
    repositoryId: "acme/widgets",
    relativeFilePath: "src/widgets.ts",
    language: "typescript",
    chunkId: "chunk-1",
    startLine: 10,
    endLine: 18,
    retrievalType: "semantic",
    score: 0.91,
    symbol: "createWidget",
    repositoryVersion: "job-1:1:completed:completed:100",
  }]);
});

test("normalizes repository storage paths and excludes unsafe absolute paths", () => {
  assert.equal(
    repositoryRelativePath(
      "/srv/app/.storage/repos/acme--widgets/src/widgets.ts",
      "acme/widgets",
    ),
    "src/widgets.ts",
  );
  assert.equal(repositoryRelativePath("/etc/passwd", "acme/widgets"), null);
  assert.equal(repositoryRelativePath("../secrets.ts", "acme/widgets"), null);

  const { citations } = observedBuild([
    { ...base, filePath: "/etc/passwd" },
    { ...base, filePath: "/srv/app/.storage/repos/acme--widgets/src/widgets.ts" },
  ]);
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.relativeFilePath, "src/widgets.ts");
});

test("merges duplicate locations and orders by score, file, then line", () => {
  const { citations, metrics, logs } = observedBuild([
    base,
    { ...base, retrievalType: "keyword", score: 0.97, symbol: undefined },
    { ...base, filePath: "src/a.ts", chunkId: "a-20", startLine: 20, endLine: 22, score: 0.8 },
    { ...base, filePath: "src/a.ts", chunkId: "a-2", startLine: 2, endLine: 4, score: 0.8 },
    { ...base, filePath: "src/b.ts", chunkId: "b-1", startLine: 1, endLine: 3, score: 0.8 },
  ]);

  assert.equal(citations.length, 4);
  assert.equal(citations[0]?.retrievalType, "keyword");
  assert.equal(citations[0]?.symbol, "createWidget");
  assert.deepEqual(citations.slice(1).map((citation) => [
    citation.relativeFilePath,
    citation.startLine,
  ]), [["src/a.ts", 2], ["src/a.ts", 20], ["src/b.ts", 1]]);
  assert.match(metrics.render(), /giro_citations_generated_total 1/);
  assert.match(metrics.render(), /giro_citation_chunks_total 4/);
  assert.match(metrics.render(), /giro_citation_merge_total 1/);
  assert.deepEqual(logs.map((entry) => entry.event), [
    "citations_generated",
    "citations_merged",
  ]);
  assert.equal(JSON.stringify(logs).includes("src/widgets.ts"), false);
});

test("empty retrieval returns an immutable empty citation array", () => {
  const { citations } = observedBuild([]);
  assert.deepEqual(citations, []);
  assert.equal(Object.isFrozen(citations), true);
});

test("citation arrays and entries are immutable", () => {
  const { citations } = observedBuild([base]);
  assert.equal(Object.isFrozen(citations), true);
  assert.equal(Object.isFrozen(citations[0]), true);
  assert.throws(() => citations.push({ ...citations[0]! }));
  assert.throws(() => { citations[0]!.score = 0; });
});

test("retrieval cache preserves identical citations and replaces them after version invalidation", async () => {
  let version = "v1";
  const metrics = new MetricsRegistry();
  const cache = new RetrievalCache({
    ttlMs: 10_000,
    maxEntries: 10,
    metrics,
    logger: { info: () => undefined },
    versionProvider: () => version,
  });
  let loads = 0;
  const load = (_signal: AbortSignal, context: { repositoryVersion: string }) => {
    loads += 1;
    return Promise.resolve({
      citations: buildCitations([
        { ...base, repositoryVersion: context.repositoryVersion },
      ], { surface: "hybrid", metrics, logger: { info: () => undefined } }),
    });
  };
  const key = {
    repositoryId: base.repositoryId,
    query: "find widgets",
    mode: "hybrid",
  };

  const first = await cache.getOrLoad(key, load);
  const cached = await cache.getOrLoad(key, load);
  assert.strictEqual(cached, first);
  assert.equal(cached.citations[0]?.repositoryVersion, "v1");
  version = "v2";
  const refreshed = await cache.getOrLoad(key, load);
  assert.equal(loads, 2);
  assert.notStrictEqual(refreshed, first);
  assert.equal(refreshed.citations[0]?.repositoryVersion, "v2");
});

test("repository context generation cites only finalized context chunks", () => {
  const citations = buildContextCitations("acme/widgets", [{
    filePath: "src/final.ts",
    language: "typescript",
    content: "export const final = true;",
    startLine: 3,
    endLine: 3,
    score: 0.82,
    source: "keyword",
    signals: { keyword: 0.82 },
    chunkId: "final-3",
  }], "v-context");
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.relativeFilePath, "src/final.ts");
  assert.equal(citations[0]?.repositoryVersion, "v-context");
});

test("session answer integration emits grounded citations and no fabricated citations", () => {
  const contextCitations = buildContextCitations("acme/widgets", [{
    filePath: "src/answer.ts",
    language: "typescript",
    content: "export const answer = 42;",
    startLine: 7,
    endLine: 7,
    score: 0.99,
    source: "semantic",
    signals: { semantic: 0.99 },
    chunkId: "answer-7",
  }], "v-session");
  const context = {
    query: "answer",
    repository: "acme/widgets",
    totalChunks: 1,
    estimatedTokens: 10,
    context: [{
      filePath: "src/answer.ts",
      language: "typescript",
      content: "export const answer = 42;",
      startLine: 7,
      endLine: 7,
      score: 0.99,
      source: "semantic" as const,
      signals: { semantic: 0.99 },
      chunkId: "answer-7",
      repositoryVersion: "v-session",
    }],
    citations: contextCitations,
    stats: {
      hybridResults: 1,
      fileSearchResults: 0,
      deduplicatedCount: 0,
      finalCount: 1,
      sourceCounts: { semantic: 1, keyword: 0, symbol: 0, graph: 0, fileSearch: 0 },
    },
  };
  const answer = assembleAnswer("answer", context, [], {
    available: false,
    framework: "unknown",
    primaryLanguage: "unknown",
    entrypoints: [],
    centralModules: [],
  });
  assert.equal(answer.citations[0]?.chunkId, "answer-7");
  assert.equal(answer.citations[0]?.repositoryVersion, "v-session");

  const empty = assembleAnswer("nothing", { ...context, totalChunks: 0, context: [], citations: [] }, [], {
    available: false,
    framework: "unknown",
    primaryLanguage: "unknown",
    entrypoints: [],
    centralModules: [],
  });
  assert.deepEqual(empty.citations, []);
});

test("legacy session citation shape remains assignable for backward compatibility", () => {
  const legacy: LegacyCitation = {
    filePath: "src/legacy.ts",
    startLine: 1,
    endLine: 2,
    snippet: "legacy",
  };
  assert.deepEqual(legacy, {
    filePath: "src/legacy.ts",
    startLine: 1,
    endLine: 2,
    snippet: "legacy",
  });
});
