import type { RetrievalCandidate } from "./candidateFilter.js";

export interface RetrievalChunk {
  filePath: string;
  content: string;
  score?: number;
  language?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  repositoryVersion?: string;
}

export function mapChunksToCandidates(
  chunks: readonly RetrievalChunk[],
): RetrievalCandidate[] {
  return chunks.map((chunk) => ({
    filePath: chunk.filePath,
    content: chunk.content,
    score: chunk.score ?? 0,
    language: chunk.language,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    symbol: chunk.symbol,
    repositoryVersion: chunk.repositoryVersion,
  }));
}
