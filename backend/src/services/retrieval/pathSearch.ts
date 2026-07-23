import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import { createDeadline } from "../../runtime/deadline.js";
import { retryDatabaseRead } from "../database/retryPolicy.js";
import { runtimeEmbeddingIndexConfiguration } from "../embeddings/indexVersion.js";
import type { KeywordSearchOptions } from "./keywordSearch.js";
import type { RetrievalResult } from "./types.js";

interface PathChunkRow {
  id?: string;
  repository: string;
  file_path: string;
  language: string;
  content: string;
  start_line: number;
  end_line: number;
}

function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9_.-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2))]
    .sort();
}

function pathScore(path: string, terms: readonly string[]): number {
  const normalized = path.toLowerCase();
  const segments = normalized.split("/");
  let score = 0;
  for (const term of terms) {
    if (normalized === term) score += 4;
    else if (segments.includes(term)) score += 3;
    else if (normalized.includes(term)) score += 1;
  }
  return score;
}

/** Filename/path-only retrieval constrained to the immutable published index view. */
export async function pathSearch(
  query: string,
  owner: string,
  repo: string,
  limit = 20,
  options: KeywordSearchOptions = {},
): Promise<RetrievalResult[]> {
  if (!options.repositoryVersion?.trim()) {
    throw new Error("Published repository revision is required for path search.");
  }
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const repository = `${owner}/${repo}`;
  const embeddingVersion = runtimeEmbeddingIndexConfiguration(
    repository,
    options.repositoryVersion,
  ).embeddingVersion;
  const filter = terms.map((term) => `file_path.ilike.%${term}%`).join(",");
  const deadline = createDeadline(env.DATABASE_REQUEST_TIMEOUT_MS, {
    parentSignal: options.signal,
  });
  try {
    const { data, error } = await retryDatabaseRead(
      () => {
        let databaseQuery = (options.databaseClient ?? supabase)
          .from("published_repository_chunks")
          .select("id,repository,file_path,language,content,start_line,end_line")
          .eq("repository", repository)
          .eq("repository_revision", options.repositoryVersion!)
          .eq("embedding_version", embeddingVersion);
        return databaseQuery.or(filter).limit(limit * 3).abortSignal(deadline.signal);
      },
      {
        deadline,
        operation: "path_search",
        requestId: options.requestId,
        logger: options.logger,
        metrics: options.metrics,
        retryRuntime: options.retryRuntime,
        circuitBreaker: options.circuitBreaker,
      },
    );
    if (deadline.signal.aborted) throw deadline.signal.reason;
    if (error) throw new Error("Path search failed.");
    const scored = ((data ?? []) as PathChunkRow[])
      .filter((row) => row.repository === repository)
      .map((row) => ({ row, score: pathScore(row.file_path, terms) }));
    const maximum = scored.reduce((max, item) => Math.max(max, item.score), 1);
    return scored
      .filter((item) => item.score > 0)
      .map(({ row, score }) => ({
        repository: row.repository,
        filePath: row.file_path,
        language: row.language,
        content: row.content,
        startLine: row.start_line,
        endLine: row.end_line,
        score: score / maximum,
        source: "keyword" as const,
        signals: { keyword: score / maximum },
        chunkId: row.id,
      }))
      .sort((left, right) =>
        right.score - left.score ||
        left.filePath.localeCompare(right.filePath) ||
        left.startLine - right.startLine)
      .slice(0, limit);
  } finally {
    deadline.dispose();
  }
}
