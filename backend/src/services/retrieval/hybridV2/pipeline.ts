import type { CrossEncoder } from "./crossEncoder.js";
import { rerankWithFallback, runtimeCrossEncoder } from "./crossEncoder.js";
import { mergeRetrievalCandidates } from "./candidateMerger.js";
import { computeStructuralSignals } from "./structuralSignals.js";
import { applyRerankerScores, scoreRetrievalCandidates } from "./scoring.js";
import { diversifyRetrievalCandidates } from "./diversity.js";
import { optimizeRetrievalBudget } from "./budgetOptimizer.js";
import {
  runtimeHybridRetrievalV2Config,
  validateHybridRetrievalV2Config,
} from "./config.js";
import type {
  HybridRetrievalDiagnostics,
  HybridRetrievalPipelineInput,
  HybridRetrievalV2Config,
} from "./types.js";
import { candidateKey } from "./types.js";
import type { RetrievalResult } from "../types.js";
import { logger } from "../../../lib/logger.js";
import { runtimeMetrics } from "../../../observability/metrics.js";

export interface HybridRetrievalPipelineOutput {
  results: RetrievalResult[];
  diagnostics: HybridRetrievalDiagnostics;
}

export async function executeHybridRetrievalV2(
  input: HybridRetrievalPipelineInput,
  options: {
    config?: HybridRetrievalV2Config;
    crossEncoder?: CrossEncoder;
    signal?: AbortSignal;
  } = {},
): Promise<HybridRetrievalPipelineOutput> {
  const startedAt = performance.now();
  const config = options.config ?? runtimeHybridRetrievalV2Config;
  validateHybridRetrievalV2Config(config);
  logger.info("hybrid_retrieval_v2_started", {
    candidateCount: Math.min(1_000_000, input.candidates.length),
    repositoryCount: input.repositoryId.trim() ? 1 : 0,
  });
  const diagnostics: HybridRetrievalDiagnostics = {
    candidateCounts: {
      lexical: input.candidates.filter((candidate) => candidate.source === "lexical").length,
      semantic: input.candidates.filter((candidate) => candidate.source === "semantic").length,
      symbol: input.candidates.filter((candidate) => candidate.source === "symbol").length,
      path: input.candidates.filter((candidate) => candidate.source === "path").length,
      merged: 0,
      reranked: 0,
      returned: 0,
    },
    candidates: [],
    diversityDecisions: [],
    discardedCandidates: [],
    tokenUsage: { used: 0, maximum: config.maxTokens },
  };
  const merged = mergeRetrievalCandidates(
    input.candidates.filter((candidate) =>
      candidate.result.repository === input.repositoryId),
    input.expansionMultiplier ?? 0.85,
    diagnostics,
  );
  diagnostics.candidateCounts.merged = merged.length;
  const structurallyScored = computeStructuralSignals(
    merged,
    input.artifacts?.repositoryRevision === input.repositoryRevision
      ? input.artifacts
      : null,
    input.repositoryRevision,
  );
  const scored = scoreRetrievalCandidates(structurallyScored, config.weights);
  const rerankerScores = await rerankWithFallback(
    options.crossEncoder ?? runtimeCrossEncoder,
    { query: input.query, candidates: scored, signal: options.signal },
  );
  const reranked = applyRerankerScores(scored, rerankerScores, config.rerankerWeight);
  diagnostics.candidateCounts.reranked = reranked.length;
  diagnostics.candidates = reranked.map((candidate) => ({
    key: candidateKey(candidate),
    retrievalSources: [...candidate.sources].sort(),
    lexicalScore: candidate.signals.lexicalSimilarity,
    semanticScore: candidate.signals.semanticSimilarity,
    rerankerScore: candidate.rerankerScore,
  }));
  const diversified = diversifyRetrievalCandidates(reranked, config.maxPerFile, diagnostics);
  const selected = optimizeRetrievalBudget(diversified, config, input.limit, diagnostics);
  diagnostics.candidateCounts.returned = selected.length;
  const durationMs = Math.min(60_000, Math.max(0, performance.now() - startedAt));
  runtimeMetrics.incrementRankingOperations();
  runtimeMetrics.incrementRankingCandidates(input.candidates.length);
  runtimeMetrics.observeRankingDurationMs(durationMs);
  logger.info("hybrid_retrieval_v2_completed", {
    candidateCount: Math.min(1_000_000, input.candidates.length),
    mergedCount: Math.min(1_000_000, merged.length),
    returnedCount: Math.min(1_000_000, selected.length),
    discardedCount: Math.min(1_000_000, diagnostics.discardedCandidates.length),
    tokenCount: Math.min(1_000_000, diagnostics.tokenUsage.used),
    durationMs: Math.round(durationMs),
  });
  return {
    results: selected.map((candidate) => candidate.result),
    diagnostics,
  };
}
