import {
  filterRetrievalCandidates,
  type RetrievalCandidate,
  type RetrievalCandidateFilterOptions,
} from "./candidateFilter.js";
import { dedupeRetrievalCandidates } from "./candidateDeduplication.js";
import { rankRetrievalCandidates } from "./candidateRanking.js";
import { applyRetrievalTokenBudget } from "./tokenBudgetManager.js";
import {
  assembleRetrievalContext,
  type RetrievalContext,
} from "./contextAssembler.js";
import { expandRetrievalCandidatesWithRepositoryGraph } from "../repositoryGraph/repositoryGraph.js";
import type { RepositoryGraphExpansionMetrics, RepositoryGraphLogger } from "../repositoryGraph/graphTypes.js";

export interface RetrievalPipelineOptions
  extends RetrievalCandidateFilterOptions {
  maxCharacters: number;
  repositoryId?: string;
  repositoryVersion?: string;
  metrics?: RepositoryGraphExpansionMetrics;
  logger?: RepositoryGraphLogger;
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

  const primaryBudgeted =
    applyRetrievalTokenBudget(
      ranked,
      {
        maxCharacters: options.maxCharacters,
      },
    );

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
