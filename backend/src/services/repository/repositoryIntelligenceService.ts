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

export interface RepositoryIntelligenceResult {
  repositoryId: string;
  repositoryName: string;
  summary: RepositoryIntelligenceSummary;
  analysis: ReturnType<typeof analyzeRepository>;
  architecture: ReturnType<typeof getArchitectureDashboardData>;
}

export function buildRepositoryIntelligence(
  input: RepositoryIntelligenceInput,
): RepositoryIntelligenceResult {
  const analysis = analyzeRepository(input.repositoryName, input.overview);
  const architecture = getArchitectureDashboardData(input.repositoryId);

  return {
    repositoryId: input.repositoryId,
    repositoryName: input.repositoryName,
    summary: {
      healthScore: analysis.health.summary.healthScore,
      healthCategory: analysis.health.summary.healthCategory,
      hasArchitectureReport: architecture.hasReport,
    },
    analysis,
    architecture,
  };
}