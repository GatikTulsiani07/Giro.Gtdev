import { describe, expect, it } from "vitest";

import type { RepositoryAnalysisReport } from "../services/repository/repositoryAnalysisReport.js";
import {
  clearRepositoryAnalysisHistory,
  getRepositoryAnalysisHistory,
  saveRepositoryAnalysisReport,
} from "../services/repository/repositoryAnalysisHistory.js";

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

describe("repository analysis history", () => {
  it("stores and returns repository analysis reports", () => {
    clearRepositoryAnalysisHistory();

    saveRepositoryAnalysisReport("demo-repo", report);

    const history = getRepositoryAnalysisHistory("demo-repo");

    expect(history.length).toBe(1);
    expect(history[0]?.repositoryName).toBe("demo-repo");
  });

  it("returns empty history for unknown repository", () => {
    clearRepositoryAnalysisHistory();

    expect(getRepositoryAnalysisHistory("unknown/repo")).toEqual([]);
  });
});