import { describe, expect, it } from "vitest";

import { buildRepositoryReindexDecision } from "../services/repository/repositoryReindexDecision.js";

describe("repository reindex decision", () => {
  it("requests reindex for high severity", () => {
    const decision = buildRepositoryReindexDecision({
      summary: {
        filesAdded: 10,
        filesModified: 15,
        filesDeleted: 2,
        totalChanges: 27,
      },
      severity: "high",
      shouldReindex: true,
    });

    expect(decision.shouldReindex).toBe(true);
    expect(decision.reason).toContain("High");
  });

  it("skips reindex when repository is unchanged", () => {
    const decision = buildRepositoryReindexDecision({
      summary: {
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        totalChanges: 0,
      },
      severity: "none",
      shouldReindex: false,
    });

    expect(decision.shouldReindex).toBe(false);
  });
});