// Deterministic developer-facing retrieval debug report. Metadata ONLY — never
// influences ranking, selection, or answer generation. No AI, no randomness,
// no timestamps, no network, no filesystem. Inputs are never mutated.

import type { EnrichedContextChunk } from "../context/contextTypes.js";
import type { RerankStatistics } from "./qualityReranker.js";
import { scoreContextConfidence } from "./confidenceScorer.js";

export interface RetrievalDebugReport {
  totalChunksBeforeRerank: number;
  totalChunksAfterRerank: number;
  totalChunksAfterBudget: number;
  duplicateChunksRemoved: number;
  boostedChunks: number;
  crossFileBoostedChunks: number;
  averageConfidence: number;
  filesRepresented: number;
  sourcesRepresented: string[];
}

export function buildRetrievalDebugReport(
  finalChunks: EnrichedContextChunk[],
  statistics?: RerankStatistics,
): RetrievalDebugReport {
  const finalCount = finalChunks.length;

  const distinctFiles = new Set<string>();
  const distinctSources = new Set<string>();
  for (const chunk of finalChunks) {
    distinctFiles.add(chunk.filePath);
    distinctSources.add(chunk.source);
  }

  return {
    totalChunksBeforeRerank: statistics?.originalChunkCount ?? finalCount,
    totalChunksAfterRerank: statistics?.rerankedChunkCount ?? finalCount,
    totalChunksAfterBudget: finalCount,
    duplicateChunksRemoved: statistics?.duplicateChunksRemoved ?? 0,
    boostedChunks: statistics?.boostedChunkCount ?? 0,
    crossFileBoostedChunks: statistics?.crossFileBoostedChunkCount ?? 0,
    averageConfidence: scoreContextConfidence(finalChunks).confidence,
    filesRepresented: distinctFiles.size,
    sourcesRepresented: [...distinctSources].sort((a, b) => a.localeCompare(b)),
  };
}
