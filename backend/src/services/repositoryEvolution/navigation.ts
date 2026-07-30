import type {
  EvolutionNavigationQuery, EvolutionTimelineEntry,
  RepositoryEvolutionRecord,
} from "./types.js";

export function navigateEvolutionHistory(
  records: readonly RepositoryEvolutionRecord[],
  query: EvolutionNavigationQuery,
): EvolutionTimelineEntry[] {
  const limit = Math.max(1, Math.min(500, query.limit ?? 100));
  return records.filter((record) =>
    record.lifecycle === "published" &&
    (!query.baseRevision || record.baseRevision === query.baseRevision) &&
    (!query.targetRevision || record.targetRevision === query.targetRevision))
    .flatMap((record) => record.timelines)
    .filter((entry) =>
      (!query.kind || entry.kind === query.kind) &&
      (!query.entityId || entry.entityId === query.entityId ||
        entry.entityName === query.entityId))
    .sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) ||
      a.kind.localeCompare(b.kind) ||
      a.entityName.localeCompare(b.entityName) ||
      a.timelineId.localeCompare(b.timelineId))
    .slice(0, limit);
}
