import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceApiResponse {
  repository: {
    id: string;
    name: string;
  };

  metadata: {
    generatedAt: string;
    version: "v1";
  };

  readiness: RepositoryIntelligenceResult["readiness"];

  intelligence: RepositoryIntelligenceResult["intelligence"];

  health: RepositoryIntelligenceResult["summary"];

  status: RepositoryIntelligenceResult["status"];

  retrieval: {
    quality: RepositoryIntelligenceResult["retrieval"]["quality"];
    indexingReport: RepositoryIntelligenceResult["retrieval"]["indexingReport"];
  };
}

export function buildRepositoryIntelligenceApiResponse(
  intelligence: RepositoryIntelligenceResult,
): RepositoryIntelligenceApiResponse {
  return {
    repository: {
      id: intelligence.repositoryId,
      name: intelligence.repositoryName,
    },
    metadata: {
  generatedAt: new Date().toISOString(),
  version: "v1",
},

    readiness: intelligence.readiness,

    intelligence: intelligence.intelligence,

    health: intelligence.summary,

    status: intelligence.status,

    retrieval: {
      quality: intelligence.retrieval.quality,
      indexingReport: intelligence.retrieval.indexingReport,
    },
  };
}