// In-memory repository ownership registry. Maps repoId ("owner/repo") -> userId.
// Intentionally temporary: ownership is lost on restart. A schema-backed
// persistence layer will replace this in a future phase.

const owners = new Map<string, string>();

export function setRepositoryOwner(repoId: string, userId: string): void {
  owners.set(repoId, userId);
}

export function getRepositoryOwner(repoId: string): string | undefined {
  return owners.get(repoId);
}

export function clearRepositoryOwners(): void {
  owners.clear();
}
