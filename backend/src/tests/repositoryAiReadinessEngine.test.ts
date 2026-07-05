import { beforeEach, describe, expect, it } from "vitest";

import {
  buildRepositoryAiReadinessForRepository,
  buildRepositoryAiReadinessResult,
  type RepositoryAiReadinessEngineInput,
} from "../services/repository/repositoryAiReadinessEngine.js";
import {
  clearRepositoryIndexRegistry,
  markRepositoryStale,
  setRepositoryFailed,
  setRepositoryIndexed,
  type IndexedCounts,
} from "../services/repository/indexingService.js";
import { buildRepositoryDashboardSummary } from "../services/repository/repositoryDashboardSummary.js";
import type { RepositoryDashboardSummary } from "../services/repository/repositoryDashboardSummary.js";
import type { RepositoryHealthEngineResult } from "../services/repository/repositoryHealthEngine.js";
import type { RepositoryInsightsEngineResult } from "../services/repository/repositoryInsightsEngine.js";
import type { RetrievalExplainabilitySummary } from "../services/retrieval/retrievalExplainabilitySummary.js";

const OWNER = "acme";
const REPO = "demo";
const REPOSITORY_ID = `${OWNER}/${REPO}`;

const COUNTS: IndexedCounts = {
  chunkCount: 8,
  fileCount: 4,
  symbolCount: 10,
  graphNodeCount: 3,
  graphEdgeCount: 2,
  summaryAvailable: true,
};

function dashboard(
  overrides: Partial<RepositoryDashboardSummary> = {},
): RepositoryDashboardSummary {
  return {
    repository: REPOSITORY_ID,
    status: {
      repository: REPOSITORY_ID,
      health: {
        repository: REPOSITORY_ID,
        indexed: true,
        healthy: true,
        stale: false,
        status: "indexed",
        lastIndexedAt: "2026-01-01T00:00:00.000Z",
        lastAccessedAt: "2026-01-01T00:00:00.000Z",
      },
      readiness: {
        repository: REPOSITORY_ID,
        ready: true,
        status: "indexed",
        indexedFiles: 4,
        indexedChunks: 8,
        lastIndexedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    metrics: {
      files: 4,
      chunks: 8,
      symbols: 10,
      graphNodes: 3,
      graphEdges: 2,
    },
    ...overrides,
  };
}

function health(
  overrides: Partial<RepositoryHealthEngineResult> = {},
): RepositoryHealthEngineResult {
  return {
    repositoryId: REPOSITORY_ID,
    score: 95,
    grade: "excellent",
    healthy: true,
    signals: {
      indexed: true,
      ready: true,
      stale: false,
      hasRecentLifecycleActivity: true,
      cleanupSignalsAvailable: false,
    },
    warnings: [],
    recommendations: [],
    ...overrides,
  };
}

function retrieval(
  overrides: Partial<RetrievalExplainabilitySummary> = {},
): RetrievalExplainabilitySummary {
  return {
    totalResults: 2,
    sourceBreakdown: {
      semantic: 1,
      keyword: 1,
      symbol: 0,
      graph: 0,
      fileSearch: 0,
    },
    topFiles: [
      {
        filePath: "src/a.ts",
        resultCount: 1,
        maxScore: 0.9,
        dominantSource: "semantic",
      },
      {
        filePath: "src/b.ts",
        resultCount: 1,
        maxScore: 0.8,
        dominantSource: "keyword",
      },
    ],
    strongestSignals: [
      {
        source: "semantic",
        filePath: "src/a.ts",
        score: 0.9,
      },
    ],
    warnings: [],
    explanation: ["Retrieved 2 result(s) across 2 file(s)."],
    ...overrides,
  };
}

function insights(
  overrides: Partial<RepositoryInsightsEngineResult> = {},
): RepositoryInsightsEngineResult {
  return {
    repositoryId: REPOSITORY_ID,
    insights: [],
    summary: {
      total: 0,
      critical: 0,
      warnings: 0,
      successes: 0,
      informational: 0,
    },
    ...overrides,
  };
}

beforeEach(() => {
  clearRepositoryIndexRegistry();
});

describe("repository AI readiness engine", () => {
  it("1. missing metadata blocks AI readiness", () => {
    const result = buildRepositoryAiReadinessResult({
      repositoryId: REPOSITORY_ID,
    });

    expect(result.ready).toBe(false);
    expect(result.level).toBe("blocked");
    expect(result.score).toBe(0);
    expect(result.blockers).toEqual([
      "Repository metadata is missing.",
      "Repository is not indexed.",
      "Repository is not ready for retrieval.",
    ]);
  });

  it("2. failed index blocks AI readiness", () => {
    const failedDashboard = dashboard({
      status: {
        ...dashboard().status,
        health: {
          ...dashboard().status.health,
          indexed: false,
          healthy: false,
          stale: false,
          status: "failed",
        },
        readiness: {
          ...dashboard().status.readiness,
          ready: false,
          status: "failed",
        },
      },
    });

    const result = buildRepositoryAiReadinessResult({
      dashboard: failedDashboard,
      health: health({
        score: 20,
        grade: "poor",
        healthy: false,
        signals: {
          indexed: false,
          ready: false,
          stale: false,
          hasRecentLifecycleActivity: false,
          cleanupSignalsAvailable: false,
        },
      }),
    });

    expect(result.level).toBe("blocked");
    expect(result.score).toBe(0);
    expect(result.blockers).toEqual([
      "Repository indexing failed.",
      "Repository is not indexed.",
      "Repository is not ready for retrieval.",
      "Repository health score is critically low.",
    ]);
  });

  it("3. stale repository becomes degraded", () => {
    const staleDashboard = dashboard({
      status: {
        ...dashboard().status,
        health: {
          ...dashboard().status.health,
          stale: true,
          status: "stale",
        },
        readiness: {
          ...dashboard().status.readiness,
          ready: true,
          status: "stale",
        },
      },
    });

    const result = buildRepositoryAiReadinessResult({
      dashboard: staleDashboard,
      health: health({
        score: 80,
        grade: "good",
        healthy: false,
        signals: {
          indexed: true,
          ready: true,
          stale: true,
          hasRecentLifecycleActivity: true,
          cleanupSignalsAvailable: false,
        },
      }),
      retrievalExplainability: retrieval(),
    });

    expect(result.ready).toBe(false);
    expect(result.level).toBe("degraded");
    expect(result.warnings).toEqual(["Repository index is stale."]);
    expect(result.score).toBe(62);
  });

  it("4. healthy indexed repository with retrieval results becomes ready", () => {
    const result = buildRepositoryAiReadinessResult({
      dashboard: dashboard(),
      health: health(),
      insights: insights(),
      retrievalExplainability: retrieval(),
    });

    expect(result.ready).toBe(true);
    expect(result.level).toBe("ready");
    expect(result.score).toBe(95);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("5. zero retrieval results creates warning and degraded state", () => {
    const result = buildRepositoryAiReadinessResult({
      dashboard: dashboard(),
      health: health(),
      retrievalExplainability: retrieval({
        totalResults: 0,
        sourceBreakdown: {
          semantic: 0,
          keyword: 0,
          symbol: 0,
          graph: 0,
          fileSearch: 0,
        },
        topFiles: [],
        strongestSignals: [],
      }),
    });

    expect(result.ready).toBe(false);
    expect(result.level).toBe("degraded");
    expect(result.warnings).toEqual(["Retrieval returned no results."]);
    expect(result.recommendations).toContain(
      "Improve retrieval coverage before relying on AI answers.",
    );
  });

  it("6. recommendations are deterministic", () => {
    const result = buildRepositoryAiReadinessResult({
      dashboard: dashboard(),
      health: health({
        score: 60,
        grade: "fair",
        healthy: false,
        recommendations: [
          "Complete repository indexing to make retrieval available.",
          "Refresh or reindex the repository to restore freshness.",
        ],
      }),
      insights: insights({
        summary: {
          total: 1,
          critical: 0,
          warnings: 1,
          successes: 0,
          informational: 0,
        },
      }),
    });

    expect(result.recommendations).toEqual([
      "Review repository health warnings before relying on AI answers.",
      "Review repository insight warnings in the dashboard.",
      "Complete repository indexing to make retrieval available.",
      "Refresh or reindex the repository to restore freshness.",
    ]);
  });

  it("7. blockers and warnings ordering is stable", () => {
    const result = buildRepositoryAiReadinessResult({
      repositoryId: REPOSITORY_ID,
      health: health({
        score: 35,
        grade: "poor",
        healthy: false,
        signals: {
          indexed: false,
          ready: false,
          stale: true,
          hasRecentLifecycleActivity: false,
          cleanupSignalsAvailable: false,
        },
      }),
      insights: insights({
        summary: {
          total: 2,
          critical: 1,
          warnings: 1,
          successes: 0,
          informational: 0,
        },
      }),
      retrievalExplainability: retrieval({
        totalResults: 0,
        topFiles: [],
        strongestSignals: [],
      }),
    });

    expect(result.blockers).toEqual([
      "Repository metadata is missing.",
      "Repository is not indexed.",
      "Repository is not ready for retrieval.",
      "Critical repository insights require attention.",
    ]);
    expect(result.warnings).toEqual([
      "Repository index is stale.",
      "Retrieval returned no results.",
      "Repository insights include warnings.",
    ]);
  });

  it("8. repeated output is deterministic", () => {
    const input: RepositoryAiReadinessEngineInput = {
      dashboard: dashboard(),
      health: health(),
      insights: insights(),
      retrievalExplainability: retrieval(),
    };

    expect(buildRepositoryAiReadinessResult(input)).toEqual(
      buildRepositoryAiReadinessResult(input),
    );
  });

  it("9. input objects are not mutated", () => {
    const input: RepositoryAiReadinessEngineInput = {
      dashboard: dashboard(),
      health: health({
        recommendations: ["Open the repository dashboard to record lifecycle activity."],
      }),
      insights: insights(),
      retrievalExplainability: retrieval(),
    };
    const before = structuredClone(input);

    buildRepositoryAiReadinessResult(input);

    expect(input).toEqual(before);
  });

  it("10. convenience helper reads existing services correctly", () => {
    setRepositoryIndexed(OWNER, REPO, COUNTS);

    const result = buildRepositoryAiReadinessForRepository(OWNER, REPO);

    expect(result.repositoryId).toBe(REPOSITORY_ID);
    expect(result.ready).toBe(true);
    expect(result.level).toBe("ready");
    expect(result.signals).toMatchObject({
      metadataAvailable: true,
      indexed: true,
      readyForRetrieval: true,
      failed: false,
      stale: false,
      retrievalResultsAvailable: null,
    });
  });

  it("helper reports stale registry state as degraded", () => {
    setRepositoryIndexed(OWNER, REPO, COUNTS);
    markRepositoryStale(OWNER, REPO);

    const result = buildRepositoryAiReadinessForRepository(OWNER, REPO);

    expect(result.level).toBe("degraded");
    expect(result.warnings).toEqual(["Repository index is stale."]);
  });

  it("helper reports failed registry state as blocked", () => {
    setRepositoryFailed(OWNER, REPO);

    const result = buildRepositoryAiReadinessForRepository(OWNER, REPO);

    expect(result.level).toBe("blocked");
    expect(result.blockers).toContain("Repository indexing failed.");
  });
});
