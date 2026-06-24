import { describe, expect, it } from "vitest";

import { exportRepositoryAnalysisMarkdown } from "../services/repository/repositoryAnalysisExport.js";

describe("repository analysis export", () => {
  it("exports repository analysis as markdown", () => {
    const result = exportRepositoryAnalysisMarkdown({
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

    expect(result.format).toBe("markdown");
    expect(result.content).toContain("# demo-repo");
  });
});