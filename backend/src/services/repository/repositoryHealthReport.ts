import type { RepositoryHealthSummary } from "./repositoryHealthSummary.js";
import { buildRepositoryHealthRecommendations } from "./repositoryHealthRecommendations.js";

export interface RepositoryHealthReport {
  summary: RepositoryHealthSummary;
  recommendations: string[];
}

export function buildRepositoryHealthReport(
  summary: RepositoryHealthSummary,
): RepositoryHealthReport {
  return {
    summary,
    recommendations: buildRepositoryHealthRecommendations(summary),
  };
}