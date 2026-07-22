import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export interface RepositoryIntelligenceTrendPoint {
  generatedAt: string;
  score: number;
  grade: string;
}

export function getRepositoryIntelligenceTrend(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): RepositoryIntelligenceTrendPoint[];
export function getRepositoryIntelligenceTrend(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): MaybePromise<RepositoryIntelligenceTrendPoint[]> {
  return mapMaybePromise(getRepositoryIntelligenceHistory(repositoryId, ownerId, repositoryRevision), (history) => history.map((entry) => ({
    generatedAt: entry.generatedAt,
    score: entry.intelligence.intelligence.score,
    grade: entry.intelligence.intelligence.grade,
  })));
}
