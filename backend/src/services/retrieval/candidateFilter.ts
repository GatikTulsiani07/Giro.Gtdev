export interface RetrievalCandidate {
  filePath: string;
  content: string;
  score: number;
  language?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  repositoryVersion?: string;
  expansion?: boolean;
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
