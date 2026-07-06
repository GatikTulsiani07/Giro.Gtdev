import {
  buildRepositoryActivityTimeline,
  type RepositoryActivityTimelineItem,
} from "./repositoryActivityTimeline.js";
import {
  analyzeRepositoryArchitecture,
  type RepositoryDependencyGraph,
  type RepositoryArchitectureAnalysis,
} from "./repositoryArchitectureAnalyzer.js";
import {
  buildRepositoryAiReadinessResult,
  type RepositoryAiReadinessResult,
} from "./repositoryAiReadinessEngine.js";
import type { RepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import {
  buildRepositoryHealthEngineResult,
  type RepositoryHealthEngineResult,
} from "./repositoryHealthEngine.js";
import {
  analyzeRepositoryHotspots,
  type RepositoryHotspotReport,
} from "./repositoryHotspotAnalyzer.js";
import {
  type RepositoryInsightsEngineResult,
} from "./repositoryInsightsEngine.js";
import {
  buildRepositoryIntelligencePresentation,
  type RepositoryIntelligencePresentation,
} from "./repositoryIntelligencePresenter.js";
import {
  buildRepositoryIntelligenceReport,
  type RepositoryIntelligenceReport,
} from "./repositoryIntelligenceReport.js";
import {
  buildRepositoryRecommendations,
  type RepositoryRecommendationResult,
} from "./repositoryRecommendationEngine.js";
import {
  analyzeRepositoryRisk,
  type RepositoryRiskReport,
} from "./repositoryRiskAnalyzer.js";
import type { RepositoryLifecycleEvent } from "./repositoryLifecycleEvents.js";
import type { RetrievalExplainabilitySummary } from "../retrieval/retrievalExplainabilitySummary.js";

export const REPOSITORY_INTELLIGENCE_WORKFLOW_VERSION = "1.0.0";

export type RepositoryIntelligenceWorkflowStageStatus = "completed" | "warning";

export interface RepositoryIntelligenceWorkflowInput {
  repositoryId?: string;
  dashboard: RepositoryDashboardSummary;
  graph: RepositoryDependencyGraph;
  insights: RepositoryInsightsEngineResult;
  events?: readonly RepositoryLifecycleEvent[];
  timeline?: readonly RepositoryActivityTimelineItem[];
  retrievalExplainability?: RetrievalExplainabilitySummary;
}

export interface RepositoryIntelligenceWorkflowStage<TOutput = unknown> {
  name: string;
  status: RepositoryIntelligenceWorkflowStageStatus;
  output: TOutput;
}

export interface RepositoryIntelligenceWorkflowResults {
  health: RepositoryHealthEngineResult;
  architecture: RepositoryArchitectureAnalysis;
  hotspots: RepositoryHotspotReport;
  risk: RepositoryRiskReport;
  aiReadiness: RepositoryAiReadinessResult;
  recommendations: RepositoryRecommendationResult;
  intelligenceReport: RepositoryIntelligenceReport;
  presentation: RepositoryIntelligencePresentation;
}

export interface RepositoryIntelligenceWorkflowResult {
  repositoryId: string;
  workflowVersion: string;
  stages: RepositoryIntelligenceWorkflowStage[];
  results: RepositoryIntelligenceWorkflowResults;
  finalPresentation: RepositoryIntelligencePresentation;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function repositoryIdFor(input: RepositoryIntelligenceWorkflowInput): string {
  return input.repositoryId ?? input.dashboard.repository ?? input.insights.repositoryId;
}

function timelineFor(
  input: RepositoryIntelligenceWorkflowInput,
): RepositoryActivityTimelineItem[] {
  if (input.timeline !== undefined) {
    return input.timeline.map((item) => ({
      ...item,
      metadata: { ...item.metadata },
    }));
  }

  if (input.events !== undefined) {
    return buildRepositoryActivityTimeline(input.events);
  }

  return [];
}

function stage<TOutput>(
  name: string,
  output: TOutput,
  warning: boolean,
): RepositoryIntelligenceWorkflowStage<TOutput> {
  return {
    name,
    status: warning ? "warning" : "completed",
    output: copy(output),
  };
}

function hasHotspots(hotspots: RepositoryHotspotReport): boolean {
  return (
    hotspots.summary.critical +
      hotspots.summary.high +
      hotspots.summary.medium +
      hotspots.summary.low >
    0
  );
}

function hasRecommendationWarnings(
  recommendations: RepositoryRecommendationResult,
): boolean {
  return recommendations.summary.critical + recommendations.summary.warnings > 0;
}

export function runRepositoryIntelligenceWorkflow(
  input: RepositoryIntelligenceWorkflowInput,
): RepositoryIntelligenceWorkflowResult {
  const repositoryId = repositoryIdFor(input);
  const timeline = timelineFor(input);
  const stages: RepositoryIntelligenceWorkflowStage[] = [];

  const health = buildRepositoryHealthEngineResult({
    dashboard: input.dashboard,
    events: input.events ?? [],
  });
  stages.push(stage("RepositoryHealthEngine", health, !health.healthy || health.warnings.length > 0));

  const architecture = analyzeRepositoryArchitecture(input.graph);
  stages.push(
    stage(
      "RepositoryArchitectureAnalyzer",
      architecture,
      architecture.hasCycles ||
        architecture.circularDependencyCount > 0 ||
        architecture.architectureComplexityScore >= 70,
    ),
  );

  const hotspots = analyzeRepositoryHotspots({
    graph: input.graph,
    architecture,
    health,
    insights: input.insights,
  });
  stages.push(stage("RepositoryHotspotAnalyzer", hotspots, hasHotspots(hotspots)));

  const risk = analyzeRepositoryRisk({
    health,
    architecture,
    hotspots,
    insights: input.insights,
  });
  stages.push(stage("RepositoryRiskAnalyzer", risk, risk.level !== "LOW" || risk.blockers.length > 0));

  const aiReadiness = buildRepositoryAiReadinessResult({
    repositoryId,
    dashboard: input.dashboard,
    health,
    insights: input.insights,
    retrievalExplainability: input.retrievalExplainability,
  });
  stages.push(
    stage(
      "RepositoryAiReadinessEngine",
      aiReadiness,
      !aiReadiness.ready ||
        aiReadiness.blockers.length > 0 ||
        aiReadiness.warnings.length > 0,
    ),
  );

  const recommendations = buildRepositoryRecommendations({
    dashboard: input.dashboard,
    health,
    aiReadiness,
    insights: input.insights,
    timeline,
  });
  stages.push(
    stage(
      "RepositoryRecommendationEngine",
      recommendations,
      hasRecommendationWarnings(recommendations),
    ),
  );

  const intelligenceReport = buildRepositoryIntelligenceReport({
    dashboard: input.dashboard,
    health,
    aiReadiness,
    insights: input.insights,
    recommendations,
    timeline,
  });
  stages.push(
    stage(
      "RepositoryIntelligenceReport",
      intelligenceReport,
      intelligenceReport.summary.status !== "healthy",
    ),
  );

  const presentation = buildRepositoryIntelligencePresentation(intelligenceReport);
  stages.push(
    stage(
      "RepositoryIntelligencePresenter",
      presentation,
      presentation.quickStats.critical > 0 || presentation.quickStats.warnings > 0,
    ),
  );

  const results: RepositoryIntelligenceWorkflowResults = {
    health: copy(health),
    architecture: copy(architecture),
    hotspots: copy(hotspots),
    risk: copy(risk),
    aiReadiness: copy(aiReadiness),
    recommendations: copy(recommendations),
    intelligenceReport: copy(intelligenceReport),
    presentation: copy(presentation),
  };

  return {
    repositoryId,
    workflowVersion: REPOSITORY_INTELLIGENCE_WORKFLOW_VERSION,
    stages: stages.map((item) => copy(item)),
    results,
    finalPresentation: copy(presentation),
  };
}
