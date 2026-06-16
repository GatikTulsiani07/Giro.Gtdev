// Orchestrates stale detection + registry transition. Computes staleness from
// provided file lists, then transitions the registry: mark stale when files
// differ (only acts on indexed repos) or clear stale when they match again
// (only acts on stale repos). Input arrays are never mutated; the registry
// status transition is the intended side-effect.

import { detectRepositoryStaleness } from "./staleDetectionService.js";
import { markRepositoryStale, clearRepositoryStale } from "./indexingService.js";

export function evaluateRepositoryStaleness(
  owner: string,
  repo: string,
  currentFiles: string[],
  indexedFiles: string[],
): boolean {
  const isStale = detectRepositoryStaleness(owner, repo, currentFiles, indexedFiles);
  if (isStale) {
    markRepositoryStale(owner, repo);
  } else {
    clearRepositoryStale(owner, repo);
  }
  return isStale;
}
