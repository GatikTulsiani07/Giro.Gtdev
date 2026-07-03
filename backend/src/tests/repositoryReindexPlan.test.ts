import { describe, expect, it } from "vitest";

import { buildRepositoryReindexPlan } from "../services/repository/repositoryReindexPlan.js";

describe("repository reindex plan", () => {
  it("returns no-op plan when reindex is not needed", () => {
    const plan = buildRepositoryReindexPlan({
      shouldReindex: false,
      reason: "Repository has no changes.",
    });

    expect(plan.shouldRun).toBe(false);
    expect(plan.mode).toBe("none");
  });

  it("uses full mode for high severity changes", () => {
    const plan = buildRepositoryReindexPlan({
      shouldReindex: true,
      reason: "High repository activity detected.",
    });

    expect(plan.shouldRun).toBe(true);
    expect(plan.mode).toBe("full");
  });

  it("uses incremental mode for non-high changes", () => {
    const plan = buildRepositoryReindexPlan({
      shouldReindex: true,
      reason: "Moderate repository changes detected.",
    });

    expect(plan.shouldRun).toBe(true);
    expect(plan.mode).toBe("incremental");
  });
});