import { describe, expect, it } from "vitest";

import {
  clearRepositoryIntelligenceHistory,
  getRepositoryIntelligenceHistory,
  saveRepositoryIntelligence,
} from "../services/repository/repositoryIntelligenceHistory.js";

describe("repository intelligence history", () => {
  it("stores repository intelligence snapshots", () => {
    clearRepositoryIntelligenceHistory("demo/repo");

    saveRepositoryIntelligence({
      repositoryId: "demo/repo",
      repositoryName: "demo",
      status: {} as never,
      summary: {} as never,
      analysis: {} as never,
      architecture: {} as never,
      indexing: null,
      intelligence: {} as never,
      retrieval: {} as never,
    });

    expect(
      getRepositoryIntelligenceHistory("demo/repo"),
    ).toHaveLength(1);
  });
});