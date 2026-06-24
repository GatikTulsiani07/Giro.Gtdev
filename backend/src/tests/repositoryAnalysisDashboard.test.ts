import { describe, expect, it } from "vitest";

import type { RepositoryAnalysisReport } from "../services/repository/repositoryAnalysisReport.js";
import {
  clearRepositoryAnalysisHistory,
  saveRepositoryAnalysisReport,
} from "../services/repository/repositoryAnalysisHistory.js";
import { buildRepositoryAnalysisDashboard } from "../services/repository/repositoryAnalysisDashboard.js";

describe("repository analysis dashboard", () => {
  it("builds dashboard with report and trend", () => {
    clearRepositoryAnalysisHistory();

    const report: RepositoryAnalysisReport = {
      repositoryName: "demo-repo",
      health: {
        summary: {
          scale: "large",
          complexity: "high",
          fileCoverage: 1,
          dependencyDensity: 10,
          healthScore: 40,
          healthCategory: "poor",
        },
        recommendations: ["Reduce dependency density"],
      },
      overview: "Repository overview",
      structureSummary: "Repository structure",
    };

    saveRepositoryAnalysisReport("demo-repo", report);

    const dashboard = buildRepositoryAnalysisDashboard(report);

    expect(dashboard.report.repositoryName).toBe("demo-repo");
    expect(dashboard.trend.length).toBe(1);
  });
});