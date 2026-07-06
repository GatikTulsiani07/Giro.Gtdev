import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { RepositoryDependencyEdge } from "../services/repository/repositoryDependencyGraph.js";
import type { RepositoryDashboardSummary } from "../services/repository/repositoryDashboardSummary.js";
import type { RepositoryInsightsEngineResult } from "../services/repository/repositoryInsightsEngine.js";
import {
  runRepositoryIntelligenceWorkflow,
  type RepositoryIntelligenceWorkflowInput,
} from "../services/repository/repositoryIntelligenceWorkflow.js";

const STAGE_ORDER = [
  "RepositoryHealthEngine",
  "RepositoryArchitectureAnalyzer",
  "RepositoryHotspotAnalyzer",
  "RepositoryRiskAnalyzer",
  "RepositoryAiReadinessEngine",
  "RepositoryRecommendationEngine",
  "RepositoryIntelligenceReport",
  "RepositoryIntelligencePresenter",
];

function dashboard(overrides: Partial<RepositoryDashboardSummary> = {}): RepositoryDashboardSummary {
  return {
    repository: "acme/demo",
    status: {
      repository: "acme/demo",
      health: {
        repository: "acme/demo",
        indexed: true,
        healthy: true,
        stale: false,
        status: "indexed",
        lastIndexedAt: "2026-01-01T00:00:00.000Z",
        lastAccessedAt: "2026-01-02T00:00:00.000Z",
      },
      readiness: {
        repository: "acme/demo",
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
      symbols: 12,
      graphNodes: 4,
      graphEdges: 3,
    },
    ...overrides,
  };
}

function graph(edges: RepositoryDependencyEdge[] = []): RepositoryIntelligenceWorkflowInput["graph"] {
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }

  return {
    listNodes: () => [...nodes].sort((a, b) => a.localeCompare(b)),
    listEdges: () =>
      edges
        .map((edge) => ({ ...edge }))
        .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    getDependencies: (filePath: string) =>
      edges
        .filter((edge) => edge.from === filePath)
        .map((edge) => edge.to)
        .sort((a, b) => a.localeCompare(b)),
    getDependents: (filePath: string) =>
      edges
        .filter((edge) => edge.to === filePath)
        .map((edge) => edge.from)
        .sort((a, b) => a.localeCompare(b)),
    hasCycle: () => false,
  };
}

function cyclicGraph(): RepositoryIntelligenceWorkflowInput["graph"] {
  const base = graph([
    { from: "src/a.ts", to: "src/b.ts" },
    { from: "src/b.ts", to: "src/a.ts" },
  ]);
  return {
    ...base,
    hasCycle: () => true,
  };
}

function insights(
  overrides: Partial<RepositoryInsightsEngineResult> = {},
): RepositoryInsightsEngineResult {
  return {
    repositoryId: "acme/demo",
    insights: [
      {
        id: "health.ready",
        type: "health",
        severity: "success",
        title: "Repository is healthy",
        description: "Repository is indexed, ready, and not stale.",
        signals: {},
      },
    ],
    summary: {
      total: 1,
      critical: 0,
      warnings: 0,
      successes: 1,
      informational: 0,
    },
    ...overrides,
  };
}

function input(
  overrides: Partial<RepositoryIntelligenceWorkflowInput> = {},
): RepositoryIntelligenceWorkflowInput {
  return {
    dashboard: dashboard(),
    graph: graph([
      { from: "src/app.ts", to: "src/service.ts" },
      { from: "src/service.ts", to: "src/store.ts" },
    ]),
    insights: insights(),
    timeline: [
      {
        repositoryId: "acme/demo",
        sequence: 1,
        type: "repository_dashboard_viewed",
        label: "Dashboard viewed",
        title: "Dashboard summary viewed",
        message: "Repository dashboard summary viewed.",
        tone: "info",
        metadata: { files: 4 },
      },
    ],
    ...overrides,
  };
}

describe("repository intelligence workflow", () => {
  it("runs a healthy repository workflow", () => {
    const result = runRepositoryIntelligenceWorkflow(input());

    assert.equal(result.repositoryId, "acme/demo");
    assert.equal(result.workflowVersion, "1.0.0");
    assert.deepEqual(result.stages.map((stage) => stage.name), STAGE_ORDER);
    assert.equal(result.results.health.healthy, true);
    assert.equal(result.results.aiReadiness.ready, true);
    assert.equal(result.results.intelligenceReport.summary.status, "healthy");
    assert.equal(result.finalPresentation.heroCard.status, "healthy");
  });

  it("runs a degraded repository workflow", () => {
    const result = runRepositoryIntelligenceWorkflow(
      input({
        dashboard: dashboard({
          status: {
            ...dashboard().status,
            health: {
              ...dashboard().status.health,
              stale: true,
              healthy: false,
              status: "stale",
            },
            readiness: {
              ...dashboard().status.readiness,
              status: "stale",
              ready: false,
            },
          },
        }),
      }),
    );

    assert.equal(result.results.health.signals.stale, true);
    assert.equal(result.results.aiReadiness.level, "degraded");
    assert.equal(result.results.intelligenceReport.summary.status, "stale");
    assert.equal(result.stages.find((stage) => stage.name === "RepositoryHealthEngine")?.status, "warning");
  });

  it("runs a blocked repository workflow", () => {
    const missingDashboard = dashboard({
      status: {
        ...dashboard().status,
        health: {
          repository: "acme/demo",
          indexed: false,
          healthy: false,
          stale: false,
          status: "missing",
          lastIndexedAt: null,
          lastAccessedAt: null,
        },
        readiness: {
          repository: "acme/demo",
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
    });

    const result = runRepositoryIntelligenceWorkflow(
      input({
        dashboard: missingDashboard,
        graph: graph(),
        insights: insights({
          insights: [],
          summary: {
            total: 0,
            critical: 0,
            warnings: 0,
            successes: 0,
            informational: 0,
          },
        }),
      }),
    );

    assert.equal(result.results.aiReadiness.level, "blocked");
    assert.equal(result.results.intelligenceReport.summary.status, "missing");
    assert.equal(result.finalPresentation.heroCard.badge, "Not indexed");
    assert.equal(result.stages[0]?.status, "warning");
    assert.equal(result.stages[4]?.status, "warning");
    assert.equal(result.stages[5]?.status, "warning");
    assert.equal(result.stages[6]?.status, "warning");
    assert.equal(result.stages[7]?.status, "warning");
  });

  it("preserves deterministic execution order and stage ordering", () => {
    const result = runRepositoryIntelligenceWorkflow(
      input({
        graph: cyclicGraph(),
        insights: insights({
          insights: [
            {
              id: "architecture.cycle",
              type: "architecture",
              severity: "warning",
              title: "Cycle",
              description: "Cycle detected.",
              signals: { module: "src/a.ts" },
            },
          ],
          summary: {
            total: 1,
            critical: 0,
            warnings: 1,
            successes: 0,
            informational: 0,
          },
        }),
      }),
    );

    assert.deepEqual(result.stages.map((stage) => stage.name), STAGE_ORDER);
    assert.equal(result.stages[1]?.status, "warning");
    assert.equal(result.stages[2]?.status, "warning");
  });

  it("returns the same output for repeated execution", () => {
    const workflowInput = input();

    assert.deepEqual(
      runRepositoryIntelligenceWorkflow(workflowInput),
      runRepositoryIntelligenceWorkflow(workflowInput),
    );
  });

  it("does not mutate inputs or previous stage outputs", () => {
    const workflowInput = input();
    const before = JSON.stringify(workflowInput);

    const result = runRepositoryIntelligenceWorkflow(workflowInput);
    result.stages[0]!.output = { mutated: true };
    result.results.health.warnings.push("mutated");
    result.finalPresentation.readinessCard.blockers.push("mutated");

    assert.equal(JSON.stringify(workflowInput), before);
    assert.equal(runRepositoryIntelligenceWorkflow(workflowInput).results.health.warnings.includes("mutated"), false);
  });
});
