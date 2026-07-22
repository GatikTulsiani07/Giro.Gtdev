import { getArchitectureHistory } from "./architectureReportHistory.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export interface ArchitectureTrendPoint {
  generatedAt: string;
  score: number;
}

export function getArchitectureTrend(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): ArchitectureTrendPoint[];
export function getArchitectureTrend(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): MaybePromise<ArchitectureTrendPoint[]> {
  return mapMaybePromise(getArchitectureHistory(repositoryId, ownerId, repositoryRevision), (history) => history.map((entry) => ({
    generatedAt: entry.generatedAt,
    score: 0,
  })));
}
