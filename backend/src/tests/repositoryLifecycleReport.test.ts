import { describe, expect, it } from "vitest";

import { buildRepositoryLifecycleReport } from "../services/repository/repositoryLifecycleReport.js";

describe("repository lifecycle report", () => {
  it("builds lifecycle report for changed repository", () => {
    const report = buildRepositoryLifecycleReport({
      added: 3,
      modified: 6,
      deleted: 1,
    });

    expect(report.changes.summary.totalChanges).toBe(10);
    expect(report.decision.shouldReindex).toBe(true);
    expect(report.plan.mode).toBe("incremental");
  });

  it("builds no-op lifecycle report for unchanged repository", () => {
    const report = buildRepositoryLifecycleReport({
      added: 0,
      modified: 0,
      deleted: 0,
    });

    expect(report.changes.severity).toBe("none");
    expect(report.decision.shouldReindex).toBe(false);
    expect(report.plan.mode).toBe("none");
  });
});