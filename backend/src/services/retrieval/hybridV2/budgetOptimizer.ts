import type {
  DiscardedCandidate,
  HybridRetrievalCandidate,
  HybridRetrievalDiagnostics,
  HybridRetrievalV2Config,
} from "./types.js";
import { candidateKey } from "./types.js";

export function estimateRetrievalTokens(candidate: HybridRetrievalCandidate): number {
  return Math.max(1, Math.ceil(candidate.result.content.length / 4));
}

export function optimizeRetrievalBudget(
  candidates: readonly HybridRetrievalCandidate[],
  config: HybridRetrievalV2Config,
  requestedLimit: number,
  diagnostics: HybridRetrievalDiagnostics,
): HybridRetrievalCandidate[] {
  const selected: HybridRetrievalCandidate[] = [];
  const files = new Set<string>();
  const symbols = new Set<string>();
  let tokens = 0;
  const maximumChunks = Math.min(config.maxChunks, requestedLimit);

  const discard = (
    candidate: HybridRetrievalCandidate,
    reason: DiscardedCandidate["reason"],
  ) => diagnostics.discardedCandidates.push({ key: candidateKey(candidate), reason });

  // Diversity passes offer each repository and then each file one ranked slot.
  const repositoryDiverse = candidates.filter((candidate, index, all) =>
    all.findIndex((item) =>
      item.result.repository === candidate.result.repository) === index);
  const fileDiverse = candidates.filter((candidate, index, all) =>
    all.findIndex((item) =>
      item.result.repository === candidate.result.repository &&
      item.result.filePath === candidate.result.filePath) === index &&
    !repositoryDiverse.includes(candidate));
  const remaining = candidates.filter((candidate) =>
    !repositoryDiverse.includes(candidate) && !fileDiverse.includes(candidate));
  for (const candidate of [...repositoryDiverse, ...fileDiverse, ...remaining]) {
    if (selected.length >= maximumChunks) {
      discard(candidate, "chunk_limit");
      continue;
    }
    const fileKey = `${candidate.result.repository}\u0000${candidate.result.filePath}`;
    const isNewFile = !files.has(fileKey);
    if (isNewFile && files.size >= config.maxFiles) {
      discard(candidate, "file_limit");
      continue;
    }
    const symbol = candidate.result.symbol?.trim().toLowerCase();
    if (symbol && !symbols.has(symbol) && symbols.size >= config.maxSymbols) {
      discard(candidate, "symbol_limit");
      continue;
    }
    const candidateTokens = estimateRetrievalTokens(candidate);
    if (tokens + candidateTokens > config.maxTokens) {
      discard(candidate, "token_budget");
      continue;
    }
    selected.push(candidate);
    files.add(fileKey);
    if (symbol) symbols.add(symbol);
    tokens += candidateTokens;
  }
  diagnostics.tokenUsage = { used: tokens, maximum: config.maxTokens };
  return selected.sort((left, right) => left.originalRank - right.originalRank);
}
