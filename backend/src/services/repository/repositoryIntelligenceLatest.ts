import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";
import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";

export function getLatestRepositoryIntelligence(
  repositoryId: string,
): RepositoryIntelligenceResult | null {
  const history = getRepositoryIntelligenceHistory(repositoryId);
  const latest = history.at(-1);

  return latest?.intelligence ?? null;
}