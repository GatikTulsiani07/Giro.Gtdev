import { env } from "../../../config/env.js";
import { logger as runtimeLogger } from "../../../lib/logger.js";
import { runtimeMetrics } from "../../../observability/metrics.js";
import { stitchAdjacentChunks } from "./adjacentChunkStitcher.js";
import type {
  AdjacentChunkStitchingResult,
  ChunkStitchingLogger,
  ChunkStitchingMetrics,
  StitchableChunk,
} from "./stitchingTypes.js";

export interface RuntimeChunkStitchingOptions {
  configuredLineGap?: number;
  primaryChunkCount?: number;
  metrics?: ChunkStitchingMetrics;
  logger?: ChunkStitchingLogger;
}

export function stitchRuntimeChunks<TCitation>(
  chunks: readonly StitchableChunk<TCitation>[],
  options: RuntimeChunkStitchingOptions = {},
): AdjacentChunkStitchingResult<TCitation> {
  const configuredLineGap = options.configuredLineGap ?? env.RETRIEVAL_STITCH_LINE_GAP;
  const metrics = options.metrics ?? runtimeMetrics;
  const stitchLogger = options.logger ?? runtimeLogger;
  const retrievalOperations = new Set(chunks.map((chunk) => chunk.retrievalOperation));
  const repositoryCount = new Set(chunks.map((chunk) => chunk.repositoryId)).size;

  stitchLogger.info("chunk_stitch_started", {
    candidateCount: chunks.length,
    configuredLineGap,
    repositoryCount,
    retrievalOperationCount: retrievalOperations.size,
  });

  const result = stitchAdjacentChunks(chunks, {
    configuredLineGap,
    primaryChunkCount: options.primaryChunkCount,
  });
  if (result.stitchCount === 0) {
    stitchLogger.info("chunk_stitch_skipped", {
      candidateCount: chunks.length,
      outputBlockCount: result.chunks.length,
      reason: chunks.length < 2 ? "insufficient_chunks" : "no_adjacent_chunks",
    });
    return result;
  }

  metrics.incrementChunkStitches(result.stitchCount);
  metrics.incrementChunksMerged(result.chunksMerged);
  stitchLogger.info("chunk_stitch_completed", {
    candidateCount: chunks.length,
    outputBlockCount: result.chunks.length,
    stitchCount: result.stitchCount,
    chunksMerged: result.chunksMerged,
  });
  return result;
}

export function recordRuntimeStitchBudgetDrops(
  count: number,
  options: Pick<RuntimeChunkStitchingOptions, "metrics"> = {},
): void {
  if (count <= 0) return;
  (options.metrics ?? runtimeMetrics).incrementStitchBudgetDrops(count);
}
