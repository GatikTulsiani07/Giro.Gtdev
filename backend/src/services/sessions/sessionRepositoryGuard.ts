// Ensures a session may only be created for / used with a repository owned by
// the authenticated user. Reuses the existing repository ownership guard and
// its exact codes — no new repository error codes are invented.

import { requireRepositoryAccess } from "../repository/ownershipGuard.js";
import type { RepositoryAccessResult } from "../repository/ownershipGuard.js";

export function requireSessionRepositoryOwnership(input: {
  owner: string;
  repo: string;
  userId: string;
}): RepositoryAccessResult {
  const repoId = `${input.owner}/${input.repo}`;
  return requireRepositoryAccess({ repoId, userId: input.userId });
}
