import { describe, expect, it } from "vitest";
import {
  buildRetrievalExplainabilitySummary,
  type RetrievalExplainabilitySummaryInput,
} from "../services/retrieval/retrievalExplainabilitySummary.js";

function result(
  overrides: Partial<RetrievalExplainabilitySummaryInput> = {},
): RetrievalExplainabilitySummaryInput {
  return {
    filePath: "src/a.ts",
    score: 0.5,
    source: "semantic",
    signals: { semantic: 0.5 },
    ...overrides,
  };
}

describe("buildRetrievalExplainabilitySummary", () => {
  it("1. empty results summary", () => {
    expect(buildRetrievalExplainabilitySummary([])).toEqual({
      totalResults: 0,
      sourceBreakdown: {
        semantic: 0,
        keyword: 0,
        symbol: 0,
        graph: 0,
        fileSearch: 0,
      },
      topFiles: [],
      strongestSignals: [],
      warnings: ["No retrieval results available."],
      explanation: ["No retrieval results were selected."],
    });
  });

  it("2. source breakdown counts dominant sources", () => {
    const summary = buildRetrievalExplainabilitySummary([
      result({ source: "semantic", signals: { semantic: 0.7 } }),
      result({ source: "keyword", signals: { keyword: 0.6 } }),
      result({ source: "symbol", signals: { symbol: 0.5 } }),
      result({ source: "graph", signals: { graph: 0.4 } }),
      result({ source: "file-search", signals: { fileSearch: 0.3 } }),
    ]);

    expect(summary.sourceBreakdown).toEqual({
      semantic: 1,
      keyword: 1,
      symbol: 1,
      graph: 1,
      fileSearch: 1,
    });
  });

  it("3. top file aggregation is deterministic", () => {
    const summary = buildRetrievalExplainabilitySummary([
      result({ filePath: "src/b.ts", score: 0.9, source: "keyword", signals: { keyword: 0.9 } }),
      result({ filePath: "src/a.ts", score: 0.7, source: "semantic", signals: { semantic: 0.7 } }),
      result({ filePath: "src/a.ts", score: 0.4, source: "graph", signals: { graph: 0.4 } }),
    ]);

    expect(summary.topFiles).toEqual([
      {
        filePath: "src/a.ts",
        resultCount: 2,
        maxScore: 0.7,
        dominantSource: "semantic",
      },
      {
        filePath: "src/b.ts",
        resultCount: 1,
        maxScore: 0.9,
        dominantSource: "keyword",
      },
    ]);
  });

  it("4. dominant source uses per-file source majority", () => {
    const summary = buildRetrievalExplainabilitySummary([
      result({ filePath: "src/a.ts", source: "keyword", signals: { keyword: 0.2 } }),
      result({ filePath: "src/a.ts", source: "keyword", signals: { keyword: 0.4 } }),
      result({ filePath: "src/a.ts", source: "semantic", signals: { semantic: 0.9 } }),
    ]);

    expect(summary.topFiles[0]?.dominantSource).toBe("keyword");
  });

  it("5. strongest signals are ordered by score, file path, then source", () => {
    const summary = buildRetrievalExplainabilitySummary([
      result({
        filePath: "src/b.ts",
        source: "semantic",
        signals: { semantic: 0.8, keyword: 0.2 },
      }),
      result({
        filePath: "src/a.ts",
        source: "keyword",
        signals: { keyword: 0.8, graph: 0.7 },
      }),
      result({
        filePath: "src/a.ts",
        source: "symbol",
        signals: { symbol: 0.8 },
      }),
    ]);

    expect(summary.strongestSignals.slice(0, 4)).toEqual([
      { source: "keyword", filePath: "src/a.ts", score: 0.8 },
      { source: "symbol", filePath: "src/a.ts", score: 0.8 },
      { source: "semantic", filePath: "src/b.ts", score: 0.8 },
      { source: "graph", filePath: "src/a.ts", score: 0.7 },
    ]);
  });

  it("6. missing signals do not crash and produce a warning", () => {
    const summary = buildRetrievalExplainabilitySummary([
      result({ signals: undefined }),
      result({ filePath: "src/b.ts", signals: {} }),
    ]);

    expect(summary.totalResults).toBe(2);
    expect(summary.strongestSignals).toEqual([]);
    expect(summary.warnings).toContain("Some results did not include positive retrieval signals.");
  });

  it("7. deterministic repeated output", () => {
    const input = [
      result({ filePath: "src/b.ts", score: 0.6, source: "keyword", signals: { keyword: 0.6 } }),
      result({ filePath: "src/a.ts", score: 0.9, source: "semantic", signals: { semantic: 0.9 } }),
    ];

    expect(buildRetrievalExplainabilitySummary(input)).toEqual(
      buildRetrievalExplainabilitySummary(input),
    );
  });

  it("8. input results are not mutated", () => {
    const input = [
      result({
        filePath: "src/a.ts",
        score: 0.9,
        source: "semantic",
        signals: { semantic: 0.9, graph: 0.1 },
      }),
    ];
    const snapshot = input.map((item) => ({
      ...item,
      signals: item.signals ? { ...item.signals } : item.signals,
    }));

    buildRetrievalExplainabilitySummary(input);

    expect(input).toEqual(snapshot);
  });
});
