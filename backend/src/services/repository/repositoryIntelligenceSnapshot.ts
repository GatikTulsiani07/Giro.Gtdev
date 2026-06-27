import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";
import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";

export function getRepositoryIntelligenceSnapshot(
  repositoryId: string,
  index: number,
): RepositoryIntelligenceResult | null {
  const history = getRepositoryIntelligenceHistory(repositoryId);

  if (index < 0 || index >= history.length) {
    return null;
  }

  return history[index]?.intelligence ?? null;
}