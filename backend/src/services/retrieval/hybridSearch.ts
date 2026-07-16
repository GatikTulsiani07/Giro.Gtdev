// Hybrid retrieval orchestrator: semantic + keyword + symbol + graph reranking.

import { logger } from "../../lib/logger.js";
import { semanticSearch } from "../embeddings/search.js";
import { analyzeRepoDependencies } from "../graph/index.js";
import { keywordSearch } from "./keywordSearch.js";
import { symbolSearch } from "./symbolSearch.js";
import { mergeAndRerank } from "./reranker.js";
import type {
  HybridSearchRequest,
  HybridSearchResponse,
  RetrievalResult,
} from "./types.js";
import { isDeadlineExceeded } from "../../runtime/deadline.js";
import { isDependencyUnavailable } from "../../runtime/circuitBreaker.js";
import { runtimeRetrievalCache } from "./cache/runtimeRetrievalCache.js";
import type { RetrievalCache } from "./cache/retrievalCache.js";
import { buildCitations, type CitationCandidate } from "./citations.js";
import { stitchRuntimeChunks } from "./stitching/runtimeChunkStitcher.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const FETCH_MULTIPLIER = 3;

export function resolveHybridSearchLimit(limit?: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT));
}

export function resolveHybridFetchLimit(limit?: number): number {
  return resolveHybridSearchLimit(limit) * FETCH_MULTIPLIER;
}

export interface HybridSearchOptions {
  signal?: AbortSignal;
  cache?: RetrievalCache;
  execute?: typeof executeHybridSearch;
}

export async function executeHybridSearch(
  request: HybridSearchRequest,
  options: { signal?: AbortSignal; repositoryVersion?: string } = {},
): Promise<HybridSearchResponse> {
  const { query, owner, repo } = request;
  const repository = `${owner}/${repo}`;
  const effectiveLimit = resolveHybridSearchLimit(request.limit);
  const fetchLimit = resolveHybridFetchLimit(request.limit);

  const [semanticSettled, keywordSettled, symbolSettled] = await Promise.allSettled([
    semanticSearch(query, fetchLimit, options),
    keywordSearch(query, owner, repo, fetchLimit, options),
    symbolSearch(query, owner, repo, fetchLimit),
  ]);

  let semantic: RetrievalResult[] = [];

  for (const settled of [semanticSettled, keywordSettled]) {
    if (
      settled.status === "rejected" &&
      (isDeadlineExceeded(settled.reason) || isDependencyUnavailable(settled.reason))
    ) throw settled.reason;
  }

  if (semanticSettled.status === "fulfilled") {
    semantic = semanticSettled.value
      .filter((r) => r.repository === repository)
      .map((r) => ({
        repository: r.repository,
        filePath: r.filePath,
        language: r.language,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
        score: r.similarity,
        source: "semantic" as const,
        signals: { semantic: r.similarity },
        chunkId: r.chunkId,
      }));
  } else {
    logger.error("semantic_search_failed", {
      repository,
      message: String(semanticSettled.reason),
    });
  }

  const keyword =
    keywordSettled.status === "fulfilled" ? keywordSettled.value : [];

  const symbol =
    symbolSettled.status === "fulfilled" ? symbolSettled.value : [];

  let graphNodes: Map<string, number> | null = null;

  try {
    const graph = await analyzeRepoDependencies(owner, repo);

    graphNodes = new Map(
      graph.nodes.map((node) => [
        node.filePath,
        node.centralityScore,
      ]),
    );
  } catch (err) {
    logger.warn("graph_signal_unavailable", {
      repository,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  const combined = [...semantic, ...keyword, ...symbol];

  const graphBoosted = graphNodes
    ? new Set(
        combined
          .filter((result) => graphNodes?.has(result.filePath))
          .map((result) => result.filePath),
      ).size
    : 0;

  const rankedPool = mergeAndRerank(
    combined,
    graphNodes,
    combined.length,
  );
  const primaryChunkCount = Math.min(effectiveLimit, rankedPool.length);
  const stitchingInputs = rankedPool.map((result) => ({
    repositoryId: repository,
    filePath: result.filePath,
    repositoryVersion: options.repositoryVersion ?? "unversioned",
    retrievalOperation: "hybrid",
    content: result.content,
    startLine: result.startLine,
    endLine: result.endLine,
    score: result.score,
    symbol: result.symbol,
    citations: [] as CitationCandidate[],
    result,
  }));
  const stitched = stitchRuntimeChunks(stitchingInputs, { primaryChunkCount });
  const results = stitched.chunks.map((block) => {
    const primary = block.primaryChunk as (typeof stitchingInputs)[number];
    return {
      ...primary.result,
      content: block.content,
      startLine: block.startLine,
      endLine: block.endLine,
    };
  });
  const citations = buildCitations(
    stitched.chunks.flatMap((block) => block.contributors.map((contributor) => {
      const original = contributor as (typeof stitchingInputs)[number];
      return {
        repositoryId: original.repositoryId,
        filePath: original.filePath,
        language: original.result.language,
        chunkId: original.result.chunkId,
        startLine: original.startLine,
        endLine: original.endLine,
        retrievalType: "hybrid" as const,
        score: original.score,
        symbol: original.symbol,
        repositoryVersion: original.repositoryVersion,
      };
    })),
    { surface: "hybrid" },
  );

  logger.info("hybrid_search_complete", {
    repository,
    semanticResults: semantic.length,
    keywordResults: keyword.length,
    symbolResults: symbol.length,
    graphBoosted,
    returned: results.length,
  });

  return {
    query,
    repository,
    results,
    citations,
    stats: {
      semanticResults: semantic.length,
      keywordResults: keyword.length,
      symbolResults: symbol.length,
      graphBoosted,
      returned: results.length,
    },
  };
}

export async function hybridSearch(
  request: HybridSearchRequest,
  options: HybridSearchOptions = {},
): Promise<HybridSearchResponse> {
  const effectiveLimit = resolveHybridSearchLimit(request.limit);
  const cache = options.cache ?? runtimeRetrievalCache;
  const cached = await cache.getOrLoad(
    {
      repositoryId: `${request.owner}/${request.repo}`,
      query: request.query,
      mode: "hybrid",
      limits: {
        requested: request.limit,
        effective: effectiveLimit,
        fetch: resolveHybridFetchLimit(request.limit),
      },
      selectedContext: null,
      options: {},
    },
    (signal, context) => (options.execute ?? executeHybridSearch)(request, {
      signal,
      repositoryVersion: context.repositoryVersion,
    }),
    { signal: options.signal },
  );
  const query = request.query;
  const repository = `${request.owner}/${request.repo}`;
  if (cached.query === query && cached.repository === repository) return cached;
  return Object.freeze({ ...cached, query, repository });
}
