import type { RetrievalSignals } from "../types.js";
import { validateRankingWeights } from "./rankingWeights.js";
import type {
  RankedCandidate,
  RankingTrace,
  WeightedRankingCandidate,
  WeightedRankingInput,
  WeightedRankingResult,
} from "./rankingTypes.js";

interface MergedCandidate extends WeightedRankingCandidate {
  duplicateCount: number;
}

function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function locationKey(candidate: WeightedRankingCandidate): string {
  const { result } = candidate;
  return JSON.stringify([result.repository, result.filePath, result.startLine, result.endLine]);
}

function strongestSignal(signals: RetrievalSignals): number {
  return Math.max(
    clamp01(signals.semantic),
    clamp01(signals.keyword),
    clamp01(signals.symbol),
    clamp01(signals.graph),
  );
}

function mergeSignals(target: RetrievalSignals, source: RetrievalSignals): void {
  for (const key of ["semantic", "keyword", "symbol", "graph"] as const) {
    const incoming = source[key];
    if (incoming !== undefined && clamp01(incoming) > clamp01(target[key])) {
      target[key] = incoming;
    }
  }
}

function mergeCandidates(
  candidates: readonly WeightedRankingCandidate[],
): { candidates: MergedCandidate[]; duplicateCount: number } {
  const merged = new Map<string, MergedCandidate>();
  let duplicateCount = 0;

  for (const candidate of candidates) {
    const key = locationKey(candidate);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...candidate,
        result: { ...candidate.result, signals: { ...candidate.result.signals } },
        duplicateCount: 1,
      });
      continue;
    }

    duplicateCount += 1;
    existing.duplicateCount += 1;
    const incomingStrength = strongestSignal(candidate.result.signals);
    const existingStrength = strongestSignal(existing.result.signals);
    mergeSignals(existing.result.signals, candidate.result.signals);
    if (incomingStrength > existingStrength) {
      existing.result.content = candidate.result.content;
      existing.result.source = candidate.result.source;
      existing.result.language = candidate.result.language;
      existing.result.chunkId = candidate.result.chunkId ?? existing.result.chunkId;
    }
    existing.result.symbol ??= candidate.result.symbol;
    existing.expandedScoreMultiplier = Math.max(
      existing.expandedScoreMultiplier,
      candidate.expandedScoreMultiplier,
    );
    existing.summaryRelevance = Math.max(
      clamp01(existing.summaryRelevance),
      clamp01(candidate.summaryRelevance),
    );
    existing.entrypointImportance = Math.max(
      clamp01(existing.entrypointImportance),
      clamp01(candidate.entrypointImportance),
    );
    existing.exportedSymbolImportance = Math.max(
      clamp01(existing.exportedSymbolImportance),
      clamp01(candidate.exportedSymbolImportance),
    );
    existing.fileImportance = Math.max(
      clamp01(existing.fileImportance),
      clamp01(candidate.fileImportance),
    );
    existing.adjacentStitchPotential = Math.max(
      clamp01(existing.adjacentStitchPotential),
      clamp01(candidate.adjacentStitchPotential),
    );
    existing.citationConfidence = Math.max(
      clamp01(existing.citationConfidence),
      clamp01(candidate.citationConfidence),
    );
  }

  return { candidates: [...merged.values()], duplicateCount };
}

function traceForCandidate(
  candidate: MergedCandidate,
  fileFrequency: ReadonlyMap<string, number>,
  input: WeightedRankingInput,
): RankingTrace {
  const signals = candidate.result.signals;
  const semantic = clamp01(signals.semantic);
  const keyword = clamp01(signals.keyword);
  const directSymbol = clamp01(signals.symbol);
  const graph = clamp01(signals.graph);
  const evidence = Math.max(semantic, keyword, directSymbol);
  const exportedContribution = clamp01(candidate.exportedSymbolImportance) * evidence * 0.5;
  const normalizedSymbol = Math.max(directSymbol, exportedContribution);
  const normalizedSummary = Math.max(
    clamp01(candidate.summaryRelevance),
    clamp01(candidate.fileImportance),
    clamp01(candidate.citationConfidence) * 0.25,
  );
  const normalizedEntrypoint = clamp01(candidate.entrypointImportance);
  const normalizedStitch = clamp01(candidate.adjacentStitchPotential);
  const frequency = Math.max(1, fileFrequency.get(candidate.result.filePath) ?? 1);
  const normalizedDiversity = 1 / frequency;
  const normalizedDuplicate = Math.min(1, Math.max(0, candidate.duplicateCount - 1) / 3);

  const semanticScore = semantic * input.weights.semantic;
  const keywordScore = keyword * input.weights.keyword;
  const symbolScore = normalizedSymbol * input.weights.symbol;
  const graphScore = graph * input.weights.graph;
  const summaryScore = normalizedSummary * input.weights.summary;
  const entrypointScore = normalizedEntrypoint * input.weights.entrypoint;
  const stitchBonus = normalizedStitch * input.weights.stitchBonus;
  const diversityBonus = normalizedDiversity * input.weights.diversityBonus;
  const duplicatePenalty = normalizedDuplicate * input.weights.duplicatePenalty;
  const positiveScore = semanticScore + keywordScore + symbolScore + graphScore +
    summaryScore + entrypointScore + stitchBonus + diversityBonus;
  const expansionMultiplier = clamp01(candidate.expandedScoreMultiplier);
  const expansionPenalty = positiveScore * (1 - expansionMultiplier);
  const finalScore = round6(clamp01(positiveScore - expansionPenalty - duplicatePenalty));

  return Object.freeze({
    semanticScore: round6(semanticScore),
    keywordScore: round6(keywordScore),
    symbolScore: round6(symbolScore),
    graphScore: round6(graphScore),
    summaryScore: round6(summaryScore),
    entrypointScore: round6(entrypointScore),
    diversityBonus: round6(diversityBonus),
    duplicatePenalty: round6(duplicatePenalty),
    stitchBonus: round6(stitchBonus),
    expansionPenalty: round6(expansionPenalty),
    finalScore,
  });
}

export function rankWeightedHybridCandidates(
  input: WeightedRankingInput,
): WeightedRankingResult {
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    throw new TypeError("ranking limit must be a non-negative integer");
  }
  const weights = validateRankingWeights(input.weights);
  const normalizedInput = { ...input, weights };
  const merged = mergeCandidates(input.candidates);
  const fileFrequency = new Map<string, number>();
  for (const candidate of merged.candidates) {
    const path = candidate.result.filePath;
    fileFrequency.set(path, (fileFrequency.get(path) ?? 0) + 1);
  }

  const ranked: RankedCandidate[] = merged.candidates.map((candidate) => {
    const trace = traceForCandidate(candidate, fileFrequency, normalizedInput);
    return {
      result: { ...candidate.result, signals: { ...candidate.result.signals }, score: trace.finalScore },
      trace,
      duplicateCount: candidate.duplicateCount,
    };
  });
  ranked.sort((left, right) =>
    right.result.score - left.result.score ||
    left.result.filePath.localeCompare(right.result.filePath) ||
    left.result.startLine - right.result.startLine ||
    left.result.endLine - right.result.endLine ||
    (left.result.chunkId ?? "").localeCompare(right.result.chunkId ?? "")
  );

  return {
    ranked: ranked.slice(0, input.limit),
    inputCandidateCount: input.candidates.length,
    duplicateCount: merged.duplicateCount,
  };
}
