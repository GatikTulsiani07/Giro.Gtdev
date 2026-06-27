import { describe, expect, it } from "vitest";

import {
  clearRepositoryIntelligenceHistory,
  saveRepositoryIntelligence,
} from "../services/repository/repositoryIntelligenceHistory.js";

import { getRepositoryIntelligenceSnapshot } from "../services/repository/repositoryIntelligenceSnapshot.js";

describe("repository intelligence snapshot", () => {
  it("returns snapshot by index", () => {
    clearRepositoryIntelligenceHistory("demo/repo");

    const first = {
      repositoryId: "demo/repo",
      repositoryName: "first",
    } as never;

    const second = {
      repositoryId: "demo/repo",
      repositoryName: "second",
    } as never;

    saveRepositoryIntelligence(first);
    saveRepositoryIntelligence(second);

    expect(
      getRepositoryIntelligenceSnapshot("demo/repo", 0),
    ).toEqual(first);

    expect(
      getRepositoryIntelligenceSnapshot("demo/repo", 1),
    ).toEqual(second);
  });

  it("returns null for invalid index", () => {
    clearRepositoryIntelligenceHistory("demo/repo");

    expect(
      getRepositoryIntelligenceSnapshot("demo/repo", 0),
    ).toBeNull();
  });
});