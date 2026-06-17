// Repository cleanup lifecycle. Deterministically and idempotently removes ALL
// of a single repository's indexing artifacts (metadata, symbols, graph source,
// snapshot) without affecting other repositories. Ownership records are out of
// scope. No timestamps, no randomness; reads are pure.

import {
  getRepositoryIndexMetadata,
  removeRepositoryIndexMetadata,
} from "./indexingService.js";
import {
  getRepositorySymbolCount,
  removeRepositorySymbols,
} from "./symbolIndexStore.js";
import {
  getFileSymbolMaps,
  removeRepositoryGraphSource,
} from "./graphSourceStore.js";
import {
  getRepositoryFileSnapshot,
  removeRepositoryFileSnapshot,
} from "./fileSnapshotStore.js";

export function cleanupRepository(owner: string, repo: string): void {
  const repoId = `${owner}/${repo}`;
  removeRepositoryIndexMetadata(owner, repo);
  removeRepositorySymbols(repoId);
  removeRepositoryGraphSource(repoId);
  removeRepositoryFileSnapshot(repoId);
}

export function isRepositoryCleaned(owner: string, repo: string): boolean {
  const repoId = `${owner}/${repo}`;
  return (
    getRepositoryIndexMetadata(owner, repo) === null &&
    getRepositorySymbolCount(repoId) === 0 &&
    getFileSymbolMaps(repoId).length === 0 &&
    getRepositoryFileSnapshot(repoId) === null
  );
}

export function evaluateRepositoryCleanup(
  owner: string,
  repo: string,
): { exists: boolean; indexed: boolean; cleaned: boolean } {
  const repoId = `${owner}/${repo}`;
  const metadata = getRepositoryIndexMetadata(owner, repo);
  const hasSymbols = getRepositorySymbolCount(repoId) > 0;
  const hasGraphSource = getFileSymbolMaps(repoId).length > 0;
  const hasSnapshot = getRepositoryFileSnapshot(repoId) !== null;

  const exists = metadata !== null || hasSymbols || hasGraphSource || hasSnapshot;
  const indexed = metadata !== null && metadata.status === "indexed";
  const cleaned = isRepositoryCleaned(owner, repo);

  return { exists, indexed, cleaned };
}
