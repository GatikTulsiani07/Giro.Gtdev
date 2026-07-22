import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";
import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export function getRepositoryIntelligenceSnapshot(
  repositoryId: string,
  index: number,
  ownerId?: string,
  repositoryRevision?: string,
): RepositoryIntelligenceResult | null;
export function getRepositoryIntelligenceSnapshot(
  repositoryId: string,
  index: number,
  ownerId?: string,
  repositoryRevision?: string,
): MaybePromise<RepositoryIntelligenceResult | null> {
  return mapMaybePromise(getRepositoryIntelligenceHistory(repositoryId, ownerId, repositoryRevision), (history) =>
    index < 0 || index >= history.length ? null : history[index]?.intelligence ?? null);
}
