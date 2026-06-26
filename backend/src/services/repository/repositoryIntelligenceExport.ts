import type {
  RepositoryIntelligenceResult,
} from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceExport {
  repositoryId: string;
  repositoryName: string;
  intelligenceScore: number;
  intelligenceGrade: string;
  healthScore: number;
  healthCategory: string;
  indexStatus: string;
  architectureReady: boolean;
  retrievalReady: boolean;
}

export function exportRepositoryIntelligence(
  intelligence: RepositoryIntelligenceResult,
): RepositoryIntelligenceExport {
  return {
    repositoryId: intelligence.repositoryId,
    repositoryName: intelligence.repositoryName,
    intelligenceScore: intelligence.intelligence.score,
    intelligenceGrade: intelligence.intelligence.grade,
    healthScore: intelligence.summary.healthScore,
    healthCategory: intelligence.summary.healthCategory,
    indexStatus: intelligence.summary.indexStatus,
    architectureReady: intelligence.status.architectureReady,
    retrievalReady: intelligence.status.retrievalReady,
  };
}