import type { RetrievalResult } from "../../services/retrieval/types.js";
import type { RetrievalBenchmarkCase } from "./schema.js";

export interface RetrievalQualityMetrics {
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
  fileLevelRecall: number;
  symbolLevelRecall: number;
  duplicateRate: number;
  fileDiversity: number;
  tokenEfficiency: number;
  relevantTokensPerTotalTokens: number;
  latencyMs: number;
  rerankerFailureRate: number;
  rerankerFallbackRate: number;
}

export interface MetricRuntimeInput {
  latencyMs?: number;
  rerankerAttempts?: number;
  rerankerFailures?: number;
  rerankerFallbacks?: number;
}

export function estimateEvaluationTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function relevanceGain(
  result: RetrievalResult,
  benchmark: RetrievalBenchmarkCase,
): number {
  if (result.chunkId && benchmark.expectedRelevantChunks.includes(result.chunkId)) return 3;
  if (result.symbol && benchmark.expectedRelevantSymbols
    .map(normalized).includes(normalized(result.symbol))) return 2;
  if (benchmark.expectedRelevantFiles.includes(result.filePath)) return 1;
  return 0;
}

function relevantUniverseSize(benchmark: RetrievalBenchmarkCase): number {
  if (benchmark.expectedRelevantChunks.length > 0) {
    return benchmark.expectedRelevantChunks.length;
  }
  if (benchmark.expectedRelevantSymbols.length > 0) {
    return benchmark.expectedRelevantSymbols.length;
  }
  return benchmark.expectedRelevantFiles.length;
}

function relevanceIdentity(
  result: RetrievalResult,
  benchmark: RetrievalBenchmarkCase,
): string | null {
  if (benchmark.excludedFiles.includes(result.filePath)) return null;
  if (benchmark.expectedRelevantChunks.length > 0) {
    return result.chunkId && benchmark.expectedRelevantChunks.includes(result.chunkId)
      ? `chunk:${result.chunkId}`
      : null;
  }
  if (benchmark.expectedRelevantSymbols.length > 0) {
    const symbol = result.symbol ? normalized(result.symbol) : "";
    return symbol && benchmark.expectedRelevantSymbols.map(normalized).includes(symbol)
      ? `symbol:${symbol}`
      : null;
  }
  return benchmark.expectedRelevantFiles.includes(result.filePath)
    ? `file:${result.filePath}`
    : null;
}

function isRelevant(
  result: RetrievalResult,
  benchmark: RetrievalBenchmarkCase,
): boolean {
  if (benchmark.excludedFiles.includes(result.filePath)) return false;
  if (benchmark.expectedRelevantChunks.length > 0) {
    return Boolean(result.chunkId && benchmark.expectedRelevantChunks.includes(result.chunkId));
  }
  if (benchmark.expectedRelevantSymbols.length > 0) {
    return Boolean(result.symbol && benchmark.expectedRelevantSymbols
      .map(normalized).includes(normalized(result.symbol)));
  }
  return benchmark.expectedRelevantFiles.includes(result.filePath);
}

function discountedCumulativeGain(gains: readonly number[]): number {
  return gains.reduce((total, gain, index) =>
    total + gain / Math.log2(index + 2), 0);
}

export function computeRetrievalMetrics(
  benchmark: RetrievalBenchmarkCase,
  results: readonly RetrievalResult[],
  k: number,
  runtime: MetricRuntimeInput = {},
): RetrievalQualityMetrics {
  const cutoff = Math.max(1, Math.trunc(k));
  const ranked = results.slice(0, cutoff);
  const relevance = ranked.map((result) => isRelevant(result, benchmark));
  const relevantCount = relevance.filter(Boolean).length;
  const uniqueRelevantCount = new Set(ranked.flatMap((result) => {
    const identity = relevanceIdentity(result, benchmark);
    return identity ? [identity] : [];
  })).size;
  const universe = relevantUniverseSize(benchmark);
  const firstRelevant = relevance.findIndex(Boolean);
  const seenRelevance = new Set<string>();
  const gains = ranked.map((result) => {
    const identity = relevanceIdentity(result, benchmark);
    if (!identity || seenRelevance.has(identity)) return 0;
    seenRelevance.add(identity);
    return relevanceGain(result, benchmark);
  });
  const idealGains = (
    benchmark.expectedRelevantChunks.length > 0
      ? benchmark.expectedRelevantChunks.map(() => 3)
      : benchmark.expectedRelevantSymbols.length > 0
        ? benchmark.expectedRelevantSymbols.map(() => 2)
        : benchmark.expectedRelevantFiles.map(() => 1)
  ).slice(0, cutoff);
  const idealDcg = discountedCumulativeGain(idealGains);
  const files = new Set(ranked.map((result) => result.filePath));
  const expectedFiles = new Set(benchmark.expectedRelevantFiles);
  const matchedFiles = new Set(ranked
    .filter((result) => expectedFiles.has(result.filePath))
    .map((result) => result.filePath));
  const expectedSymbols = new Set(benchmark.expectedRelevantSymbols.map(normalized));
  const matchedSymbols = new Set(ranked
    .flatMap((result) => result.symbol ? [normalized(result.symbol)] : [])
    .filter((symbol) => expectedSymbols.has(symbol)));
  const totalTokens = ranked.reduce(
    (total, result) => total + estimateEvaluationTokens(result.content),
    0,
  );
  const relevantTokens = ranked.reduce(
    (total, result) => total +
      (isRelevant(result, benchmark) ? estimateEvaluationTokens(result.content) : 0),
    0,
  );
  const duplicateKeys = ranked.map((result) =>
    result.chunkId ?? `${result.filePath}\u0000${result.startLine}\u0000${result.endLine}`);
  const duplicateCount = duplicateKeys.length - new Set(duplicateKeys).size;
  const attempts = runtime.rerankerAttempts ?? 0;

  return {
    recallAtK: universe > 0 ? uniqueRelevantCount / universe : 0,
    precisionAtK: relevantCount / cutoff,
    mrr: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
    ndcgAtK: idealDcg > 0 ? discountedCumulativeGain(gains) / idealDcg : 0,
    fileLevelRecall: expectedFiles.size > 0 ? matchedFiles.size / expectedFiles.size : 0,
    symbolLevelRecall: expectedSymbols.size > 0 ? matchedSymbols.size / expectedSymbols.size : 1,
    duplicateRate: ranked.length > 0 ? duplicateCount / ranked.length : 0,
    fileDiversity: ranked.length > 0 ? files.size / ranked.length : 0,
    tokenEfficiency: totalTokens > 0 ? relevantCount * 1_000 / totalTokens : 0,
    relevantTokensPerTotalTokens: totalTokens > 0 ? relevantTokens / totalTokens : 0,
    latencyMs: Math.max(0, runtime.latencyMs ?? 0),
    rerankerFailureRate: attempts > 0 ? (runtime.rerankerFailures ?? 0) / attempts : 0,
    rerankerFallbackRate: attempts > 0 ? (runtime.rerankerFallbacks ?? 0) / attempts : 0,
  };
}

export function aggregateRetrievalMetrics(
  metrics: readonly RetrievalQualityMetrics[],
): RetrievalQualityMetrics {
  const keys = Object.keys({
    recallAtK: 0,
    precisionAtK: 0,
    mrr: 0,
    ndcgAtK: 0,
    fileLevelRecall: 0,
    symbolLevelRecall: 0,
    duplicateRate: 0,
    fileDiversity: 0,
    tokenEfficiency: 0,
    relevantTokensPerTotalTokens: 0,
    latencyMs: 0,
    rerankerFailureRate: 0,
    rerankerFallbackRate: 0,
  }) as Array<keyof RetrievalQualityMetrics>;
  const divisor = Math.max(1, metrics.length);
  return Object.fromEntries(keys.map((key) => [
    key,
    metrics.reduce((total, item) => total + item[key], 0) / divisor,
  ])) as unknown as RetrievalQualityMetrics;
}
