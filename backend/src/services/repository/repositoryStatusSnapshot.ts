import { buildRepositoryHealthSnapshot } from "./repositoryHealthSnapshot.js";
import { buildRepositoryReadinessSnapshot } from "./repositoryReadinessSnapshot.js";

export interface RepositoryStatusSnapshot {
  repository: string;
  health: ReturnType<typeof buildRepositoryHealthSnapshot>;
  readiness: ReturnType<typeof buildRepositoryReadinessSnapshot>;
}

export function buildRepositoryStatusSnapshot(
  owner: string,
  repo: string,
): RepositoryStatusSnapshot {
  return {
    repository: `${owner}/${repo}`,
    health: buildRepositoryHealthSnapshot(owner, repo),
    readiness: buildRepositoryReadinessSnapshot(owner, repo),
  };
}