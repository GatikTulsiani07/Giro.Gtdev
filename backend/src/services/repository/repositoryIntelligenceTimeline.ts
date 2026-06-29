import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";

export interface RepositoryIntelligenceTimelineEntry {
  generatedAt: string;
  repositoryName: string;
  healthScore: number;
  intelligenceScore: number;
}

export function buildRepositoryIntelligenceTimeline(
  repositoryId: string,
): RepositoryIntelligenceTimelineEntry[] {
  return getRepositoryIntelligenceHistory(repositoryId).map((entry) => ({
    generatedAt: entry.generatedAt,
    repositoryName: entry.intelligence.repositoryName,
    healthScore: entry.intelligence.summary.healthScore,
    intelligenceScore: entry.intelligence.intelligence.score,
  }));
}