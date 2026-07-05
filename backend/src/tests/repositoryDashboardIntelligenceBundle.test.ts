import { beforeEach, describe, expect, it } from "vitest";

import {
  buildRepositoryDashboardIntelligenceBundle,
  buildRepositoryDashboardIntelligenceBundleForRepository,
} from "../services/repository/repositoryDashboardIntelligenceBundle.js";
import {
  clearRepositoryIndexRegistry,
  setRepositoryIndexed,
  type IndexedCounts,
} from "../services/repository/indexingService.js";
import { buildRepositoryDashboardSummary } from "../services/repository/repositoryDashboardSummary.js";
import {
  clearRepositoryLifecycleEvents,
  recordRepositoryLifecycleEvent,
  type RepositoryLifecycleEvent,
} from "../services/repository/repositoryLifecycleEvents.js";
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

function seedRepository(): void {
  setRepositoryIndexed(OWNER, REPO, COUNTS);
}

function event(
  overrides: Partial<RepositoryLifecycleEvent> = {},
): RepositoryLifecycleEvent {
  return {
    repositoryId: REPOSITORY_ID,
    sequence: 1,
    type: "repository_dashboard_viewed",
    message: "Repository dashboard summary viewed.",
    metadata: {
      files: COUNTS.fileCount,
      chunks: COUNTS.chunkCount,
      symbols: COUNTS.symbolCount,
    },
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

beforeEach(() => {
  clearRepositoryIndexRegistry();
  clearRepositoryLifecycleEvents();
});

describe("repository dashboard intelligence bundle", () => {
  it("1. builds complete bundle", () => {
    seedRepository();
    const dashboard = buildRepositoryDashboardSummary(OWNER, REPO);
    const retrievalExplainability = retrieval();

    const bundle = buildRepositoryDashboardIntelligenceBundle({
      dashboard,
      events: [event()],
      retrievalExplainability,
    });

    expect(bundle.repositoryId).toBe(REPOSITORY_ID);
    expect(bundle.dashboard).toBe(dashboard);
    expect(bundle.health.repositoryId).toBe(REPOSITORY_ID);
    expect(bundle.health.healthy).toBe(true);
    expect(bundle.aiReadiness.ready).toBe(true);
    expect(bundle.insights.insights.map((insight) => insight.id)).toEqual([
      "health.ready",
      "indexing.ready",
      "retrieval.semantic-dominant",
      "retrieval.multi-file-grounding",
      "lifecycle.activity-recorded",
      "architecture.graph-signals-available",
    ]);
    expect(bundle.timeline.map((item) => item.type)).toEqual([
      "repository_dashboard_viewed",
    ]);
    expect(bundle.retrievalExplainability).toBe(retrievalExplainability);
  });

  it("2. handles missing optional retrieval and timeline", () => {
    seedRepository();
    const bundle = buildRepositoryDashboardIntelligenceBundle({
      dashboard: buildRepositoryDashboardSummary(OWNER, REPO),
    });

    expect(bundle.timeline).toEqual([]);
    expect(bundle.retrievalExplainability).toBeUndefined();
    expect(bundle.insights.insights.map((insight) => insight.id)).toEqual([
      "health.ready",
      "indexing.ready",
      "lifecycle.no-activity",
      "architecture.graph-signals-available",
    ]);
    expect(bundle.aiReadiness.signals.retrievalResultsAvailable).toBeNull();
  });

  it("3. preserves stable output", () => {
    seedRepository();
    const input = {
      dashboard: buildRepositoryDashboardSummary(OWNER, REPO),
      events: [
        event({
          sequence: 2,
          type: "repository_cleanup_reported",
          message: "Repository cleanup report built.",
          metadata: {
            totalSkipped: 0,
            totalExecuted: 1,
          },
        }),
        event({
          sequence: 1,
          type: "repository_dashboard_viewed",
        }),
      ],
      retrievalExplainability: retrieval(),
    };

    expect(buildRepositoryDashboardIntelligenceBundle(input)).toEqual(
      buildRepositoryDashboardIntelligenceBundle(input),
    );
    expect(
      buildRepositoryDashboardIntelligenceBundle(input).timeline.map(
        (item) => item.sequence,
      ),
    ).toEqual([1, 2]);
  });

  it("4. does not mutate inputs", () => {
    seedRepository();
    const input = {
      dashboard: buildRepositoryDashboardSummary(OWNER, REPO),
      events: [
        event({
          metadata: {
            resources: ["symbols", "metadata"],
          },
        }),
      ],
      retrievalExplainability: retrieval(),
    };
    const before = structuredClone(input);

    const bundle = buildRepositoryDashboardIntelligenceBundle(input);
    bundle.timeline[0]!.metadata.resources = ["mutated"];

    expect(input).toEqual(before);
  });

  it("5. convenience helper reads existing repository services", () => {
    seedRepository();
    recordRepositoryLifecycleEvent({
      repositoryId: REPOSITORY_ID,
      type: "repository_dashboard_viewed",
      message: "Repository dashboard summary viewed.",
      metadata: {
        files: COUNTS.fileCount,
        chunks: COUNTS.chunkCount,
      },
    });

    const bundle = buildRepositoryDashboardIntelligenceBundleForRepository(
      OWNER,
      REPO,
    );

    expect(bundle.repositoryId).toBe(REPOSITORY_ID);
    expect(bundle.dashboard.metrics).toEqual({
      files: COUNTS.fileCount,
      chunks: COUNTS.chunkCount,
      symbols: COUNTS.symbolCount,
      graphNodes: COUNTS.graphNodeCount,
      graphEdges: COUNTS.graphEdgeCount,
    });
    expect(bundle.timeline.map((item) => item.type)).toEqual([
      "repository_dashboard_viewed",
    ]);
    expect(bundle.aiReadiness.ready).toBe(true);
  });
});
