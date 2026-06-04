// Deterministic retrieval trace metadata. Explains why each surviving chunk was
// selected, derived strictly from real per-chunk signals + source + budget
// survival. No AI, no randomness, no timestamps. Inputs are never mutated.

import type { EnrichedContextChunk } from "../context/contextTypes.js";
import type { RerankStatistics } from "./qualityReranker.js";

export interface RetrievalReason {
  type:
    | "semantic"
    | "keyword"
    | "symbol"
    | "graph"
    | "cross_file"
    | "file_search"
    | "rerank"
    | "budget";
  scoreImpact: number;
  description: string;
}

export interface RetrievalTrace {
  filePath: string;
  startLine: number;
  endLine: number;
  reasons: RetrievalReason[];
}

// Fixed deterministic ordering of reason types within a trace.
const TYPE_PRIORITY: Record<RetrievalReason["type"], number> = {
  semantic: 0,
  keyword: 1,
  symbol: 2,
  graph: 3,
  cross_file: 4,
  file_search: 5,
  rerank: 6,
  budget: 7,
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function buildReasonsForChunk(chunk: EnrichedContextChunk): RetrievalReason[] {
  const reasons: RetrievalReason[] = [];
  const s = chunk.signals;

  const semantic = s.semantic ?? 0;
  if (semantic > 0) {
    reasons.push({
      type: "semantic",
      scoreImpact: round3(semantic),
      description: "Matched by semantic vector similarity",
    });
  }

  const keyword = s.keyword ?? 0;
  if (keyword > 0) {
    reasons.push({
      type: "keyword",
      scoreImpact: round3(keyword),
      description: "Matched query keywords in content or path",
    });
  }

  const symbol = s.symbol ?? 0;
  if (symbol > 0) {
    reasons.push({
      type: "symbol",
      scoreImpact: round3(symbol),
      description: "Matched an extracted code symbol",
    });
  }

  const graph = s.graph ?? 0;
  if (graph > 0) {
    reasons.push({
      type: "graph",
      scoreImpact: round3(graph),
      description: "Boosted by dependency-graph centrality",
    });
  }

  const fileSearch = s.fileSearch ?? 0;
  if (fileSearch > 0) {
    reasons.push({
      type: "file_search",
      scoreImpact: round3(fileSearch),
      description: "Matched file-level search",
    });
  }

  // Source-kind fallback: ensure the corresponding reason exists even when the
  // explicit signal value is absent (e.g. source set but signal implicit).
  ensureSourceReason(chunk, reasons);

  // Every chunk present in the final (post-budget) set is a budget survivor.
  reasons.push({
    type: "budget",
    scoreImpact: 0,
    description: "Survived context budget trimming",
  });

  // Deterministic ordering by fixed type priority.
  reasons.sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);
  return reasons;
}

function ensureSourceReason(
  chunk: EnrichedContextChunk,
  reasons: RetrievalReason[],
): void {
  const has = (t: RetrievalReason["type"]): boolean =>
    reasons.some((r) => r.type === t);

  switch (chunk.source) {
    case "semantic":
      if (!has("semantic"))
        reasons.push({ type: "semantic", scoreImpact: 0, description: "Matched by semantic vector similarity" });
      break;
    case "keyword":
      if (!has("keyword"))
        reasons.push({ type: "keyword", scoreImpact: 0, description: "Matched query keywords in content or path" });
      break;
    case "symbol":
      if (!has("symbol"))
        reasons.push({ type: "symbol", scoreImpact: 0, description: "Matched an extracted code symbol" });
      break;
    case "graph":
      if (!has("graph"))
        reasons.push({ type: "graph", scoreImpact: 0, description: "Boosted by dependency-graph centrality" });
      break;
    case "file-search":
      if (!has("file_search"))
        reasons.push({ type: "file_search", scoreImpact: 0, description: "Matched file-level search" });
      break;
  }
}

// statistics is accepted for API compatibility but only carries aggregate
// counts (no per-chunk cross-file/rerank indicators exist in the real data),
// so cross_file and rerank reasons are intentionally NOT emitted.
export function buildRetrievalTrace(
  chunks: EnrichedContextChunk[],
  _statistics?: RerankStatistics,
): RetrievalTrace[] {
  return chunks.map((chunk) => ({
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    reasons: buildReasonsForChunk(chunk),
  }));
}
