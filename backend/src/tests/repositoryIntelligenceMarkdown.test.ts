import { describe, expect, it } from "vitest";

import { buildRepositoryIntelligenceMarkdown } from "../services/repository/repositoryIntelligenceMarkdown.js";

describe("repository intelligence markdown", () => {
  it("creates markdown report", () => {
    const markdown = buildRepositoryIntelligenceMarkdown({
      repositoryId: "demo/repo",
      repositoryName: "demo",
      status: {
        indexed: true,
        architectureReady: true,
        retrievalReady: true,
        ready: true,
      },
      summary: {
        healthScore: 90,
        healthCategory: "excellent",
        hasArchitectureReport: true,
        retrievalGrade: "excellent",
        indexStatus: "indexed",
      },
      analysis: {} as never,
      architecture: {} as never,
      indexing: null,
      intelligence: {
        score: 95,
        grade: "excellent",
      },
      retrieval: {} as never,
    });

    expect(markdown).toContain("# Repository Intelligence");
    expect(markdown).toContain("Health Score: 90");
    expect(markdown).toContain("Intelligence Score: 95");
  });
});