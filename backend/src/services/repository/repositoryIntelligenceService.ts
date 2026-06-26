import type { RepositoryOverview } from "./repositoryOverview.js";
import { analyzeRepository } from "./repositoryAnalysisService.js";
import { getArchitectureDashboardData } from "./architectureDashboardIntegration.js";

export interface RepositoryIntelligenceInput {
  repositoryId: string;
  repositoryName: string;
  overview: RepositoryOverview;
}

export interface RepositoryIntelligenceSummary {
  healthScore: number;
  healthCategory: string;
  hasArchitectureReport: boolean;
}

export interface RepositoryIntelligenceStatus {
  indexed: boolean;
  architectureReady: boolean;
  ready: boolean;
}

export interface RepositoryIntelligenceResult {
  repositoryId: string;
  repositoryName: string;
  status: RepositoryIntelligenceStatus;
  summary: RepositoryIntelligenceSummary;
  analysis: ReturnType<typeof analyzeRepository>;
  architecture: ReturnType<typeof getArchitectureDashboardData>;
}

export function buildRepositoryIntelligence(
  input: RepositoryIntelligenceInput,
): RepositoryIntelligenceResult {
  const analysis = analyzeRepository(input.repositoryName, input.overview);
  const architecture = getArchitectureDashboardData(input.repositoryId);

  const status: RepositoryIntelligenceStatus = {
    indexed: true,
    architectureReady: architecture.hasReport,
    ready: architecture.hasReport,
  };

  return {
    repositoryId: input.repositoryId,
    repositoryName: input.repositoryName,
    status,
    summary: {
      healthScore: analysis.health.summary.healthScore,
      healthCategory: analysis.health.summary.healthCategory,
      hasArchitectureReport: architecture.hasReport,
    },
    analysis,
    architecture,
  };
}