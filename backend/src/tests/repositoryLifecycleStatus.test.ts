import { describe, expect, it } from "vitest";

import { buildRepositoryLifecycleReport } from "../services/repository/repositoryLifecycleReport.js";
import { buildRepositoryLifecycleStatus } from "../services/repository/repositoryLifecycleStatus.js";

describe("repository lifecycle status", () => {
  it("marks unchanged repository as ready", () => {
    const report = buildRepositoryLifecycleReport({
      added: 0,
      modified: 0,
      deleted: 0,
    });

    const status = buildRepositoryLifecycleStatus(report);

    expect(status.state).toBe("ready");
    expect(status.healthy).toBe(true);
  });

  it("marks changed repository as indexing", () => {
    const report = buildRepositoryLifecycleReport({
      added: 2,
      modified: 3,
      deleted: 0,
    });

    const status = buildRepositoryLifecycleStatus(report);

    expect(status.state).toBe("indexing");
    expect(status.healthy).toBe(false);
  });

  it("marks heavily changed repository for full reindex", () => {
    const report = buildRepositoryLifecycleReport({
      added: 20,
      modified: 15,
      deleted: 5,
    });

    const status = buildRepositoryLifecycleStatus(report);

    expect(status.state).toBe("reindex-required");
    expect(status.healthy).toBe(false);
  });
});