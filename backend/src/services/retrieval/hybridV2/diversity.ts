import type {
  DiscardedCandidate,
  HybridRetrievalCandidate,
  HybridRetrievalDiagnostics,
} from "./types.js";
import { candidateKey } from "./types.js";

function recordDiscard(
  diagnostics: HybridRetrievalDiagnostics,
  candidate: HybridRetrievalCandidate,
  reason: DiscardedCandidate["reason"],
): void {
  const key = candidateKey(candidate);
  diagnostics.discardedCandidates.push({ key, reason });
  diagnostics.diversityDecisions.push({ key, decision: "discarded", reason });
}

export function diversifyRetrievalCandidates(
  candidates: readonly HybridRetrievalCandidate[],
  maxPerFile: number,
  diagnostics: HybridRetrievalDiagnostics,
): HybridRetrievalCandidate[] {
  const selected: HybridRetrievalCandidate[] = [];
  const fileCounts = new Map<string, number>();
  const symbols = new Set<string>();
  for (const candidate of candidates) {
    const fileCount = fileCounts.get(candidate.result.filePath) ?? 0;
    if (fileCount >= maxPerFile) {
      recordDiscard(diagnostics, candidate, "same_file_limit");
      continue;
    }
    const symbol = candidate.result.symbol?.trim().toLowerCase();
    if (symbol && symbols.has(symbol)) {
      recordDiscard(diagnostics, candidate, "repeated_symbol");
      continue;
    }
    selected.push(candidate);
    fileCounts.set(candidate.result.filePath, fileCount + 1);
    if (symbol) symbols.add(symbol);
    diagnostics.diversityDecisions.push({
      key: candidateKey(candidate),
      decision: "selected",
    });
  }
  return selected.sort((left, right) => left.originalRank - right.originalRank);
}
