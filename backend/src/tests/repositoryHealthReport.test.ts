import { describe, expect, it } from "vitest";

import { buildRepositoryHealthReport } from "../services/repository/repositoryHealthReport.js";

describe("repository health report", () => {
  it("builds repository health report", () => {
    const report = buildRepositoryHealthReport({
      scale: "large",
      complexity: "high",
      fileCoverage: 1,
      dependencyDensity: 10,
      healthScore: 40,
      healthCategory: "poor",
    });

    expect(report.summary.healthScore).toBe(40);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});