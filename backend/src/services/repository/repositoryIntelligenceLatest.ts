import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";
import { getRepositoryIntelligenceHistory } from "./repositoryIntelligenceHistory.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export function getLatestRepositoryIntelligence(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): RepositoryIntelligenceResult | null;
export function getLatestRepositoryIntelligence(
  repositoryId: string,
  ownerId?: string,
  repositoryRevision?: string,
): MaybePromise<RepositoryIntelligenceResult | null> {
  return mapMaybePromise(getRepositoryIntelligenceHistory(repositoryId, ownerId, repositoryRevision), (history) =>
    history.at(-1)?.intelligence ?? null);
}
