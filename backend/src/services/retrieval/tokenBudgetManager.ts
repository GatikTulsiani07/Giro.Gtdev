import type { RetrievalCandidate } from "./candidateFilter.js";

export interface RetrievalTokenBudgetOptions {
  maxCharacters: number;
}

export function applyRetrievalTokenBudget(
  candidates: readonly RetrievalCandidate[],
  options: RetrievalTokenBudgetOptions,
): RetrievalCandidate[] {
  const selected: RetrievalCandidate[] = [];
  let usedCharacters = 0;

  for (const candidate of candidates) {
    const nextSize = candidate.content.length;

    if (usedCharacters + nextSize > options.maxCharacters) {
      continue;
    }

    selected.push({ ...candidate });
    usedCharacters += nextSize;
  }

  return selected;
}