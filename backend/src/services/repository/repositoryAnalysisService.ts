import type { RepositoryOverview } from "./repositoryOverview.js";
import { buildRepositoryAnalysisReport } from "./repositoryAnalysisReport.js";
import { buildRepositoryHealthReport } from "./repositoryHealthReport.js";
import { buildRepositoryHealthSummary } from "./repositoryHealthSummary.js";

export function analyzeRepository(
  repositoryName: string,
  overview: RepositoryOverview,
) {
  const healthSummary = buildRepositoryHealthSummary(overview);
  const healthReport = buildRepositoryHealthReport(healthSummary);

  return buildRepositoryAnalysisReport({
    repositoryName,
    health: healthReport,
    overview: `Analysis for ${repositoryName}`,
    structureSummary: `${overview.structure.totalFiles} files`,
  });
}