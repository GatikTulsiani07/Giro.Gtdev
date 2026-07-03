import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceResponse {
  repositoryId: string;
  repositoryName: string;

  health: number;
  intelligence: number;
  readiness: number;

  status: {
    indexed: boolean;
    ready: boolean;
  };

  grades: {
    intelligence: string;
    retrieval: string;
    health: string;
  };
}

export function mapRepositoryIntelligenceResponse(
  intelligence: RepositoryIntelligenceResult,
): RepositoryIntelligenceResponse {
  return {
    repositoryId: intelligence.repositoryId,
    repositoryName: intelligence.repositoryName,

    health: intelligence.summary.healthScore,
    intelligence: intelligence.intelligence.score,
    readiness: intelligence.readiness.score,

    status: {
      indexed: intelligence.status.indexed,
      ready: intelligence.status.ready,
    },

    grades: {
      intelligence: intelligence.intelligence.grade,
      retrieval: intelligence.summary.retrievalGrade,
      health: intelligence.summary.healthCategory,
    },
  };
}