import { describe, expect, it } from "vitest";
import { mapRepositoryIntelligenceResponse } from "../services/repository/repositoryIntelligenceResponseMapper.js";

describe("repository intelligence response mapper", () => {
  it("maps intelligence response", () => {
    const response = mapRepositoryIntelligenceResponse({
      repositoryId: "demo/repo",
      repositoryName: "demo",

      status: {
        indexed: true,
        architectureReady: true,
        retrievalReady: true,
        ready: true,
      },

      summary: {
        healthScore: 88,
        healthCategory: "good",
        hasArchitectureReport: true,
        retrievalGrade: "A",
        indexStatus: "indexed",
      },

      analysis: {} as never,
      architecture: {} as never,
      indexing: {} as never,

      intelligence: {
        score: 94,
        grade: "A",
      } as never,

      readiness: {
        score: 91,
        level: "excellent",
      },

      retrieval: {
        context: {} as never,
        quality: {} as never,
        indexingReport: {} as never,
      },
    });

    expect(response.health).toBe(88);
    expect(response.intelligence).toBe(94);
    expect(response.readiness).toBe(91);
    expect(response.status.ready).toBe(true);
  });
});