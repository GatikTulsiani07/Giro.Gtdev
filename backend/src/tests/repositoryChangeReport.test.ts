import { describe, expect, it } from "vitest";

import { buildRepositoryChangeReport } from "../services/repository/repositoryChangeReport.js";

describe("repository change report", () => {
  it("builds repository change report", () => {
    const report = buildRepositoryChangeReport({
      added: 3,
      modified: 5,
      deleted: 2,
    });

    expect(report.summary.totalChanges).toBe(10);
    expect(report.severity).toBe("medium");
    expect(report.shouldReindex).toBe(true);
  });

  it("does not require reindex when there are no changes", () => {
    const report = buildRepositoryChangeReport({
      added: 0,
      modified: 0,
      deleted: 0,
    });

    expect(report.severity).toBe("none");
    expect(report.shouldReindex).toBe(false);
  });
});