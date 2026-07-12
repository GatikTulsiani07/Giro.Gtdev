import { supabase } from "../../lib/supabase.js";
import { generateEmbedding } from "./embedder.js";
import type { SemanticSearchResult } from "./types.js";
import { env } from "../../config/env.js";
import { createDeadline, DeadlineExceededError, isDeadlineExceeded } from "../../runtime/deadline.js";
import { retryDatabaseRead } from "../database/retryPolicy.js";
import type { RetryRuntimeOptions } from "../../runtime/retry.js";
import type { RetryLogger, RetryMetrics } from "../../observability/retryObservability.js";

export async function semanticSearch(
  query: string,
  limit: number = 10,
  options: {
    signal?: AbortSignal;
    requestId?: string;
    logger?: RetryLogger;
    metrics?: RetryMetrics;
    retryRuntime?: RetryRuntimeOptions;
  } = {},
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
    }));
  } catch (error) {
    if (deadline.signal.aborted) throw deadline.signal.reason;
    if (isDeadlineExceeded(error)) throw error;
    throw new Error("Semantic search failed.");
  } finally {
    deadline.dispose();
  }
}
