import { test } from "node:test";
import assert from "node:assert/strict";

import type { RepositoryActivityTimelineItem } from "../services/repository/repositoryActivityTimeline.js";
import type { RepositoryArchitectureAnalysis } from "../services/repository/repositoryArchitectureAnalyzer.js";
import type { RepositoryAiReadinessResult } from "../services/repository/repositoryAiReadinessEngine.js";
import type { RepositoryDashboardSummary } from "../services/repository/repositoryDashboardSummary.js";
import type { RepositoryEvolutionReport } from "../services/repository/repositoryEvolutionTracker.js";
import type { RepositoryHealthEngineResult } from "../services/repository/repositoryHealthEngine.js";
import type { RepositoryHotspotReport } from "../services/repository/repositoryHotspotAnalyzer.js";
import type { RepositoryInsightsEngineResult } from "../services/repository/repositoryInsightsEngine.js";
import type { RepositoryRiskReport } from "../services/repository/repositoryRiskAnalyzer.js";
import type { RepositoryScorecard } from "../services/repository/repositoryScorecardService.js";
import {
  buildRepositoryRecommendations,
  type RepositoryRecommendationInput,
} from "../services/repository/repositoryRecommendationEngine.js";

const REPOSITORY_ID = "acme/demo";

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
      cleanupSignalsAvailable: true,
    },
    warnings: [],
    recommendations: [],
    ...overrides,
  };
}

function architecture(
  overrides: Partial<RepositoryArchitectureAnalysis> = {},
): RepositoryArchitectureAnalysis {
  return {
    totalFiles: 3,
    totalDependencies: 2,
    rootModules: ["src/index.ts"],
    leafModules: ["src/db.ts"],
    isolatedModules: [],
    averageDependencies: 0.67,
    averageDependents: 0.67,
    mostConnectedModules: [
      {
        filePath: "src/service.ts",
        dependencyCount: 1,
        dependentCount: 1,
        totalConnections: 2,
      },
    ],
    circularDependencyCount: 0,
    hasCycles: false,
    architectureComplexityScore: 20,
    ...overrides,
  };
}

function hotspots(overrides: Partial<RepositoryHotspotReport> = {}): RepositoryHotspotReport {
  return {
    repositoryId: REPOSITORY_ID,
    hotspots: [],
    summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
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

function risk(overrides: Partial<RepositoryRiskReport> = {}): RepositoryRiskReport {
  return {
    repositoryId: REPOSITORY_ID,
    score: 8,
    level: "LOW",
    summary: "Repository risk is low.",
    strengths: ["Repository is indexed."],
    risks: [],
    blockers: [],
    signals: {
      healthy: true,
      indexed: true,
      ready: true,
      stale: false,
      healthScore: 95,
      architectureComplexityScore: 20,
      totalFiles: 3,
      totalDependencies: 2,
      circularDependencyCount: 0,
      dependencyHubCount: 0,
      criticalHotspots: 0,
      highHotspots: 0,
      mediumHotspots: 0,
      lowHotspots: 0,
      criticalInsights: 0,
      warningInsights: 0,
      failedIndexingSignals: 0,
    },
    ...overrides,
  };
}

function aiReadiness(
  overrides: Partial<RepositoryAiReadinessResult> = {},
): RepositoryAiReadinessResult {
  return {
    repositoryId: REPOSITORY_ID,
    ready: true,
    score: 95,
    level: "ready",
    blockers: [],
    warnings: [],
    recommendations: [],
    signals: {
      metadataAvailable: true,
      indexed: true,
      readyForRetrieval: true,
      failed: false,
      stale: false,
      healthScore: 95,
      healthHealthy: true,
      retrievalResultsAvailable: true,
      criticalInsights: 0,
      warningInsights: 0,
    },
    ...overrides,
  };
}

function scorecard(overrides: Partial<RepositoryScorecard> = {}): RepositoryScorecard {
  return {
    repositoryId: REPOSITORY_ID,
    overallScore: 94,
    verdict: "EXCELLENT",
    badges: ["AI_READY", "LOW_RISK"],
    strengths: ["Repository is healthy."],
    weaknesses: [],
    blockers: [],
    topActions: [],
    sections: {
      health: { score: 95, status: "excellent", summary: "Healthy." },
      readiness: { score: 95, status: "ready", summary: "Ready." },
      architecture: { score: 95, status: "clear", summary: "No hotspots." },
      risk: { score: 92, status: "LOW", summary: "Low risk." },
      momentum: { score: 50, status: "STABLE", summary: "Stable." },
    },
    summary: "Repository scorecard is excellent.",
    ...overrides,
  };
}

function evolution(
  overrides: Partial<RepositoryEvolutionReport> = {},
): RepositoryEvolutionReport {
  return {
    repositoryId: REPOSITORY_ID,
    trend: "STABLE",
    scoreDelta: 0,
    healthDelta: 0,
    readinessDelta: 0,
    riskDelta: 0,
    newHotspots: [],
    resolvedHotspots: [],
    newBlockers: [],
    resolvedBlockers: [],
    improvements: [],
    regressions: [],
    summary: "Repository intelligence is stable.",
    ...overrides,
  };
}

function cleanupTimeline(): RepositoryActivityTimelineItem[] {
  return [
    {
      repositoryId: REPOSITORY_ID,
      sequence: 1,
      type: "repository_cleanup_executed",
      label: "Cleanup executed",
      title: "Cleanup plan executed",
      message: "Repository cleanup plan executed.",
      tone: "warning",
      metadata: { totalExecuted: 1, totalSkipped: 0 },
    },
  ];
}

function input(
  overrides: Partial<RepositoryRecommendationInput> = {},
): RepositoryRecommendationInput {
  return {
    dashboard: dashboard(),
    health: health(),
    architecture: architecture(),
    hotspots: hotspots(),
    insights: insights(),
    risk: risk(),
    scorecard: scorecard(),
    evolution: evolution(),
    readiness: { score: 95, level: "excellent" },
    aiReadiness: aiReadiness(),
    timeline: cleanupTimeline(),
    ...overrides,
  };
}

test("healthy repository returns a single informational recommendation", () => {
  const result = buildRepositoryRecommendations(input());

  assert.deepEqual(result.recommendations.map((item) => item.id), [
    "repository.healthy",
  ]);
  assert.equal(result.recommendations[0]?.priority, "info");
  assert.equal(result.recommendations[0]?.estimatedImpact, "low");
  assert.equal(result.summary.informational, 1);
});

test("unhealthy repository prioritizes indexing, readiness, risk, and health actions", () => {
  const result = buildRepositoryRecommendations(input({
    dashboard: dashboard({
      status: {
        ...dashboard().status,
        health: {
          ...dashboard().status.health,
          indexed: false,
          healthy: false,
          stale: false,
          status: "missing",
        },
        readiness: {
          ...dashboard().status.readiness,
          ready: false,
          status: "missing",
          indexedFiles: 0,
          indexedChunks: 0,
          lastIndexedAt: null,
        },
      },
      metrics: {
        files: 0,
        chunks: 0,
        symbols: 0,
        graphNodes: 0,
        graphEdges: 0,
      },
    }),
    health: health({
      score: 15,
      grade: "poor",
      healthy: false,
      signals: {
        indexed: false,
        ready: false,
        stale: false,
        hasRecentLifecycleActivity: false,
        cleanupSignalsAvailable: false,
      },
      warnings: ["Repository is not indexed."],
      recommendations: ["Index the repository before relying on dashboard insights."],
    }),
    aiReadiness: aiReadiness({
      ready: false,
      score: 15,
      level: "blocked",
      blockers: ["Repository is not indexed."],
    }),
    risk: risk({
      score: 88,
      level: "CRITICAL",
      summary: "Repository risk is critical.",
      risks: ["Repository is not indexed."],
      blockers: ["Index the repository before relying on analysis."],
    }),
    timeline: [],
  }));

  assert.deepEqual(result.recommendations.map((item) => item.id).slice(0, 5), [
    "indexing.run-indexing",
    "readiness.resolve-blockers",
    "risk.blocker.index-the-repository-before-relying-on-analysis",
    "risk.reduce-repository-risk",
    "health.warning.repository-is-not-indexed",
  ]);
  assert.equal(result.summary.critical, 5);
});

test("dependency hub recommendations are produced from architecture and hotspot signals", () => {
  const result = buildRepositoryRecommendations(input({
    architecture: architecture({
      totalDependencies: 8,
      architectureComplexityScore: 55,
      mostConnectedModules: [
        {
          filePath: "src/container.ts",
          dependencyCount: 3,
          dependentCount: 4,
          totalConnections: 7,
        },
      ],
    }),
    hotspots: hotspots({
      hotspots: [
        {
          id: "architecture.dependency-hubs",
          type: "dependency_hub",
          severity: "high",
          title: "Central dependency hubs",
          description: "Some modules concentrate dependency relationships.",
          affectedModules: ["src/container.ts"],
          reason: "1 module has at least 4 dependency connections.",
        },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 0 },
    }),
  }));

  assert.deepEqual(result.recommendations.map((item) => item.id), [
    "hotspot.architecture.dependency-hubs",
    "architecture.split-dependency-hubs",
  ]);
  assert.deepEqual(result.recommendations[0]?.relatedModules, ["src/container.ts"]);
});

test("hotspot recommendations preserve severity-derived priority and module signals", () => {
  const result = buildRepositoryRecommendations(input({
    hotspots: hotspots({
      hotspots: [
        {
          id: "architecture.circular-clusters",
          type: "cycle_cluster",
          severity: "critical",
          title: "Circular dependency clusters",
          description: "Circular dependencies create tightly coupled regions.",
          affectedModules: ["src/a.ts", "src/b.ts"],
          reason: "1 circular dependency cluster was detected.",
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
    }),
  }));

  assert.equal(result.recommendations[0]?.id, "hotspot.architecture.circular-clusters");
  assert.equal(result.recommendations[0]?.priority, "critical");
  assert.equal(result.recommendations[0]?.estimatedEffort, "high");
  assert.deepEqual(result.recommendations[0]?.relatedModules, [
    "src/a.ts",
    "src/b.ts",
  ]);
});

test("architecture recommendations cover cycles, complexity, and isolated modules", () => {
  const result = buildRepositoryRecommendations(input({
    architecture: architecture({
      circularDependencyCount: 1,
      hasCycles: true,
      architectureComplexityScore: 82,
      isolatedModules: ["src/unused.ts"],
      mostConnectedModules: [
        {
          filePath: "src/core.ts",
          dependencyCount: 5,
          dependentCount: 5,
          totalConnections: 10,
        },
      ],
    }),
  }));

  assert.deepEqual(result.recommendations.map((item) => item.id), [
    "architecture.break-cycles",
    "architecture.reduce-complexity",
    "architecture.split-dependency-hubs",
    "architecture.review-isolated-modules",
  ]);
});

test("risk recommendations include risk summary and individual blockers", () => {
  const result = buildRepositoryRecommendations(input({
    risk: risk({
      score: 63,
      level: "HIGH",
      summary: "Repository risk is high.",
      risks: ["Architecture complexity is high."],
      blockers: ["Resolve critical architecture hotspots."],
    }),
  }));

  assert.deepEqual(result.recommendations.map((item) => item.id), [
    "risk.blocker.resolve-critical-architecture-hotspots",
    "risk.reduce-repository-risk",
  ]);
  assert.equal(result.recommendations[1]?.estimatedImpact, "high");
});

test("recommendation ordering is deterministic across mixed categories", () => {
  const result = buildRepositoryRecommendations(input({
    architecture: architecture({
      circularDependencyCount: 1,
      hasCycles: true,
      architectureComplexityScore: 80,
    }),
    health: health({
      score: 35,
      grade: "poor",
      healthy: false,
      warnings: ["Repository health score is critically low."],
    }),
    insights: insights({
      insights: [
        {
          id: "z-warning",
          type: "retrieval",
          severity: "warning",
          title: "Z warning",
          description: "Warning insight.",
          recommendation: "Review warning.",
          signals: {},
        },
        {
          id: "a-critical",
          type: "architecture",
          severity: "critical",
          title: "A critical",
          description: "Critical insight.",
          recommendation: "Review critical.",
          signals: {},
        },
      ],
      summary: { total: 2, critical: 1, warnings: 1, successes: 0, informational: 0 },
    }),
    risk: risk({
      score: 90,
      level: "CRITICAL",
      blockers: ["Resolve critical repository insights."],
    }),
    timeline: [],
  }));

  assert.deepEqual(result.recommendations.map((item) => item.id).slice(0, 5), [
    "risk.blocker.resolve-critical-repository-insights",
    "risk.reduce-repository-risk",
    "architecture.break-cycles",
    "health.warning.repository-health-score-is-critically-low",
    "insight.a-critical",
  ]);
});

test("repeated execution returns identical immutable values", () => {
  const request = input({
    architecture: architecture({
      isolatedModules: ["src/unused.ts"],
    }),
  });

  const first = buildRepositoryRecommendations(request);
  const second = buildRepositoryRecommendations(request);

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.recommendations), true);
  assert.equal(Object.isFrozen(first.recommendations[0]), true);
});

test("inputs are never mutated", () => {
  const request = input({
    hotspots: hotspots({
      hotspots: [
        {
          id: "architecture.dependency-hubs",
          type: "dependency_hub",
          severity: "high",
          title: "Central dependency hubs",
          description: "Some modules concentrate dependency relationships.",
          affectedModules: ["src/b.ts", "src/a.ts"],
          reason: "2 modules have high dependency connections.",
        },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 0 },
    }),
  });
  const before = structuredClone(request);

  buildRepositoryRecommendations(request);

  assert.deepEqual(request, before);
});

test("empty repository returns indexing and readiness actions without requiring optional outputs", () => {
  const result = buildRepositoryRecommendations({
    dashboard: dashboard({
      status: {
        ...dashboard().status,
        health: {
          ...dashboard().status.health,
          indexed: false,
          healthy: false,
          stale: false,
          status: "missing",
        },
        readiness: {
          ...dashboard().status.readiness,
          ready: false,
          status: "missing",
          indexedFiles: 0,
          indexedChunks: 0,
          lastIndexedAt: null,
        },
      },
      metrics: { files: 0, chunks: 0, symbols: 0, graphNodes: 0, graphEdges: 0 },
    }),
    health: health({
      score: 0,
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
    aiReadiness: aiReadiness({
      ready: false,
      score: 0,
      level: "blocked",
      blockers: ["Repository metadata is missing."],
    }),
  });

  assert.deepEqual(result.recommendations.map((item) => item.id), [
    "indexing.run-indexing",
    "readiness.resolve-blockers",
  ]);
});

test("mixed severity inputs produce stable priority buckets", () => {
  const result = buildRepositoryRecommendations(input({
    readiness: { score: 55, level: "fair" },
    aiReadiness: aiReadiness({
      ready: false,
      score: 62,
      level: "degraded",
      warnings: ["Repository index is stale."],
    }),
    scorecard: scorecard({
      overallScore: 68,
      verdict: "NEEDS_ATTENTION",
      weaknesses: ["Architecture complexity is elevated."],
      topActions: ["Reduce architecture complexity."],
      summary: "Repository scorecard needs attention.",
    }),
    evolution: evolution({
      trend: "REGRESSING",
      scoreDelta: -10,
      newBlockers: ["Resolve critical architecture hotspots."],
      regressions: ["Repository risk increased."],
      summary: "Repository intelligence is regressing.",
    }),
    insights: insights({
      insights: [
        {
          id: "retrieval.single-file-concentration",
          type: "retrieval",
          severity: "warning",
          title: "Retrieval concentrated",
          description: "Retrieval is concentrated in one file.",
          recommendation: "Broaden retrieval coverage.",
          signals: { filePath: "src/only.ts" },
        },
      ],
      summary: { total: 1, critical: 0, warnings: 1, successes: 0, informational: 0 },
    }),
  }));

  assert.deepEqual(result.recommendations.map((item) => item.priority), [
    "high",
    "high",
    "high",
    "medium",
    "medium",
  ]);
  assert.deepEqual(result.recommendations.map((item) => item.id), [
    "insight.retrieval.single-file-concentration",
    "scorecard.needs_attention",
    "evolution.reverse-regression",
    "readiness.improve-degraded",
    "readiness.score.fair",
  ]);
});
