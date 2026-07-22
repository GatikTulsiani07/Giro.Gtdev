import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export interface RepositoryIntelligenceTimelineEntry {
  generatedAt: string;
  repositoryName: string;
  healthScore: number;
  intelligenceScore: number;
}

export function buildRepositoryIntelligenceTimeline(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): RepositoryIntelligenceTimelineEntry[];
export function buildRepositoryIntelligenceTimeline(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): MaybePromise<RepositoryIntelligenceTimelineEntry[]> {
  return mapMaybePromise(getRepositoryIntelligenceHistory(repositoryId, ownerId, repositoryRevision), (history) => history.map((entry) => ({
    generatedAt: entry.generatedAt,
    repositoryName: entry.intelligence.repositoryName,
    healthScore: entry.intelligence.summary.healthScore,
    intelligenceScore: entry.intelligence.intelligence.score,
  })));
}
