import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceSnapshot {
  repository: string;
  intelligenceScore: number;
  intelligenceGrade: string;
  healthScore: number;
  indexed: boolean;
  timestamp: string;
}

export function buildRepositoryIntelligenceSnapshot(
  intelligence: RepositoryIntelligenceResult,
): RepositoryIntelligenceSnapshot {
  return {
    repository: intelligence.repositoryId,
    intelligenceScore: intelligence.intelligence.score,
    intelligenceGrade: intelligence.intelligence.grade,
    healthScore: intelligence.summary.healthScore,
    indexed: intelligence.status.indexed,
    timestamp: new Date().toISOString(),
  };
}