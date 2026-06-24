import { describe, expect, it } from "vitest";

import { buildRepositoryHealthRecommendations } from "../services/repository/repositoryHealthRecommendations.js";

describe("repository health recommendations", () => {
  it("generates recommendations for unhealthy repositories", () => {
    const result = buildRepositoryHealthRecommendations({
      scale: "large",
      complexity: "high",
      fileCoverage: 1,
      dependencyDensity: 10,
      healthScore: 40,
      healthCategory: "poor",
    });

    expect(result.length).toBeGreaterThan(0);
  });

  it("returns no recommendations for healthy repositories", () => {
    const result = buildRepositoryHealthRecommendations({
      scale: "small",
      complexity: "low",
      fileCoverage: 5,
      dependencyDensity: 1,
      healthScore: 95,
      healthCategory: "excellent",
    });

    expect(result).toEqual([]);
  });
});