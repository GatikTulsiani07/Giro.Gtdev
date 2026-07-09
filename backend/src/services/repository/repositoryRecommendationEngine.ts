// Deterministic repository recommendation engine. Pure action layer over
// existing repository intelligence outputs only: no LLM, routes, persistence,
// async work, I/O, timestamps, randomness, global state, or input mutation.

import type { RepositoryActivityTimelineItem } from "./repositoryActivityTimeline.js";
import type { RepositoryArchitectureAnalysis } from "./repositoryArchitectureAnalyzer.js";
import type { RepositoryAiReadinessResult } from "./repositoryAiReadinessEngine.js";
import type { RepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import type { RepositoryEvolutionReport } from "./repositoryEvolutionTracker.js";
import type { RepositoryHealthEngineResult } from "./repositoryHealthEngine.js";
import type {
  RepositoryHotspot,
  RepositoryHotspotReport,
  RepositoryHotspotSeverity,
} from "./repositoryHotspotAnalyzer.js";
import type {
  RepositoryInsight,
  RepositoryInsightsEngineResult,
} from "./repositoryInsightsEngine.js";
import type { RepositoryReadinessResult } from "./repositoryReadinessScore.js";
import type { RepositoryRiskLevel, RepositoryRiskReport } from "./repositoryRiskAnalyzer.js";
import type {
  RepositoryScorecard,
  RepositoryScorecardVerdict,
} from "./repositoryScorecardService.js";

export type RepositoryRecommendationPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export type RepositoryRecommendationSeverity =
  | "critical"
  | "warning"
  | "info";

export type RepositoryRecommendationCategory =
  | "indexing"
  | "readiness"
  | "cleanup"
  | "health"
  | "insights"
  | "architecture"
  | "hotspots"
  | "risk"
  | "scorecard"
  | "evolution"
  | "lifecycle";

export type RepositoryRecommendationEffort = "low" | "medium" | "high";
export type RepositoryRecommendationImpact = "low" | "medium" | "high";

export type RepositoryRecommendationSignalValue =
  | string
  | number
  | boolean
  | null;

export interface RepositoryRecommendationSupportingSignal {
  source: string;
  name: string;
  value: RepositoryRecommendationSignalValue;
}

export interface RepositoryRecommendation {
  id: string;
  priority: RepositoryRecommendationPriority;
  title: string;
  description: string;
  category: RepositoryRecommendationCategory;
  severity: RepositoryRecommendationSeverity;
  estimatedImpact?: RepositoryRecommendationImpact;
  estimatedEffort?: RepositoryRecommendationEffort;
  relatedModules?: readonly string[];
  supportingSignals?: readonly RepositoryRecommendationSupportingSignal[];
  reason: string;
  action: string;
}

export interface RepositoryRecommendationSummary {
  total: number;
  critical: number;
  warnings: number;
  informational: number;
}

export interface RepositoryRecommendationInput {
  dashboard?: RepositoryDashboardSummary;
  health?: RepositoryHealthEngineResult;
  architecture?: RepositoryArchitectureAnalysis;
  hotspots?: RepositoryHotspotReport;
  insights?: RepositoryInsightsEngineResult;
  risk?: RepositoryRiskReport;
  scorecard?: RepositoryScorecard;
  evolution?: RepositoryEvolutionReport;
  readiness?: RepositoryReadinessResult;
  aiReadiness?: RepositoryAiReadinessResult;
  timeline?: readonly RepositoryActivityTimelineItem[];
}

export interface RepositoryRecommendationResult {
  repositoryId: string;
  recommendations: readonly RepositoryRecommendation[];
  summary: RepositoryRecommendationSummary;
}

type MutableRecommendation = Omit<
  RepositoryRecommendation,
  "estimatedImpact" | "estimatedEffort" | "relatedModules" | "supportingSignals"
> & {
  estimatedImpact: RepositoryRecommendationImpact;
  estimatedEffort: RepositoryRecommendationEffort;
  relatedModules: string[];
  supportingSignals: RepositoryRecommendationSupportingSignal[];
};

const PRIORITY_ORDER: Record<RepositoryRecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_ORDER: Record<RepositoryRecommendationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const CATEGORY_ORDER: Record<RepositoryRecommendationCategory, number> = {
  indexing: 0,
  readiness: 1,
  risk: 2,
  hotspots: 3,
  architecture: 4,
  health: 5,
  insights: 6,
  scorecard: 7,
  evolution: 8,
  cleanup: 9,
  lifecycle: 10,
};

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "signal";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function repositoryIdFor(input: RepositoryRecommendationInput): string {
  return (
    input.dashboard?.repository ??
    input.health?.repositoryId ??
    input.aiReadiness?.repositoryId ??
    input.hotspots?.repositoryId ??
    input.insights?.repositoryId ??
    input.risk?.repositoryId ??
    input.scorecard?.repositoryId ??
    input.evolution?.repositoryId ??
    "unknown"
  );
}

function signal(
  source: string,
  name: string,
  value: RepositoryRecommendationSignalValue,
): RepositoryRecommendationSupportingSignal {
  return { source, name, value };
}

function copySignals(
  signals: readonly RepositoryRecommendationSupportingSignal[],
): RepositoryRecommendationSupportingSignal[] {
  return signals
    .map((item) => ({
      source: item.source,
      name: item.name,
      value: item.value,
    }))
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.name.localeCompare(b.name) ||
        String(a.value).localeCompare(String(b.value)),
    );
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeDeep((value as Record<PropertyKey, unknown>)[key], seen);
  }

  return Object.freeze(value);
}

function recommendation(input: {
  id: string;
  priority: RepositoryRecommendationPriority;
  severity: RepositoryRecommendationSeverity;
  title: string;
  description: string;
  category: RepositoryRecommendationCategory;
  estimatedImpact: RepositoryRecommendationImpact;
  estimatedEffort: RepositoryRecommendationEffort;
  relatedModules?: readonly string[];
  supportingSignals?: readonly RepositoryRecommendationSupportingSignal[];
  reason: string;
  action: string;
}): MutableRecommendation {
  return {
    id: input.id,
    priority: input.priority,
    severity: input.severity,
    title: input.title,
    description: input.description,
    category: input.category,
    estimatedImpact: input.estimatedImpact,
    estimatedEffort: input.estimatedEffort,
    relatedModules: sortedUnique(input.relatedModules ?? []),
    supportingSignals: copySignals(input.supportingSignals ?? []),
    reason: input.reason,
    action: input.action,
  };
}

function addRecommendation(
  recommendations: MutableRecommendation[],
  item: MutableRecommendation,
): void {
  if (!recommendations.some((recommendation) => recommendation.id === item.id)) {
    recommendations.push(item);
  }
}

function cleanupHasExecuted(
  timeline: readonly RepositoryActivityTimelineItem[] | undefined,
): boolean {
  return (timeline ?? []).some(
    (item) =>
      item.type === "repository_cleanup_executed" ||
      item.type === "repository_cleanup_reported",
  );
}

function priorityForHotspot(
  severity: RepositoryHotspotSeverity,
): RepositoryRecommendationPriority {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

function priorityForRisk(level: RepositoryRiskLevel): RepositoryRecommendationPriority {
  if (level === "CRITICAL") return "critical";
  if (level === "HIGH") return "high";
  if (level === "MEDIUM") return "medium";
  return "info";
}

function priorityForScorecard(
  verdict: RepositoryScorecardVerdict,
): RepositoryRecommendationPriority {
  if (verdict === "BLOCKED") return "critical";
  if (verdict === "NEEDS_ATTENTION") return "high";
  if (verdict === "GOOD") return "low";
  return "info";
}

function severityForPriority(
  priority: RepositoryRecommendationPriority,
): RepositoryRecommendationSeverity {
  if (priority === "critical") return "critical";
  if (priority === "info") return "info";
  return "warning";
}

function impactForPriority(
  priority: RepositoryRecommendationPriority,
): RepositoryRecommendationImpact {
  if (priority === "critical" || priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}

function effortForHotspot(hotspot: RepositoryHotspot): RepositoryRecommendationEffort {
  if (hotspot.type === "cycle_cluster" || hotspot.type === "critical_chain") {
    return "high";
  }
  if (hotspot.type === "dependency_hub" || hotspot.type === "high_complexity") {
    return "medium";
  }
  return "low";
}

function promoteInsight(insight: RepositoryInsight): MutableRecommendation {
  const priority: RepositoryRecommendationPriority =
    insight.severity === "critical" ? "critical" : "high";

  return recommendation({
    id: `insight.${insight.id}`,
    priority,
    severity: severityForPriority(priority),
    title: insight.title,
    description: insight.description,
    reason: `Insight ${insight.id} has ${insight.severity} severity.`,
    category: "insights",
    action: insight.recommendation ?? "Review the repository insight.",
    estimatedImpact: impactForPriority(priority),
    estimatedEffort: "low",
    relatedModules:
      typeof insight.signals.module === "string" ? [insight.signals.module] : [],
    supportingSignals: [
      signal("insights", "severity", insight.severity),
      signal("insights", "type", insight.type),
    ],
  });
}

function addIndexingRecommendations(
  recommendations: MutableRecommendation[],
  input: RepositoryRecommendationInput,
): void {
  const indexed =
    input.health?.signals.indexed ??
    input.dashboard?.status.health.indexed ??
    true;
  const missing = input.dashboard?.status.health.status === "missing";
  const stale =
    input.health?.signals.stale ??
    input.dashboard?.status.health.stale ??
    false;

  if (!indexed || missing) {
    addRecommendation(
      recommendations,
      recommendation({
        id: "indexing.run-indexing",
        priority: "critical",
        severity: "critical",
        title: "Index the repository",
        description:
          "Repository is not indexed, so Giro cannot provide complete intelligence.",
        reason: "Health signals report that repository indexing is not complete.",
        category: "indexing",
        action: "Run indexing.",
        estimatedImpact: "high",
        estimatedEffort: "medium",
        supportingSignals: [
          signal("health", "indexed", indexed),
          signal("dashboard", "status", input.dashboard?.status.health.status ?? null),
        ],
      }),
    );
  }

  if (stale) {
    addRecommendation(
      recommendations,
      recommendation({
        id: "indexing.reindex-stale",
        priority: "high",
        severity: "warning",
        title: "Re-index stale repository",
        description: "Repository index is stale and may not reflect current code.",
        reason: "Health signals report stale repository metadata.",
        category: "indexing",
        action: "Re-index the repository.",
        estimatedImpact: "high",
        estimatedEffort: "medium",
        supportingSignals: [
          signal("health", "stale", stale),
          signal("dashboard", "stale", input.dashboard?.status.health.stale ?? null),
        ],
      }),
    );
  }
}

function addReadinessRecommendations(
  recommendations: MutableRecommendation[],
  input: RepositoryRecommendationInput,
): void {
  const aiReadiness = input.aiReadiness;

  if (aiReadiness?.level === "blocked") {
    addRecommendation(
      recommendations,
      recommendation({
        id: "readiness.resolve-blockers",
        priority: "critical",
        severity: "critical",
        title: "Resolve AI readiness blockers",
        description: "Repository is blocked from AI-assisted interaction.",
        reason: aiReadiness.blockers.join(" ") || "AI readiness level is blocked.",
        category: "readiness",
        action: "Resolve readiness blockers.",
        estimatedImpact: "high",
        estimatedEffort: "medium",
        supportingSignals: [
          signal("aiReadiness", "level", aiReadiness.level),
          signal("aiReadiness", "score", aiReadiness.score),
          signal("aiReadiness", "blockers", aiReadiness.blockers.length),
        ],
      }),
    );
  } else if (aiReadiness?.level === "degraded") {
    addRecommendation(
      recommendations,
      recommendation({
        id: "readiness.improve-degraded",
        priority: "medium",
        severity: "warning",
        title: "Improve AI readiness",
        description:
          "Repository is available for AI assistance with degraded confidence.",
        reason: aiReadiness.warnings.join(" ") || "AI readiness level is degraded.",
        category: "readiness",
        action: "Improve readiness before relying on AI answers.",
        estimatedImpact: "medium",
        estimatedEffort: "medium",
        supportingSignals: [
          signal("aiReadiness", "level", aiReadiness.level),
          signal("aiReadiness", "score", aiReadiness.score),
          signal("aiReadiness", "warnings", aiReadiness.warnings.length),
        ],
      }),
    );
  }

  if (input.readiness?.level === "poor" || input.readiness?.level === "fair") {
    const priority: RepositoryRecommendationPriority =
      input.readiness.level === "poor" ? "high" : "medium";

    addRecommendation(
      recommendations,
      recommendation({
        id: `readiness.score.${input.readiness.level}`,
        priority,
        severity: "warning",
        title: "Improve repository readiness score",
        description: "Repository readiness score is below the target operating range.",
        reason: `Readiness score is ${input.readiness.score} with ${input.readiness.level} level.`,
        category: "readiness",
        action: "Improve indexing, architecture, and retrieval readiness signals.",
        estimatedImpact: impactForPriority(priority),
        estimatedEffort: "medium",
        supportingSignals: [
          signal("readiness", "score", input.readiness.score),
          signal("readiness", "level", input.readiness.level),
        ],
      }),
    );
  }
}

function addArchitectureRecommendations(
  recommendations: MutableRecommendation[],
  architecture: RepositoryArchitectureAnalysis | undefined,
): void {
  if (!architecture) return;

  if (architecture.circularDependencyCount > 0 || architecture.hasCycles) {
    addRecommendation(
      recommendations,
      recommendation({
        id: "architecture.break-cycles",
        priority: "critical",
        severity: "critical",
        title: "Break circular dependencies",
        description:
          "Circular dependency groups increase coupling and make changes harder to isolate.",
        reason: `${architecture.circularDependencyCount} circular dependency group(s) were reported.`,
        category: "architecture",
        action: "Refactor circular dependency groups into one-directional module boundaries.",
        estimatedImpact: "high",
        estimatedEffort: "high",
        relatedModules: architecture.mostConnectedModules
          .slice(0, 5)
          .map((module) => module.filePath),
        supportingSignals: [
          signal("architecture", "hasCycles", architecture.hasCycles),
          signal(
            "architecture",
            "circularDependencyCount",
            architecture.circularDependencyCount,
          ),
        ],
      }),
    );
  }

  if (architecture.architectureComplexityScore >= 70) {
    addRecommendation(
      recommendations,
      recommendation({
        id: "architecture.reduce-complexity",
        priority: "high",
        severity: "warning",
        title: "Reduce architecture complexity",
        description:
          "Architecture complexity is elevated around dependency density and module connectivity.",
        reason: `Architecture complexity score is ${architecture.architectureComplexityScore}.`,
        category: "architecture",
        action: "Reduce dependency density around the most connected modules.",
        estimatedImpact: "high",
        estimatedEffort: "high",
        relatedModules: architecture.mostConnectedModules
          .slice(0, 5)
          .map((module) => module.filePath),
        supportingSignals: [
          signal(
            "architecture",
            "complexityScore",
            architecture.architectureComplexityScore,
          ),
          signal("architecture", "totalDependencies", architecture.totalDependencies),
        ],
      }),
    );
  }

  const dependencyHubs = architecture.mostConnectedModules.filter(
    (module) => module.totalConnections >= 4,
  );
  if (dependencyHubs.length > 0) {
    addRecommendation(
      recommendations,
      recommendation({
        id: "architecture.split-dependency-hubs",
        priority: "high",
        severity: "warning",
        title: "Split dependency hubs",
        description:
          "Some modules concentrate a high number of incoming and outgoing dependency relationships.",
        reason: `${dependencyHubs.length} module(s) have at least 4 dependency connections.`,
        category: "architecture",
        action: "Split or stabilize central modules before adding more dependents.",
        estimatedImpact: "high",
        estimatedEffort: "medium",
        relatedModules: dependencyHubs.map((module) => module.filePath),
        supportingSignals: [
          signal("architecture", "dependencyHubCount", dependencyHubs.length),
          signal(
            "architecture",
            "maxConnections",
            dependencyHubs[0]?.totalConnections ?? 0,
          ),
        ],
      }),
    );
  }

  if (architecture.isolatedModules.length > 0) {
    addRecommendation(
      recommendations,
      recommendation({
        id: "architecture.review-isolated-modules",
        priority: "medium",
        severity: "warning",
        title: "Review isolated modules",
        description:
          "Some modules have no incoming or outgoing dependency relationships.",
        reason: `${architecture.isolatedModules.length} isolated module(s) were detected.`,
        category: "architecture",
        action: "Confirm isolated modules are intentional or remove stale code.",
        estimatedImpact: "medium",
        estimatedEffort: "low",
        relatedModules: architecture.isolatedModules,
        supportingSignals: [
          signal("architecture", "isolatedModules", architecture.isolatedModules.length),
        ],
      }),
    );
  }
}

function addHotspotRecommendations(
  recommendations: MutableRecommendation[],
  hotspots: RepositoryHotspotReport | undefined,
): void {
  if (!hotspots) return;

  for (const hotspot of hotspots.hotspots) {
    const priority = priorityForHotspot(hotspot.severity);

    addRecommendation(
      recommendations,
      recommendation({
        id: `hotspot.${hotspot.id}`,
        priority,
        severity: severityForPriority(priority),
        title: hotspot.title,
        description: hotspot.description,
        reason: hotspot.reason,
        category: "hotspots",
        action: `Address hotspot: ${hotspot.title}.`,
        estimatedImpact: impactForPriority(priority),
        estimatedEffort: effortForHotspot(hotspot),
        relatedModules: hotspot.affectedModules,
        supportingSignals: [
          signal("hotspots", "severity", hotspot.severity),
          signal("hotspots", "type", hotspot.type),
          signal("hotspots", "affectedModules", hotspot.affectedModules.length),
        ],
      }),
    );
  }
}

function addRiskRecommendations(
  recommendations: MutableRecommendation[],
  risk: RepositoryRiskReport | undefined,
): void {
  if (!risk) return;

  if (risk.level !== "LOW" || risk.blockers.length > 0) {
    const priority = priorityForRisk(risk.level);

    addRecommendation(
      recommendations,
      recommendation({
        id: "risk.reduce-repository-risk",
        priority,
        severity: severityForPriority(priority),
        title: "Reduce repository risk",
        description: risk.summary,
        reason: risk.risks.join(" ") || risk.summary,
        category: "risk",
        action: "Reduce the highest-risk repository signals before expanding usage.",
        estimatedImpact: impactForPriority(priority),
        estimatedEffort: risk.level === "CRITICAL" || risk.level === "HIGH" ? "high" : "medium",
        supportingSignals: [
          signal("risk", "score", risk.score),
          signal("risk", "level", risk.level),
          signal("risk", "blockers", risk.blockers.length),
        ],
      }),
    );
  }

  for (const blocker of risk.blockers) {
    addRecommendation(
      recommendations,
      recommendation({
        id: `risk.blocker.${slug(blocker)}`,
        priority: "critical",
        severity: "critical",
        title: "Resolve risk blocker",
        description: blocker,
        reason: "Repository risk analyzer reported this blocker.",
        category: "risk",
        action: blocker,
        estimatedImpact: "high",
        estimatedEffort: "medium",
        supportingSignals: [
          signal("risk", "level", risk.level),
          signal("risk", "score", risk.score),
        ],
      }),
    );
  }
}

function addHealthRecommendations(
  recommendations: MutableRecommendation[],
  health: RepositoryHealthEngineResult | undefined,
): void {
  if (!health) return;

  for (const warning of health.warnings) {
    addRecommendation(
      recommendations,
      recommendation({
        id: `health.warning.${slug(warning)}`,
        priority: health.score < 40 ? "critical" : "high",
        severity: health.score < 40 ? "critical" : "warning",
        title: "Address health warning",
        description: warning,
        reason: "Repository health engine reported this warning.",
        category: "health",
        action:
          health.recommendations[0] ??
          "Review repository health and apply the recommended fix.",
        estimatedImpact: health.score < 40 ? "high" : "medium",
        estimatedEffort: "medium",
        supportingSignals: [
          signal("health", "score", health.score),
          signal("health", "grade", health.grade),
          signal("health", "healthy", health.healthy),
        ],
      }),
    );
  }
}

function addInsightRecommendations(
  recommendations: MutableRecommendation[],
  insights: RepositoryInsightsEngineResult | undefined,
): void {
  for (const insight of insights?.insights ?? []) {
    if (insight.severity === "critical" || insight.severity === "warning") {
      addRecommendation(recommendations, promoteInsight(insight));
    }
  }
}

function addScorecardRecommendations(
  recommendations: MutableRecommendation[],
  scorecard: RepositoryScorecard | undefined,
): void {
  if (!scorecard) return;
  if (scorecard.verdict === "EXCELLENT") return;

  const priority = priorityForScorecard(scorecard.verdict);

  addRecommendation(
    recommendations,
    recommendation({
      id: `scorecard.${scorecard.verdict.toLowerCase()}`,
      priority,
      severity: severityForPriority(priority),
      title: "Improve repository scorecard",
      description: scorecard.summary,
      reason:
        scorecard.weaknesses[0] ??
        scorecard.blockers[0] ??
        "Repository scorecard is below the excellent range.",
      category: "scorecard",
      action: scorecard.topActions[0] ?? "Review scorecard blockers and weaknesses.",
      estimatedImpact: impactForPriority(priority),
      estimatedEffort: "medium",
      supportingSignals: [
        signal("scorecard", "overallScore", scorecard.overallScore),
        signal("scorecard", "verdict", scorecard.verdict),
        signal("scorecard", "blockers", scorecard.blockers.length),
      ],
    }),
  );
}

function addEvolutionRecommendations(
  recommendations: MutableRecommendation[],
  evolution: RepositoryEvolutionReport | undefined,
): void {
  if (!evolution || evolution.trend !== "REGRESSING") return;

  addRecommendation(
    recommendations,
    recommendation({
      id: "evolution.reverse-regression",
      priority: "high",
      severity: "warning",
      title: "Reverse repository regression",
      description: evolution.summary,
      reason: evolution.regressions.join(" ") || "Repository intelligence is regressing.",
      category: "evolution",
      action: "Review new regressions, blockers, and hotspots before further changes.",
      estimatedImpact: "high",
      estimatedEffort: "medium",
      relatedModules: evolution.newHotspots.flatMap((hotspot) => hotspot.affectedModules),
      supportingSignals: [
        signal("evolution", "trend", evolution.trend),
        signal("evolution", "scoreDelta", evolution.scoreDelta),
        signal("evolution", "newHotspots", evolution.newHotspots.length),
        signal("evolution", "newBlockers", evolution.newBlockers.length),
      ],
    }),
  );
}

function addCleanupRecommendation(
  recommendations: MutableRecommendation[],
  timeline: readonly RepositoryActivityTimelineItem[] | undefined,
): void {
  if (timeline === undefined || cleanupHasExecuted(timeline)) return;

  addRecommendation(
    recommendations,
    recommendation({
      id: "cleanup.run-cleanup",
      priority: "low",
      severity: "info",
      title: "Run repository cleanup",
      description: "No cleanup execution has been recorded for this repository.",
      reason: "Timeline does not contain a repository cleanup execution or report event.",
      category: "cleanup",
      action: "Run cleanup when repository lifecycle metadata should be reset.",
      estimatedImpact: "low",
      estimatedEffort: "low",
      supportingSignals: [signal("timeline", "events", timeline.length)],
    }),
  );
}

function addHealthyFallback(
  recommendations: MutableRecommendation[],
): void {
  if (recommendations.length > 0) return;

  addRecommendation(
    recommendations,
    recommendation({
      id: "repository.healthy",
      priority: "info",
      severity: "info",
      title: "Repository is healthy",
      description: "Repository signals do not require action.",
      reason:
        "Health, architecture, hotspots, insights, risk, scorecard, evolution, and readiness signals are in a healthy state.",
      category: "lifecycle",
      action: "Maintain current repository lifecycle practices.",
      estimatedImpact: "low",
      estimatedEffort: "low",
      supportingSignals: [signal("recommendations", "actionable", 0)],
    }),
  );
}

function sortRecommendations(
  recommendations: readonly MutableRecommendation[],
): RepositoryRecommendation[] {
  return [...recommendations]
    .map((item) => recommendation(item))
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
        a.id.localeCompare(b.id),
    );
}

function summarize(
  recommendations: readonly RepositoryRecommendation[],
): RepositoryRecommendationSummary {
  return {
    total: recommendations.length,
    critical: recommendations.filter((item) => item.severity === "critical").length,
    warnings: recommendations.filter((item) => item.severity === "warning").length,
    informational: recommendations.filter((item) => item.severity === "info").length,
  };
}

export function buildRepositoryRecommendations(
  input: RepositoryRecommendationInput,
): RepositoryRecommendationResult {
  const recommendations: MutableRecommendation[] = [];

  addIndexingRecommendations(recommendations, input);
  addReadinessRecommendations(recommendations, input);
  addRiskRecommendations(recommendations, input.risk);
  addHotspotRecommendations(recommendations, input.hotspots);
  addArchitectureRecommendations(recommendations, input.architecture);
  addHealthRecommendations(recommendations, input.health);
  addInsightRecommendations(recommendations, input.insights);
  addScorecardRecommendations(recommendations, input.scorecard);
  addEvolutionRecommendations(recommendations, input.evolution);
  addCleanupRecommendation(recommendations, input.timeline);
  addHealthyFallback(recommendations);

  const sorted = sortRecommendations(recommendations);

  return freezeDeep({
    repositoryId: repositoryIdFor(input),
    recommendations: sorted,
    summary: summarize(sorted),
  });
}
