import { supabase } from "../../lib/supabase.js";
import { generateEmbedding } from "./embedder.js";
import type { SemanticSearchResult } from "./types.js";
import { env } from "../../config/env.js";
import { createDeadline, DeadlineExceededError, isDeadlineExceeded } from "../../runtime/deadline.js";
import { retryDatabaseRead } from "../database/retryPolicy.js";
import type { RetryRuntimeOptions } from "../../runtime/retry.js";
import type { RetryLogger, RetryMetrics } from "../../observability/retryObservability.js";
import { isDependencyUnavailable, type CircuitBreaker } from "../../runtime/circuitBreaker.js";
import { buildCitations, type Citation } from "../retrieval/citations.js";

export interface SemanticSearchOptions {
  signal?: AbortSignal;
  requestId?: string;
  logger?: RetryLogger;
  metrics?: RetryMetrics;
  retryRuntime?: RetryRuntimeOptions;
  circuitBreaker?: CircuitBreaker;
}

export async function semanticSearch(
  query: string,
  limit: number = 10,
  options: SemanticSearchOptions = {},
): Promise<SemanticSearchResult[]> {
  const embedding = await generateEmbedding(query, options);
  const deadline = createDeadline(env.DATABASE_REQUEST_TIMEOUT_MS, { parentSignal: options.signal });

  try {
    const { data, error } = await retryDatabaseRead(
      () => supabase.rpc("match_repository_chunks", {
        query_embedding: embedding,
        match_count: limit,
      }).abortSignal(deadline.signal),
      {
        deadline,
        operation: "semantic_search",
        requestId: options.requestId,
        logger: options.logger,
        metrics: options.metrics,
        retryRuntime: options.retryRuntime,
        circuitBreaker: options.circuitBreaker,
      },
    );

    if (deadline.signal.aborted && isDeadlineExceeded(deadline.signal.reason)) throw new DeadlineExceededError();
    if (error) throw new Error("Semantic search failed.");

    if (!data || (data as unknown[]).length === 0) return [];

    return (data as Array<Record<string, unknown>>).map((row) => ({
      repository: row.repository as string,
      filePath: row.file_path as string,
      language: row.language as string,
      content: row.content as string,
      similarity: row.similarity as number,
      startLine: row.start_line as number,
      endLine: row.end_line as number,
      chunkId: typeof row.id === "string" ? row.id : undefined,
    }));
  } catch (error) {
    if (deadline.signal.aborted) throw deadline.signal.reason;
    if (isDeadlineExceeded(error) || isDependencyUnavailable(error)) throw error;
    throw new Error("Semantic search failed.");
  } finally {
    deadline.dispose();
  }
}

export async function semanticSearchWithCitations(
  query: string,
  limit: number = 10,
  options: SemanticSearchOptions & {
    repositoryVersion?: (repositoryId: string, signal?: AbortSignal) => Promise<string>;
  } = {},
): Promise<{ results: SemanticSearchResult[]; citations: Citation[] }> {
  const results = await semanticSearch(query, limit, options);
  const repositories = [...new Set(results.map((result) => result.repository))];
  const versions = new Map(
    await Promise.all(repositories.map(async (repositoryId) => [
      repositoryId,
      options.repositoryVersion
        ? await options.repositoryVersion(repositoryId, options.signal)
        : "unversioned",
    ] as const)),
  );
  const citations = buildCitations(results.map((result) => ({
    repositoryId: result.repository,
    filePath: result.filePath,
    language: result.language,
    chunkId: result.chunkId,
    startLine: result.startLine,
    endLine: result.endLine,
    retrievalType: "semantic",
    score: result.similarity,
    repositoryVersion: versions.get(result.repository) ?? "unversioned",
  })), { surface: "semantic" });
  return { results, citations };
}
