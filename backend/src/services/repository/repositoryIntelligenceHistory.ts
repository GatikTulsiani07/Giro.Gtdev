import type {
  RepositoryIntelligenceResult,
} from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceHistoryEntry {
  generatedAt: string;
  intelligence: RepositoryIntelligenceResult;
}

const historyStore = new Map<
  string,
  RepositoryIntelligenceHistoryEntry[]
>();

export function saveRepositoryIntelligence(
  intelligence: RepositoryIntelligenceResult,
): void {
  const history =
    historyStore.get(intelligence.repositoryId) ?? [];

  history.push({
    generatedAt: new Date().toISOString(),
    intelligence,
  });

  historyStore.set(
    intelligence.repositoryId,
    history,
  );
}

export function getRepositoryIntelligenceHistory(
  repositoryId: string,
): RepositoryIntelligenceHistoryEntry[] {
  return historyStore.get(repositoryId) ?? [];
}

export function clearRepositoryIntelligenceHistory(
  repositoryId: string,
): void {
  historyStore.delete(repositoryId);
}