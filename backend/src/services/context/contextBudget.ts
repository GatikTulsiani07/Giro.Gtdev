// Deterministic context budget limiting for the retrieval pipeline.
//
// Determinism contract:
// - stable sort: score desc → filePath asc → startLine asc
// - highest-score duplicate always survives
// - same input + same budget = identical output
// - no timestamps
// - no randomness
// - no UUIDs

import type { EnrichedContextChunk } from "./contextTypes.js";

export const DEFAULT_MAX_CHUNKS = 8;
export const DEFAULT_MAX_TOKENS = 3500;
export const TOKEN_CHAR_RATIO = 4;

export interface ContextBudgetOptions {
  maxChunks?: number;
  maxEstimatedTokens?: number;
}

export interface ContextBudgetResult {
  selected: EnrichedContextChunk[];
  dropped: EnrichedContextChunk[];
  estimatedTokens: number;
}

function estimateTokens(content: string): number {
  if (typeof content !== "string" || content.length === 0) return 0;
  return Math.ceil(content.length / TOKEN_CHAR_RATIO);
}

function sortChunksDeterministically(
  chunks: EnrichedContextChunk[],
): EnrichedContextChunk[] {
  return [...chunks].sort((a, b) => {
    const scoreA = a.score ?? 0;
    const scoreB = b.score ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const pathA = a.filePath ?? "";
    const pathB = b.filePath ?? "";
    const pathCmp = pathA.localeCompare(pathB);
    if (pathCmp !== 0) return pathCmp;
    return (a.startLine ?? 0) - (b.startLine ?? 0);
  });
}

function deduplicateChunks(
  chunks: EnrichedContextChunk[],
): EnrichedContextChunk[] {
  const seen = new Set<string>();
  const out: EnrichedContextChunk[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.filePath ?? ""}:${chunk.startLine ?? 0}:${chunk.endLine ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

export async function trimContextToBudget(
  chunks: EnrichedContextChunk[],
  options?: ContextBudgetOptions,
): Promise<ContextBudgetResult> {
  const maxChunks = options?.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxTokens = options?.maxEstimatedTokens ?? DEFAULT_MAX_TOKENS;

  if (chunks.length === 0) {
    return { selected: [], dropped: [], estimatedTokens: 0 };
  }

  const ordered = deduplicateChunks(sortChunksDeterministically(chunks));

  const selected: EnrichedContextChunk[] = [];
  const dropped: EnrichedContextChunk[] = [];
  let estimatedTokens = 0;

  for (const chunk of ordered) {
    const chunkTokens = estimateTokens(chunk.content);

    // Oversized first chunk: always include at least one chunk.
    if (selected.length === 0) {
      selected.push(chunk);
      estimatedTokens += chunkTokens;
      continue;
    }

    if (selected.length >= maxChunks || estimatedTokens + chunkTokens > maxTokens) {
      dropped.push(chunk);
      continue;
    }

    selected.push(chunk);
    estimatedTokens += chunkTokens;
  }

  return { selected, dropped, estimatedTokens };
}
