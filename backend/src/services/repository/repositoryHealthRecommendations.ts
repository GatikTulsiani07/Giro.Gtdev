import type { RepositoryHealthSummary } from "./repositoryHealthSummary.js";

export function buildRepositoryHealthRecommendations(
  summary: RepositoryHealthSummary,
): string[] {
  const recommendations: string[] = [];

  if (summary.complexity === "high") {
    recommendations.push(
      "Reduce architectural complexity by splitting large modules.",
    );
  }

  if (summary.dependencyDensity > 5) {
    recommendations.push(
      "Reduce dependency density to improve maintainability.",
    );
  }

  if (summary.fileCoverage < 3) {
    recommendations.push(
      "Increase symbol coverage across repository files.",
    );
  }

  if (summary.healthCategory === "poor") {
    recommendations.push(
      "Prioritize repository cleanup and architecture review.",
    );
  }

  return recommendations;
}