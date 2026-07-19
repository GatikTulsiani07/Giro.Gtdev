// Repository ownership compatibility API. Ownership is now backed by the
// repository store abstraction while preserving the historical synchronous
// set/get/clear surface used by routes and guards.

import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import { repositoryStore } from "./store/runtimeRepositoryStore.js";

function parseRepositoryId(repoId: string): { owner: string; repo: string } {
  const separator = repoId.indexOf("/");
  if (separator === -1) {
    return { owner: repoId, repo: "" };
  }

  return {
    owner: repoId.slice(0, separator),
    repo: repoId.slice(separator + 1),
  };
}

function normalizedRepositoryId(repoId: string): string {
  const { owner, repo } = parseRepositoryId(repoId);
  return `${owner}/${repo}`;
}

export function setRepositoryOwner(repoId: string, userId: string): void;
export function setRepositoryOwner(repoId: string, userId: string): MaybePromise<void> {
  const { owner, repo } = parseRepositoryId(repoId);
  return mapMaybePromise(repositoryStore.connectRepository({ owner, repo, ownerUserId: userId }), () => undefined);
}

export function getRepositoryOwner(repoId: string): string | undefined;
export function getRepositoryOwner(repoId: string): MaybePromise<string | undefined> {
  return mapMaybePromise(repositoryStore.getRepository(normalizedRepositoryId(repoId)),
    (repository) => repository?.ownerUserId ?? undefined);
}

export function clearRepositoryOwners(): void;
export function clearRepositoryOwners(): MaybePromise<void> {
  return repositoryStore.clear();
}
