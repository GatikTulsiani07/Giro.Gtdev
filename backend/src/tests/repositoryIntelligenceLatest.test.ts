import { describe, expect, it } from "vitest";

import {
  clearRepositoryIntelligenceHistory,
  saveRepositoryIntelligence,
} from "../services/repository/repositoryIntelligenceHistory.js";

import { getLatestRepositoryIntelligence } from "../services/repository/repositoryIntelligenceLatest.js";

describe("repository intelligence latest", () => {
  it("returns latest snapshot", () => {
    clearRepositoryIntelligenceHistory("demo/repo");

    const first = {
      repositoryId: "demo/repo",
      repositoryName: "demo",
    } as never;

    const second = {
      repositoryId: "demo/repo",
      repositoryName: "demo-new",
    } as never;

    saveRepositoryIntelligence(first);
    saveRepositoryIntelligence(second);

    expect(getLatestRepositoryIntelligence("demo/repo")).toEqual(second);
  });

  it("returns null when no snapshot exists", () => {
    clearRepositoryIntelligenceHistory("missing/repo");

    expect(getLatestRepositoryIntelligence("missing/repo")).toBeNull();
  });
});