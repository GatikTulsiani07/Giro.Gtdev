import { beforeEach, describe, expect, it } from "vitest";

import {
  clearGraphSourceStore,
  getFileSymbolMaps,
  setFileSymbolMap,
} from "../services/repository/graphSourceStore.js";
import {
  clearRepositoryFileSnapshots,
  getRepositoryFileSnapshot,
  saveRepositoryFileSnapshot,
} from "../services/repository/fileSnapshotStore.js";
import {
  clearRepositoryIndexRegistry,
  getRepositoryIndexMetadata,
  setRepositoryIndexed,
  type IndexedCounts,
} from "../services/repository/indexingService.js";
import {
  clearRepositoryOwners,
  getRepositoryOwner,
  setRepositoryOwner,
} from "../services/repository/ownershipStore.js";
import {
  executeRepositoryCleanupPlan,
} from "../services/repository/repositoryCleanupExecutor.js";
import {
  buildRepositoryCleanupPlan,
} from "../services/repository/repositoryCleanupPlanner.js";
import {
  clearRepositoryIntelligenceHistory,
  getRepositoryIntelligenceHistory,
  saveRepositoryIntelligence,
} from "../services/repository/repositoryIntelligenceHistory.js";
import type { RepositoryIntelligenceResult } from "../services/repository/repositoryIntelligenceService.js";
import {
  clearRepositorySymbolIndex,
  getRepositorySymbols,
  saveRepositorySymbols,
} from "../services/repository/symbolIndexStore.js";
import { clearAllSessions, createSession } from "../services/sessions/store.js";
import { getSessionById } from "../services/sessions/sessionService.js";
import type { Session } from "../services/sessions/types.js";
import type { FileSymbolMap } from "../services/graph/types.js";
import type { ScannedFile } from "../services/repository/scanner.js";

const REPO_ID = "acme/demo";
const COUNTS: IndexedCounts = {
  chunkCount: 3,
  fileCount: 2,
  symbolCount: 2,
  graphNodeCount: 2,
  graphEdgeCount: 1,
  summaryAvailable: true,
};

function scanned(filePath: string): ScannedFile {
  return {
    filePath,
    size: 10,
    language: "typescript",
  };
}

function fileMap(filePath: string): FileSymbolMap {
  return {
    filePath,
    language: "typescript",
    symbols: [
      {
        name: filePath.endsWith("a.ts") ? "alpha" : "beta",
        kind: "function",
        exported: true,
        line: filePath.endsWith("a.ts") ? 1 : 2,
      },
    ],
    imports: [],
  };
}

function session(id: string, owner = "acme", repo = "demo"): Session {
  return {
    id,
    userId: "user-a",
    owner,
    repo,
    title: `${owner}/${repo}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    selectedContext: [],
  };
}

function intelligence(repositoryId: string): RepositoryIntelligenceResult {
  return {
    repositoryId,
    repositoryName: repositoryId.split("/")[1] ?? repositoryId,
  } as RepositoryIntelligenceResult;
}

function seedRepository(): void {
  setRepositoryOwner(REPO_ID, "user-a");
  setRepositoryIndexed("acme", "demo", COUNTS);
  saveRepositoryFileSnapshot(REPO_ID, [
    scanned("src/z.ts"),
    scanned("src/a.ts"),
  ]);
  saveRepositorySymbols(REPO_ID, [
    {
      filePath: "src/z.ts",
      symbolName: "zeta",
      kind: "function",
      startLine: 5,
      endLine: 5,
    },
    {
      filePath: "src/a.ts",
      symbolName: "alpha",
      kind: "function",
      startLine: 1,
      endLine: 1,
    },
  ]);
  setFileSymbolMap(REPO_ID, fileMap("src/z.ts"));
  setFileSymbolMap(REPO_ID, fileMap("src/a.ts"));
  saveRepositoryIntelligence(intelligence(REPO_ID));
  createSession(session("session-z"));
  createSession(session("session-a"));
  createSession(session("session-other", "acme", "other"));
}

beforeEach(() => {
  clearRepositoryIndexRegistry();
  clearRepositoryFileSnapshots();
  clearRepositorySymbolIndex();
  clearGraphSourceStore();
  clearRepositoryIntelligenceHistory(REPO_ID);
  clearRepositoryIntelligenceHistory("acme/other");
  clearRepositoryOwners();
  clearAllSessions();
});

describe("repository cleanup executor", () => {
  it("removes supported repository metadata from in-memory stores", () => {
    seedRepository();
    const plan = buildRepositoryCleanupPlan("acme", "demo");

    executeRepositoryCleanupPlan(plan);

    expect(getRepositoryIndexMetadata("acme", "demo")).toBeNull();
    expect(getRepositoryFileSnapshot(REPO_ID)).toBeNull();
    expect(getRepositorySymbols(REPO_ID)).toEqual([]);
    expect(getFileSymbolMaps(REPO_ID)).toEqual([]);
    expect(getRepositoryIntelligenceHistory(REPO_ID)).toEqual([]);
    expect(getSessionById("session-a")).toBeNull();
    expect(getSessionById("session-z")).toBeNull();
    expect(getSessionById("session-other")).not.toBeNull();
    expect(getRepositoryOwner(REPO_ID)).toBe("user-a");
  });

  it("returns executed and skipped resource identifiers", () => {
    seedRepository();
    const plan = buildRepositoryCleanupPlan("acme", "demo");

    const report = executeRepositoryCleanupPlan(plan);

    expect(report.repositoryId).toBe(REPO_ID);
    expect(report.executedResourceIdentifiers).toEqual([
      "fileSnapshots:src/a.ts",
      "fileSnapshots:src/z.ts",
      "graphMetadata:src/a.ts",
      "graphMetadata:src/z.ts",
      `repositoryIntelligenceHistory:${plan.sections.repositoryIntelligenceHistory.identifiers[0]}`,
      "repositoryMetadata:acme/demo",
      "sessionReferences:session-a",
      "sessionReferences:session-z",
      "symbolRecords:src/a.ts:1:1:function:alpha",
      "symbolRecords:src/z.ts:5:5:function:zeta",
    ]);
    expect(report.skippedResourceIdentifiers).toEqual([
      "cachedRetrievalArtifacts:unsupported",
    ]);
    expect(report.totalExecuted).toBe(report.executedResourceIdentifiers.length);
    expect(report.totalSkipped).toBe(1);
  });

  it("is deterministic for the same cleanup plan", () => {
    seedRepository();
    const plan = buildRepositoryCleanupPlan("acme", "demo");

    const first = executeRepositoryCleanupPlan(plan);
    const second = executeRepositoryCleanupPlan(plan);

    expect(second).toEqual(first);
  });

  it("skips unsupported placeholder cleanup resources without throwing", () => {
    const plan = buildRepositoryCleanupPlan("ghost", "missing");

    expect(() => executeRepositoryCleanupPlan(plan)).not.toThrow();
    expect(executeRepositoryCleanupPlan(plan)).toEqual({
      repositoryId: "ghost/missing",
      executedResourceIdentifiers: [],
      skippedResourceIdentifiers: ["cachedRetrievalArtifacts:unsupported"],
      totalExecuted: 0,
      totalSkipped: 1,
    });
  });

  it("does not mutate the original plan object", () => {
    seedRepository();
    const plan = buildRepositoryCleanupPlan("acme", "demo");
    const before = structuredClone(plan);

    executeRepositoryCleanupPlan(plan);

    expect(plan).toEqual(before);
  });
});
