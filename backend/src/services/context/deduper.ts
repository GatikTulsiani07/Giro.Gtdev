// Removes near-duplicate and overlapping chunks, keeping the highest-similarity one.

import type { SemanticSearchResult } from "../embeddings/types.js";

// Two chunks overlap if they share the same file and their line ranges intersect.
function overlaps(a: SemanticSearchResult, b: SemanticSearchResult): boolean {
  if (a.filePath !== b.filePath) return false;
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

// Content similarity via Jaccard on trigrams — cheap near-duplicate detection.
function contentSimilar(a: string, b: string, threshold = 0.7): boolean {
  const trigramsOf = (s: string): Set<string> => {
    const t = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i + 3));
    return t;
  };
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union > 0 && intersection / union >= threshold;
}

export function dedupeResults(
  results: SemanticSearchResult[],
): SemanticSearchResult[] {
  const kept: SemanticSearchResult[] = [];

  for (const result of results) {
    const isDuplicate = kept.some(
      (existing) =>
        overlaps(existing, result) || contentSimilar(existing.content, result.content),
    );
    if (!isDuplicate) {
      kept.push(result);
    }
  }

  return kept;
}
