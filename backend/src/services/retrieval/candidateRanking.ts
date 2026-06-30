import type { RetrievalCandidate } from "./candidateFilter.js";

export function rankRetrievalCandidates(
  candidates: readonly RetrievalCandidate[],
): RetrievalCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    if (a.content.length !== b.content.length) {
      return b.content.length - a.content.length;
    }

    return a.filePath.localeCompare(b.filePath);
  });
}