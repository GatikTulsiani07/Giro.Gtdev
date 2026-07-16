import type { RetrievalResult } from "../types.js";

export interface RankingWeights {
  semantic: number;
  keyword: number;
  symbol: number;
  graph: number;
  summary: number;
  entrypoint: number;
  stitchBonus: number;
  diversityBonus: number;
  duplicatePenalty: number;
}

export interface WeightedRankingCandidate {
  result: RetrievalResult;
  expandedScoreMultiplier: number;
  summaryRelevance?: number;
  entrypointImportance?: number;
  exportedSymbolImportance?: number;
  fileImportance?: number;
  adjacentStitchPotential?: number;
  citationConfidence?: number;
}

export interface RankingTrace {
  semanticScore: number;
  keywordScore: number;
  symbolScore: number;
  graphScore: number;
  summaryScore: number;
  entrypointScore: number;
  diversityBonus: number;
  duplicatePenalty: number;
  stitchBonus: number;
  expansionPenalty: number;
  finalScore: number;
}

export interface RankedCandidate {
  result: RetrievalResult;
  trace: RankingTrace;
  duplicateCount: number;
}

export interface WeightedRankingInput {
  candidates: readonly WeightedRankingCandidate[];
  weights: RankingWeights;
  limit: number;
}

export interface WeightedRankingResult {
  ranked: RankedCandidate[];
  inputCandidateCount: number;
  duplicateCount: number;
}

export interface RankingMetrics {
  incrementRankingOperations(count?: number): void;
  incrementRankingCandidates(count?: number): void;
  observeRankingDurationMs(milliseconds: number): void;
}

export interface RankingLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}
