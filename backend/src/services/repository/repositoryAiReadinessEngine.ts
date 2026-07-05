// Deterministic AI-readiness evaluation for repository interaction. Pure
// product layer over existing Giro signals: no LLM calls, persistence, routes,
// I/O, timestamps, randomness, or mutation.

import { buildRepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import type { RepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import {
  buildRepositoryHealthEngineResultForRepository,
  type RepositoryHealthEngineResult,
} from "./repositoryHealthEngine.js";
import type { RepositoryInsightsEngineResult } from "./repositoryInsightsEngine.js";
import type { RetrievalExplainabilitySummary } from "../retrieval/retrievalExplainabilitySummary.js";

export type RepositoryAiReadinessLevel = "ready" | "degraded" | "blocked";

export interface RepositoryAiReadinessSignals {
  metadataAvailable: boolean;
  indexed: boolean;
  readyForRetrieval: boolean;
  failed: boolean;
  stale: boolean;
  healthScore: number | null;
  healthHealthy: boolean;
  retrievalResultsAvailable: boolean | null;
  criticalInsights: number;
  warningInsights: number;
}

export interface RepositoryAiReadinessEngineInput {
  repositoryId?: string;
  health?: RepositoryHealthEngineResult;
  insights?: RepositoryInsightsEngineResult;
  dashboard?: RepositoryDashboardSummary;
  retrievalExplainability?: RetrievalExplainabilitySummary;
}

export interface RepositoryAiReadinessResult {
  repositoryId: string;
  ready: boolean;
  score: number;
  level: RepositoryAiReadinessLevel;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  signals: RepositoryAiReadinessSignals;
}

function repositoryIdFor(input: RepositoryAiReadinessEngineInput): string {
  return (
    input.repositoryId ??
    input.health?.repositoryId ??
    input.insights?.repositoryId ??
    input.dashboard?.repository ??
    "unknown"
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function deriveSignals(
  input: RepositoryAiReadinessEngineInput,
): RepositoryAiReadinessSignals {
  const dashboardStatus = input.dashboard?.status.health.status;
  const metadataAvailable =
    input.dashboard !== undefined && dashboardStatus !== "missing";
  const indexed =
    input.health?.signals.indexed ??
    input.dashboard?.status.health.indexed ??
    false;
  const readyForRetrieval =
    input.health?.signals.ready ??
    input.dashboard?.status.readiness.ready ??
    false;
  const failed = dashboardStatus === "failed";
  const stale =
    input.health?.signals.stale ??
    input.dashboard?.status.health.stale ??
    false;
  const healthScore = input.health?.score ?? null;
  const healthHealthy = input.health?.healthy ?? false;
  const retrievalResultsAvailable =
    input.retrievalExplainability === undefined
      ? null
      : input.retrievalExplainability.totalResults > 0;

  return {
    metadataAvailable,
    indexed: indexed || dashboardStatus === "stale",
    readyForRetrieval: readyForRetrieval || dashboardStatus === "stale",
    failed,
    stale,
    healthScore,
    healthHealthy,
    retrievalResultsAvailable,
    criticalInsights: input.insights?.summary.critical ?? 0,
    warningInsights: input.insights?.summary.warnings ?? 0,
  };
}

function scoreFor(
  signals: RepositoryAiReadinessSignals,
  blockerCount: number,
  warningCount: number,
): number {
  if (!signals.metadataAvailable) return 0;
  if (signals.failed) return 0;
  if (!signals.indexed || !signals.readyForRetrieval) return 15;

  let score = signals.healthScore ?? 75;

  if (signals.stale) score = Math.max(Math.min(score, 65), 60);
  if (signals.retrievalResultsAvailable === false) score = Math.min(score, 60);
  if (signals.criticalInsights > 0) score = Math.min(score, 35);

  score -= Math.max(0, warningCount - blockerCount) * 3;

  return clampScore(score);
}

function levelFor(
  score: number,
  blockers: readonly string[],
  warnings: readonly string[],
): RepositoryAiReadinessLevel {
  if (blockers.length > 0 || score < 40) return "blocked";
  if (warnings.length > 0 || score < 70) return "degraded";
  return "ready";
}

export function buildRepositoryAiReadinessResult(
  input: RepositoryAiReadinessEngineInput,
): RepositoryAiReadinessResult {
  const repositoryId = repositoryIdFor(input);
  const signals = deriveSignals(input);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!signals.metadataAvailable) {
    blockers.push("Repository metadata is missing.");
    recommendations.push("Index the repository before starting AI-assisted interaction.");
  }

  if (signals.failed) {
    blockers.push("Repository indexing failed.");
    recommendations.push("Retry indexing after resolving the indexing failure.");
  }

  if (!signals.indexed) {
    blockers.push("Repository is not indexed.");
    recommendations.push("Complete repository indexing to enable AI-assisted interaction.");
  }

  if (!signals.readyForRetrieval) {
    blockers.push("Repository is not ready for retrieval.");
    recommendations.push("Complete repository indexing to make retrieval available.");
  }

  if (signals.healthScore !== null && signals.healthScore < 40 && !signals.stale) {
    blockers.push("Repository health score is critically low.");
    recommendations.push("Resolve critical repository health issues before using AI assistance.");
  } else if (signals.healthScore !== null && signals.healthScore < 70 && !signals.stale) {
    warnings.push("Repository health score is below the healthy threshold.");
    recommendations.push("Review repository health warnings before relying on AI answers.");
  }

  if (signals.stale) {
    warnings.push("Repository index is stale.");
    recommendations.push("Refresh or reindex the repository for current AI context.");
  }

  if (signals.retrievalResultsAvailable === false) {
    warnings.push("Retrieval returned no results.");
    recommendations.push("Improve retrieval coverage before relying on AI answers.");
  }

  if (signals.criticalInsights > 0) {
    blockers.push("Critical repository insights require attention.");
    recommendations.push("Resolve critical repository insights before AI-assisted interaction.");
  }

  if (signals.warningInsights > 0) {
    warnings.push("Repository insights include warnings.");
    recommendations.push("Review repository insight warnings in the dashboard.");
  }

  for (const recommendation of input.health?.recommendations ?? []) {
    recommendations.push(recommendation);
  }

  const stableBlockers = unique(blockers);
  const stableWarnings = unique(warnings);
  const stableRecommendations = unique(recommendations);
  const score = scoreFor(signals, stableBlockers.length, stableWarnings.length);
  const level = levelFor(score, stableBlockers, stableWarnings);

  return {
    repositoryId,
    ready: level === "ready",
    score,
    level,
    blockers: stableBlockers,
    warnings: stableWarnings,
    recommendations: stableRecommendations,
    signals,
  };
}

export function buildRepositoryAiReadinessForRepository(
  owner: string,
  repo: string,
): RepositoryAiReadinessResult {
  const dashboard = buildRepositoryDashboardSummary(owner, repo);
  const health = buildRepositoryHealthEngineResultForRepository(owner, repo);

  return buildRepositoryAiReadinessResult({
    repositoryId: `${owner}/${repo}`,
    dashboard,
    health,
  });
}
