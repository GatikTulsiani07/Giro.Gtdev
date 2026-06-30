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

export interface RetrievalPipelineOptions
  extends RetrievalCandidateFilterOptions {
  maxCharacters: number;
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

  const budgeted =
    applyRetrievalTokenBudget(
      ranked,
      {
        maxCharacters: options.maxCharacters,
      },
    );

  return assembleRetrievalContext(budgeted);
}