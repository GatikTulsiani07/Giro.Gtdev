import type { RepositoryAnalysisReport } from "./repositoryAnalysisReport.js";
import { buildRepositoryAnalysisMarkdown } from "./repositoryAnalysisMarkdown.js";

export interface RepositoryAnalysisExport {
  format: "markdown";
  content: string;
}

export function exportRepositoryAnalysisMarkdown(
  report: RepositoryAnalysisReport,
): RepositoryAnalysisExport {
  return {
    format: "markdown",
    content: buildRepositoryAnalysisMarkdown(report),
  };
}