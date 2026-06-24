import { getRepositoryAnalysisHistory } from "./repositoryAnalysisHistory.js";

export interface RepositoryAnalysisTrendPoint {
  repositoryName: string;
  index: number;
  healthScore: number;
  healthCategory: string;
}

export function buildRepositoryAnalysisTrend(
  repositoryName: string,
): RepositoryAnalysisTrendPoint[] {
  return getRepositoryAnalysisHistory(repositoryName).map((report, index) => ({
    repositoryName,
    index,
    healthScore: report.health.summary.healthScore,
    healthCategory: report.health.summary.healthCategory,
  }));
}