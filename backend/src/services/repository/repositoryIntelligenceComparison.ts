import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceComparison {
  healthScoreDelta: number;
  intelligenceScoreDelta: number;
  retrievalGradeChanged: boolean;
  indexStatusChanged: boolean;
}

export function compareRepositoryIntelligence(
  previous: RepositoryIntelligenceResult,
  current: RepositoryIntelligenceResult,
): RepositoryIntelligenceComparison {
  return {
    healthScoreDelta:
      current.summary.healthScore -
      previous.summary.healthScore,

    intelligenceScoreDelta:
      current.intelligence.score -
      previous.intelligence.score,

    retrievalGradeChanged:
      current.summary.retrievalGrade !==
      previous.summary.retrievalGrade,

    indexStatusChanged:
      current.summary.indexStatus !==
      previous.summary.indexStatus,
  };
}