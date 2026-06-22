export interface CacheInvalidationInput {
  repositoryId: string;
  changedFiles: readonly string[];
  deletedFiles: readonly string[];
}

export interface CacheInvalidationPlan {
  repositoryId: string;
  invalidateRetrievalCache: boolean;
  invalidateContextCache: boolean;
  invalidateArchitectureCache: boolean;
  invalidateSymbolCache: boolean;
  reasons: readonly string[];
}

export function buildCacheInvalidationPlan(
  input: CacheInvalidationInput,
): CacheInvalidationPlan {
  const reasons: string[] = [];

  const hasChangedFiles = input.changedFiles.length > 0;
  const hasDeletedFiles = input.deletedFiles.length > 0;
  const hasAnyFileChanges = hasChangedFiles || hasDeletedFiles;

  if (hasChangedFiles) reasons.push("FILES_CHANGED");
  if (hasDeletedFiles) reasons.push("FILES_DELETED");

  return {
    repositoryId: input.repositoryId,
    invalidateRetrievalCache: hasAnyFileChanges,
    invalidateContextCache: hasAnyFileChanges,
    invalidateArchitectureCache: hasAnyFileChanges,
    invalidateSymbolCache: hasAnyFileChanges,
    reasons,
  };
}