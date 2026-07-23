import { normalizeRetrievalWeights } from "../../services/retrieval/hybridV2/config.js";
import type {
  HybridRetrievalSource,
  HybridRetrievalV2Config,
  HybridRetrievalWeights,
} from "../../services/retrieval/hybridV2/types.js";

export type EvaluationRerankerStrategy = "none" | "deterministic" | "external";

export interface RetrievalEvaluationConfiguration {
  id: string;
  description: string;
  sources: readonly HybridRetrievalSource[];
  retrieval: HybridRetrievalV2Config;
  rerankerStrategy: EvaluationRerankerStrategy;
}

const DEFAULT_WEIGHTS: HybridRetrievalWeights = normalizeRetrievalWeights({
  semanticSimilarity: 0.30,
  lexicalSimilarity: 0.18,
  symbolMatch: 0.12,
  pathSimilarity: 0.08,
  fileImportance: 0.08,
  repositoryImportance: 0.06,
  dependencyGraphImportance: 0.08,
  freshness: 0.04,
  revisionMatch: 0.06,
});

function configuration(
  id: string,
  description: string,
  overrides: Partial<Omit<RetrievalEvaluationConfiguration, "retrieval">> & {
    retrieval?: Partial<HybridRetrievalV2Config>;
  } = {},
): RetrievalEvaluationConfiguration {
  const rerankerStrategy = overrides.rerankerStrategy ?? "deterministic";
  return Object.freeze({
    id,
    description,
    sources: overrides.sources ?? (
      ["lexical", "semantic", "symbol", "path"] as const
    ),
    rerankerStrategy,
    retrieval: Object.freeze({
      weights: DEFAULT_WEIGHTS,
      maxChunks: 10,
      maxFiles: 8,
      maxSymbols: 8,
      maxTokens: 4_000,
      maxPerFile: 2,
      rerankerWeight: rerankerStrategy === "none" ? 0 : 0.25,
      rerankerProvider: rerankerStrategy === "external" ? "openai" : "deterministic",
      rerankerModel: rerankerStrategy === "external" ? "configured-external" : "evaluation-v1",
      ...overrides.retrieval,
    }),
  });
}

export const DEFAULT_RETRIEVAL_EVALUATION_CONFIGURATIONS:
readonly RetrievalEvaluationConfiguration[] = Object.freeze([
  configuration("lexical-only", "BM25-style lexical candidates only.", {
    sources: ["lexical"],
    rerankerStrategy: "none",
    retrieval: {
      weights: normalizeRetrievalWeights({
        semanticSimilarity: 0, lexicalSimilarity: 1, symbolMatch: 0, pathSimilarity: 0,
        fileImportance: 0, repositoryImportance: 0, dependencyGraphImportance: 0,
        freshness: 0, revisionMatch: 0,
      }),
    },
  }),
  configuration("semantic-only", "Deterministic semantic candidates only.", {
    sources: ["semantic"],
    rerankerStrategy: "none",
    retrieval: {
      weights: normalizeRetrievalWeights({
        semanticSimilarity: 1, lexicalSimilarity: 0, symbolMatch: 0, pathSimilarity: 0,
        fileImportance: 0, repositoryImportance: 0, dependencyGraphImportance: 0,
        freshness: 0, revisionMatch: 0,
      }),
    },
  }),
  configuration("hybrid-no-rerank", "All retrieval sources without cross-encoder reranking.", {
    rerankerStrategy: "none",
  }),
  configuration("hybrid-deterministic", "All retrieval sources with deterministic reranking."),
  configuration("hybrid-tight-budget", "Hybrid retrieval under a constrained context budget.", {
    retrieval: { maxChunks: 4, maxFiles: 4, maxSymbols: 4, maxTokens: 300 },
  }),
  configuration("hybrid-high-diversity", "Hybrid retrieval allowing one result per file.", {
    retrieval: { maxPerFile: 1, maxFiles: 10 },
  }),
]);

export function externalRetrievalEvaluationConfiguration(
  model: string,
): RetrievalEvaluationConfiguration {
  return configuration("hybrid-external-reranker", "Hybrid retrieval with configured external reranking.", {
    rerankerStrategy: "external",
    retrieval: {
      rerankerProvider: "openai",
      rerankerModel: model,
      rerankerWeight: 0.25,
    },
  });
}
