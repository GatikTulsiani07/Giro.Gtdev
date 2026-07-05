// Frontend-friendly retrieval explainability summary. Pure metadata
// transformation only: no ranking changes, no persistence, no AI, no I/O, no
// timestamps, and no randomness. Inputs are never mutated.

import type { EnrichedContextChunk } from "../context/contextTypes.js";
import type { RetrievalResult, RetrievalSource } from "./types.js";

export type RetrievalExplainabilitySummarySource =
  | RetrievalSource
  | "fileSearch";

export interface RetrievalExplainabilitySourceBreakdown {
  semantic: number;
  keyword: number;
  symbol: number;
  graph: number;
  fileSearch: number;
}

export interface RetrievalExplainabilityTopFile {
  filePath: string;
  resultCount: number;
  maxScore: number;
  dominantSource?: RetrievalExplainabilitySummarySource;
}

export interface RetrievalExplainabilitySignal {
  source: RetrievalExplainabilitySummarySource;
  filePath: string;
  score: number;
}

export interface RetrievalExplainabilitySummary {
  totalResults: number;
  sourceBreakdown: RetrievalExplainabilitySourceBreakdown;
  topFiles: RetrievalExplainabilityTopFile[];
  strongestSignals: RetrievalExplainabilitySignal[];
  warnings: string[];
  explanation: string[];
}

type SourceInput = RetrievalResult["source"] | EnrichedContextChunk["source"];
type SignalInput = Partial<
  RetrievalResult["signals"] & EnrichedContextChunk["signals"]
>;

export interface RetrievalExplainabilitySummaryInput {
  filePath: string;
  score?: number;
  source?: SourceInput;
  signals?: SignalInput;
}

const SOURCES: RetrievalExplainabilitySummarySource[] = [
  "semantic",
  "keyword",
  "symbol",
  "graph",
  "fileSearch",
];

function emptyBreakdown(): RetrievalExplainabilitySourceBreakdown {
  return {
    semantic: 0,
    keyword: 0,
    symbol: 0,
    graph: 0,
    fileSearch: 0,
  };
}

function normalizeSource(
  source: SourceInput | undefined,
): RetrievalExplainabilitySummarySource | undefined {
  if (source === "file-search") return "fileSearch";
  if (source === "semantic" || source === "keyword" || source === "symbol" || source === "graph") {
    return source;
  }
  return undefined;
}

function signalValue(
  signals: SignalInput | undefined,
  source: RetrievalExplainabilitySummarySource,
): number {
  const value = signals?.[source];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resultScore(result: RetrievalExplainabilitySummaryInput): number {
  return typeof result.score === "number" && Number.isFinite(result.score)
    ? result.score
    : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function sourceRank(source: RetrievalExplainabilitySummarySource): number {
  return SOURCES.indexOf(source);
}

function hasPositiveSignal(signals: SignalInput | undefined): boolean {
  return SOURCES.some((source) => signalValue(signals, source) > 0);
}

function buildExplanation(
  totalResults: number,
  fileCount: number,
  topFile: RetrievalExplainabilityTopFile | undefined,
  strongestSignal: RetrievalExplainabilitySignal | undefined,
): string[] {
  if (totalResults === 0) {
    return ["No retrieval results were selected."];
  }

  const explanation = [
    `Retrieved ${totalResults} result(s) across ${fileCount} file(s).`,
  ];

  if (topFile) {
    explanation.push(
      `Top file ${topFile.filePath} contributed ${topFile.resultCount} result(s).`,
    );
  }

  if (strongestSignal) {
    explanation.push(
      `Strongest signal was ${strongestSignal.source} for ${strongestSignal.filePath}.`,
    );
  }

  return explanation;
}

export function buildRetrievalExplainabilitySummary(
  results: readonly RetrievalExplainabilitySummaryInput[],
): RetrievalExplainabilitySummary {
  const sourceBreakdown = emptyBreakdown();
  const fileStats = new Map<
    string,
    {
      resultCount: number;
      maxScore: number;
      sourceCounts: RetrievalExplainabilitySourceBreakdown;
    }
  >();
  const strongestSignals: RetrievalExplainabilitySignal[] = [];

  let missingSignals = false;
  let missingSources = false;

  for (const result of results) {
    const normalizedSource = normalizeSource(result.source);
    if (normalizedSource) {
      sourceBreakdown[normalizedSource] += 1;
    } else {
      missingSources = true;
    }

    if (!hasPositiveSignal(result.signals)) {
      missingSignals = true;
    }

    const current = fileStats.get(result.filePath) ?? {
      resultCount: 0,
      maxScore: 0,
      sourceCounts: emptyBreakdown(),
    };

    current.resultCount += 1;
    current.maxScore = Math.max(current.maxScore, resultScore(result));
    if (normalizedSource) current.sourceCounts[normalizedSource] += 1;
    fileStats.set(result.filePath, current);

    for (const source of SOURCES) {
      const score = signalValue(result.signals, source);
      if (score > 0) {
        strongestSignals.push({
          source,
          filePath: result.filePath,
          score: round3(score),
        });
      }
    }
  }

  const topFiles: RetrievalExplainabilityTopFile[] = [...fileStats.entries()]
    .map(([filePath, stats]) => {
      const dominantSource = SOURCES
        .filter((source) => stats.sourceCounts[source] > 0)
        .sort(
          (a, b) =>
            stats.sourceCounts[b] - stats.sourceCounts[a] ||
            sourceRank(a) - sourceRank(b),
        )[0];

      return {
        filePath,
        resultCount: stats.resultCount,
        maxScore: round3(stats.maxScore),
        dominantSource,
      };
    })
    .sort(
      (a, b) =>
        b.resultCount - a.resultCount ||
        b.maxScore - a.maxScore ||
        a.filePath.localeCompare(b.filePath),
    );

  strongestSignals.sort(
    (a, b) =>
      b.score - a.score ||
      a.filePath.localeCompare(b.filePath) ||
      sourceRank(a.source) - sourceRank(b.source),
  );

  const warnings: string[] = [];
  if (results.length === 0) warnings.push("No retrieval results available.");
  if (missingSources) warnings.push("Some results did not include a known retrieval source.");
  if (missingSignals) warnings.push("Some results did not include positive retrieval signals.");

  return {
    totalResults: results.length,
    sourceBreakdown,
    topFiles,
    strongestSignals,
    warnings,
    explanation: buildExplanation(
      results.length,
      fileStats.size,
      topFiles[0],
      strongestSignals[0],
    ),
  };
}
