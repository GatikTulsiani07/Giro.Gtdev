import { describe, expect, it } from "vitest";

import type { RepositoryOverview } from "../services/repository/repositoryOverview.js";
import { analyzeRepository } from "../services/repository/repositoryAnalysisService.js";

describe("repository analysis service", () => {
  it("builds analysis report from repository overview", () => {
    const overview = {
  structure: {
    totalFiles: 10,
    totalSymbols: 20,
    repositoryScale: "small",
  },
  architecture: {
    totalFiles: 10,
    totalDependencies: 15,
    architectureComplexity: "medium",
  },
} as RepositoryOverview;

    const report = analyzeRepository("demo-repo", overview);

    expect(report.repositoryName).toBe("demo-repo");
    expect(report.health.summary.healthScore).toBeGreaterThan(0);
    expect(report.structureSummary).toBe("10 files");
  });
});