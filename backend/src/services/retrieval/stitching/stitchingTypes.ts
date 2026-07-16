export interface StitchingCitation {
  repositoryId: string;
  relativeFilePath: string;
  language: string;
  chunkId: string;
  startLine: number;
  endLine: number;
  retrievalType: string;
  score: number;
  symbol?: string;
  repositoryVersion: string;
}

export interface StitchableChunk<TCitation = StitchingCitation> {
  repositoryId: string;
  filePath: string;
  repositoryVersion: string;
  retrievalOperation: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
  symbol?: string;
  citations: readonly TCitation[];
}

export interface StitchedChunk<TCitation = StitchingCitation>
  extends StitchableChunk<TCitation> {
  primaryChunk: StitchableChunk<TCitation>;
  contributors: readonly StitchableChunk<TCitation>[];
  retrievalScores: readonly number[];
  symbols: readonly string[];
}

export interface AdjacentChunkStitchingOptions {
  configuredLineGap: number;
  primaryChunkCount?: number;
}

export interface AdjacentChunkStitchingResult<TCitation = StitchingCitation> {
  chunks: StitchedChunk<TCitation>[];
  stitchCount: number;
  chunksMerged: number;
}

export interface ChunkStitchingMetrics {
  incrementChunkStitches(count?: number): void;
  incrementChunksMerged(count?: number): void;
  incrementStitchBudgetDrops(count?: number): void;
}

export interface ChunkStitchingLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}
