import { describe, expect, it } from "vitest";
import { buildRepositoryChangeSummary } from "../services/repository/repositoryChangeDetector.js";

describe("repository change detector", () => {
  it("builds change summary", () => {
    const result = buildRepositoryChangeSummary({
      added: 3,
      modified: 5,
      deleted: 2,
    });

    expect(result.totalChanges).toBe(10);
    expect(result.filesModified).toBe(5);
  });
});