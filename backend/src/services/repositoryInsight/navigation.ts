import type {
  InsightNavigationQuery, RepositoryInsight, RepositoryInsightType,
} from "./types.js";

const categoryTypes: Readonly<Record<
  NonNullable<InsightNavigationQuery["category"]>,
  readonly RepositoryInsightType[]
>> = {
  "architectural hotspots": [
    "architectural hotspot", "highly coupled module", "orphan module",
  ],
  "duplicated logic": ["duplicated implementation"],
  "dependency issues": [
    "cyclic dependency", "high-risk dependency", "highly coupled module",
  ],
  "documentation issues": ["documentation gap", "stale knowledge"],
};

export function navigateRepositoryInsights(
  insights: readonly RepositoryInsight[],
  query: InsightNavigationQuery,
): RepositoryInsight[] {
  const limit = Math.max(1, Math.min(100, query.limit ?? 25));
  return insights.filter((insight) =>
    (!query.featureId || insight.relatedFeatures.includes(query.featureId)) &&
    (!query.file || insight.relatedFiles.includes(query.file)) &&
    (!query.module || insight.supportingEvidence.some((item) =>
      item.kind === "module" && (
        item.reference === query.module ||
        String(item.details.rootPath ?? "") === query.module))) &&
    (!query.category || categoryTypes[query.category].includes(insight.type)))
    .sort((a, b) => b.score.total - a.score.total ||
      b.confidence - a.confidence || a.insightId.localeCompare(b.insightId))
    .slice(0, limit);
}
