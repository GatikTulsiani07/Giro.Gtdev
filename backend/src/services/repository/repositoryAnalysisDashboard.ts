import type { RepositoryAnalysisReport } from "./repositoryAnalysisReport.js";
import { buildRepositoryAnalysisTrend } from "./repositoryAnalysisTrend.js";

export interface RepositoryAnalysisDashboard {
  report: RepositoryAnalysisReport;
  trend: ReturnType<typeof buildRepositoryAnalysisTrend>;
}

export function buildRepositoryAnalysisDashboard(
  report: RepositoryAnalysisReport,
): RepositoryAnalysisDashboard {
  return {
    report,
    trend: buildRepositoryAnalysisTrend(report.repositoryName),
  };
}