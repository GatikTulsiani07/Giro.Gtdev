import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRepositoryIndexRegistry,
  setRepositoryIndexed,
} from "../services/repository/indexingService.js";

import { buildRepositoryStatusSnapshot } from "../services/repository/repositoryStatusSnapshot.js";

describe("repository status snapshot", () => {
  beforeEach(() => {
    clearRepositoryIndexRegistry();
  });

  it("builds combined repository status snapshot", () => {
    setRepositoryIndexed("acme", "demo", {
      chunkCount: 50,
      fileCount: 10,
      symbolCount: 20,
      graphNodeCount: 8,
      graphEdgeCount: 12,
      summaryAvailable: true,
    });

    const snapshot = buildRepositoryStatusSnapshot("acme", "demo");

    expect(snapshot.repository).toBe("acme/demo");
    expect(snapshot.health.healthy).toBe(true);
    expect(snapshot.readiness.ready).toBe(true);
    expect(snapshot.readiness.indexedFiles).toBe(10);
  });
});