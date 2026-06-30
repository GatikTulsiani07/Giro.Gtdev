export interface RetrievalCandidate {
  filePath: string;
  content: string;
  score: number;
}

export interface RetrievalCandidateFilterOptions {
  minScore: number;
  maxCandidates: number;
}

export function filterRetrievalCandidates(
  candidates: readonly RetrievalCandidate[],
  options: RetrievalCandidateFilterOptions,
): RetrievalCandidate[] {
  return [...candidates]
    .filter((candidate) => candidate.score >= options.minScore)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .slice(0, options.maxCandidates);
}