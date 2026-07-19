// Frontend-friendly repository dashboard intelligence bundle. Pure composition
// over existing deterministic product layers: no routes, persistence, LLM,
// async work, I/O, timestamps, randomness, or mutation.

import {
  buildRepositoryActivityTimeline,
  buildRepositoryActivityTimelineForRepository,
  type RepositoryActivityTimelineItem,
} from "./repositoryActivityTimeline.js";
import { buildRepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import type { RepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import {
  buildRepositoryHealthEngineResult,
  type RepositoryHealthEngineResult,
} from "./repositoryHealthEngine.js";
import {
  buildRepositoryInsightsEngineResult,
  type RepositoryInsightsEngineResult,
} from "./repositoryInsightsEngine.js";
import {
  buildRepositoryAiReadinessResult,
  type RepositoryAiReadinessResult,
} from "./repositoryAiReadinessEngine.js";
import type { RepositoryLifecycleEvent } from "./repositoryLifecycleEvents.js";
import type { RetrievalExplainabilitySummary } from "../retrieval/retrievalExplainabilitySummary.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export interface RepositoryDashboardIntelligenceBundleInput {
  repositoryId?: string;
  dashboard: RepositoryDashboardSummary;
  events?: readonly RepositoryLifecycleEvent[];
  timeline?: readonly RepositoryActivityTimelineItem[];
  retrievalExplainability?: RetrievalExplainabilitySummary;
}

export interface RepositoryDashboardIntelligenceBundle {
  repositoryId: string;
  dashboard: RepositoryDashboardSummary;
  health: RepositoryHealthEngineResult;
  aiReadiness: RepositoryAiReadinessResult;
  insights: RepositoryInsightsEngineResult;
  timeline: RepositoryActivityTimelineItem[];
  retrievalExplainability?: RetrievalExplainabilitySummary;
}

function repositoryIdFor(input: RepositoryDashboardIntelligenceBundleInput): string {
  return input.repositoryId ?? input.dashboard.repository;
}

function timelineFor(
  input: RepositoryDashboardIntelligenceBundleInput,
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

export function buildRepositoryDashboardIntelligenceBundle(
  input: RepositoryDashboardIntelligenceBundleInput,
): RepositoryDashboardIntelligenceBundle {
  const repositoryId = repositoryIdFor(input);
  const timeline = timelineFor(input);
  const health = buildRepositoryHealthEngineResult({
    dashboard: input.dashboard,
    events: input.events ?? [],
  });
  const insights = buildRepositoryInsightsEngineResult({
    repositoryId,
    dashboard: input.dashboard,
    health,
    timeline,
    retrievalExplainability: input.retrievalExplainability,
  });
  const aiReadiness = buildRepositoryAiReadinessResult({
    repositoryId,
    dashboard: input.dashboard,
    health,
    insights,
    retrievalExplainability: input.retrievalExplainability,
  });

  return {
    repositoryId,
    dashboard: input.dashboard,
    health,
    aiReadiness,
    insights,
    timeline,
    retrievalExplainability: input.retrievalExplainability,
  };
}

export function buildRepositoryDashboardIntelligenceBundleForRepository(
  owner: string,
  repo: string,
): RepositoryDashboardIntelligenceBundle;
export function buildRepositoryDashboardIntelligenceBundleForRepository(
  owner: string,
  repo: string,
): MaybePromise<RepositoryDashboardIntelligenceBundle> {
  const repositoryId = `${owner}/${repo}`;
  return mapMaybePromise(buildRepositoryDashboardSummary(owner, repo), (dashboard) =>
    buildRepositoryDashboardIntelligenceBundle({
      repositoryId,
      dashboard,
      timeline: buildRepositoryActivityTimelineForRepository(repositoryId),
    }));
}
