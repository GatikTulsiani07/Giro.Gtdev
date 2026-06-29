import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceOverview {
  repositoryId: string;
  repositoryName: string;
  intelligenceScore: number;
  intelligenceGrade: string;
  healthScore: number;
  indexed: boolean;
  ready: boolean;
}

export function buildRepositoryIntelligenceOverview(
  intelligence: RepositoryIntelligenceResult,
): RepositoryIntelligenceOverview {
  return {
    repositoryId: intelligence.repositoryId,
    repositoryName: intelligence.repositoryName,
    intelligenceScore: intelligence.intelligence.score,
    intelligenceGrade: intelligence.intelligence.grade,
    healthScore: intelligence.summary.healthScore,
    indexed: intelligence.status.indexed,
    ready: intelligence.status.ready,
  };
}