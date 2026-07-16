import {
  filterRetrievalCandidates,
  type RetrievalCandidate,
  type RetrievalCandidateFilterOptions,
} from "./candidateFilter.js";
import { dedupeRetrievalCandidates } from "./candidateDeduplication.js";
import { rankRetrievalCandidates } from "./candidateRanking.js";
import { applyRetrievalTokenBudget } from "./tokenBudgetManager.js";
import { truncateRetrievalContext } from "./contextTruncation.js";
import {
  assembleRetrievalContext,
  type RetrievalContext,
} from "./contextAssembler.js";
import { expandRetrievalCandidatesWithRepositoryGraph } from "../repositoryGraph/repositoryGraph.js";
import type { RepositoryGraphExpansionMetrics, RepositoryGraphLogger } from "../repositoryGraph/graphTypes.js";
import {
  recordRuntimeStitchBudgetDrops,
  stitchRuntimeChunks,
} from "./stitching/runtimeChunkStitcher.js";
import type {
  ChunkStitchingLogger,
  ChunkStitchingMetrics,
} from "./stitching/stitchingTypes.js";

export interface RetrievalPipelineOptions
  extends RetrievalCandidateFilterOptions {
  maxCharacters: number;
  repositoryId?: string;
  repositoryVersion?: string;
  metrics?: RepositoryGraphExpansionMetrics;
  logger?: RepositoryGraphLogger;
  stitchingLineGap?: number;
  stitchingMetrics?: ChunkStitchingMetrics;
  stitchingLogger?: ChunkStitchingLogger;
}

export function buildRetrievalPipeline(
  candidates: readonly RetrievalCandidate[],
  options: RetrievalPipelineOptions,
): RetrievalContext {
  const deduplicated =
    dedupeRetrievalCandidates(candidates);

  const filtered =
    filterRetrievalCandidates(
      deduplicated,
      options,
    );

  const ranked =
    rankRetrievalCandidates(filtered);

  const stitchingInputs = options.repositoryId
    ? ranked.map((candidate) => ({
        repositoryId: options.repositoryId!,
        filePath: candidate.filePath,
        repositoryVersion: candidate.repositoryVersion ?? options.repositoryVersion ?? "unversioned",
        retrievalOperation: "retrieval_pipeline",
        content: candidate.content,
        startLine: candidate.startLine ?? 0,
        endLine: candidate.endLine ?? 0,
        score: candidate.score,
        symbol: candidate.symbol,
        citations: [],
        candidate,
      }))
    : [];
  const stitched = options.repositoryId
    ? stitchRuntimeChunks(stitchingInputs, {
        configuredLineGap: options.stitchingLineGap,
        metrics: options.stitchingMetrics,
        logger: options.stitchingLogger,
      })
    : null;
  const stitchBudgetInput = stitched
    ? stitched.chunks.map((block) => {
        const primary = block.primaryChunk as (typeof stitchingInputs)[number];
        return {
          ...primary.candidate,
          content: block.content,
          startLine: block.startLine,
          endLine: block.endLine,
        };
      })
    : ranked;

  const primaryBudgeted = stitched
    ? (() => {
        const selected: RetrievalCandidate[] = [];
        let usedCharacters = 0;
        stitchBudgetInput.forEach((candidate, index) => {
          const remaining = options.maxCharacters - usedCharacters;
          if (remaining <= 0) return;
          if (candidate.content.length <= remaining) {
            selected.push(candidate);
            usedCharacters += candidate.content.length;
            return;
          }
          const block = stitched.chunks[index];
          if (block && block.contributors.length > 1) {
            selected.push({
              ...candidate,
              content: truncateRetrievalContext(candidate.content, remaining),
            });
            usedCharacters = options.maxCharacters;
          }
        });
        return selected;
      })()
    : applyRetrievalTokenBudget(
        stitchBudgetInput,
        { maxCharacters: options.maxCharacters },
      );

  if (stitched) {
    const retained = new Set(primaryBudgeted.map((candidate) => JSON.stringify([
      candidate.filePath,
      candidate.startLine,
      candidate.endLine,
    ])));
    const budgetDrops = stitched.chunks.filter((block) =>
      block.contributors.length > 1 &&
      !retained.has(JSON.stringify([
        block.filePath,
        block.startLine,
        block.endLine,
      ])),
    ).length;
    recordRuntimeStitchBudgetDrops(budgetDrops, { metrics: options.stitchingMetrics });
  }

  const budgeted = options.repositoryId
    ? expandRetrievalCandidatesWithRepositoryGraph(primaryBudgeted, {
        repositoryId: options.repositoryId,
        repositoryVersion: options.repositoryVersion,
        maxCharacters: options.maxCharacters,
        metrics: options.metrics,
        logger: options.logger,
      })
    : primaryBudgeted;

  return assembleRetrievalContext(budgeted);
}
