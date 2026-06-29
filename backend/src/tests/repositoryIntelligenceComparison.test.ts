import { describe, expect, it } from "vitest";

import { compareRepositoryIntelligence } from "../services/repository/repositoryIntelligenceComparison.js";

describe("repository intelligence comparison", () => {
  it("compares two repository intelligence snapshots", () => {
    const previous = {
      summary: {
        healthScore: 70,
        retrievalGrade: "fair",
        indexStatus: "indexed",
      },
      intelligence: {
        score: 65,
        grade: "fair",
      },
    } as never;

    const current = {
      summary: {
        healthScore: 90,
        retrievalGrade: "excellent",
        indexStatus: "indexed",
      },
      intelligence: {
        score: 92,
        grade: "excellent",
      },
    } as never;

    const comparison = compareRepositoryIntelligence(
      previous,
      current,
    );

    expect(comparison.healthScoreDelta).toBe(20);
    expect(comparison.intelligenceScoreDelta).toBe(27);
    expect(comparison.retrievalGradeChanged).toBe(true);
    expect(comparison.indexStatusChanged).toBe(false);
  });
});