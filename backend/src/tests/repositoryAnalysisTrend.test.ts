import { describe, expect, it } from "vitest";

import {
  clearRepositoryAnalysisHistory,
  saveRepositoryAnalysisReport,
} from "../services/repository/repositoryAnalysisHistory.js";
import { buildRepositoryAnalysisTrend } from "../services/repository/repositoryAnalysisTrend.js";

describe("repository analysis trend", () => {
  it("builds trend points from analysis history", () => {
    clearRepositoryAnalysisHistory();

    saveRepositoryAnalysisReport("demo-repo", {
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
    });

    const trend = buildRepositoryAnalysisTrend("demo-repo");

    expect(trend).toEqual([
      {
        repositoryName: "demo-repo",
        index: 0,
        healthScore: 40,
        healthCategory: "poor",
      },
    ]);
  });
});