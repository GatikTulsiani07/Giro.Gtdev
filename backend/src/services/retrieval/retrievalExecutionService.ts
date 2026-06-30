import type { RetrievalCandidate } from "./candidateFilter.js";

import { buildRetrievalPipeline } from "./retrievalPipeline.js";
import { truncateRetrievalContext } from "./contextTruncation.js";
import { buildRetrievalPrompt } from "./promptBuilder.js";

export interface RetrievalExecutionInput {
  candidates: readonly RetrievalCandidate[];
  question: string;
  minScore: number;
  maxCandidates: number;
  maxCharacters: number;
}

export interface RetrievalExecutionResult {
  prompt: string;
  chunkCount: number;
  files: string[];
}

export function executeRetrieval(
  input: RetrievalExecutionInput,
): RetrievalExecutionResult {
  const context = buildRetrievalPipeline(
    input.candidates,
    {
      minScore: input.minScore,
      maxCandidates: input.maxCandidates,
      maxCharacters: input.maxCharacters,
    },
  );

  const truncated = truncateRetrievalContext(
    context.content,
    input.maxCharacters,
  );

  return {
    prompt: buildRetrievalPrompt({
      question: input.question,
      context: truncated,
    }),
    chunkCount: context.chunkCount,
    files: context.files,
  };
}