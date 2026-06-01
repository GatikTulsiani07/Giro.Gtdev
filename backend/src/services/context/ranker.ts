// Reranks semantic search results by boosting/penalizing based on file signals.

import type { SemanticSearchResult } from "../embeddings/types.js";

const BOOST_PATTERNS: Array<{ pattern: RegExp; boost: number }> = [
  { pattern: /index\.(ts|js)$/i, boost: 0.08 },
  { pattern: /main\.(ts|js|py|go)$/i, boost: 0.08 },
  { pattern: /app\.(ts|js|tsx)$/i, boost: 0.06 },
  { pattern: /server\.(ts|js)$/i, boost: 0.06 },
  { pattern: /package\.json$/i, boost: 0.05 },
  { pattern: /tsconfig\.json$/i, boost: 0.04 },
  { pattern: /config/i, boost: 0.03 },
  { pattern: /auth/i, boost: 0.05 },
  { pattern: /middleware/i, boost: 0.04 },
  { pattern: /route/i, boost: 0.03 },
];

const PENALTY_PATTERNS: Array<{ pattern: RegExp; penalty: number }> = [
  { pattern: /\.lock$/i, penalty: 0.15 },
  { pattern: /lock\.json$/i, penalty: 0.15 },
  { pattern: /\.min\.(js|css)$/i, penalty: 0.20 },
  { pattern: /dist\//i, penalty: 0.12 },
  { pattern: /generated/i, penalty: 0.10 },
  { pattern: /\.d\.ts$/i, penalty: 0.08 },
  { pattern: /vendor\//i, penalty: 0.10 },
];

function computeScore(result: SemanticSearchResult): number {
  let score = result.similarity;

  for (const { pattern, boost } of BOOST_PATTERNS) {
    if (pattern.test(result.filePath)) {
      score += boost;
      break; // only apply strongest boost
    }
  }

  for (const { pattern, penalty } of PENALTY_PATTERNS) {
    if (pattern.test(result.filePath)) {
      score -= penalty;
      break; // only apply strongest penalty
    }
  }

  return score;
}

export function rankResults(
  results: SemanticSearchResult[],
): SemanticSearchResult[] {
  return [...results].sort((a, b) => computeScore(b) - computeScore(a));
}
