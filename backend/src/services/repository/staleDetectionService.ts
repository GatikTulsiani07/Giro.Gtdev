// Pure stale detection: a repository is stale when its current file set no
// longer matches the last indexed file set. Compared as deduplicated sets, so
// ordering and duplicate entries never matter. No I/O, no randomness; inputs
// are never mutated (Sets are built from copies). owner/repo are accepted for
// signature consistency but the comparison is purely set-based.

export function detectRepositoryStaleness(
  _owner: string,
  _repo: string,
  currentFiles: string[],
  indexedFiles: string[],
): boolean {
  const current = new Set(currentFiles);
  const indexed = new Set(indexedFiles);

  if (current.size !== indexed.size) return true;
  for (const file of current) {
    if (!indexed.has(file)) return true;
  }
  return false;
}
