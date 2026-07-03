export interface RepositoryChangeSummary {
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  totalChanges: number;
}

export function buildRepositoryChangeSummary(input: {
  added: number;
  modified: number;
  deleted: number;
}): RepositoryChangeSummary {
  return {
    filesAdded: input.added,
    filesModified: input.modified,
    filesDeleted: input.deleted,
    totalChanges: input.added + input.modified + input.deleted,
  };
}