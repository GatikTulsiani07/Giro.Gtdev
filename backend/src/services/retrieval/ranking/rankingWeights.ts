import type { RankingWeights } from "./rankingTypes.js";

export const DEFAULT_RANKING_WEIGHTS: Readonly<RankingWeights> = Object.freeze({
  semantic: 0.35,
  keyword: 0.18,
  symbol: 0.15,
  graph: 0.08,
  summary: 0.07,
  entrypoint: 0.06,
  stitchBonus: 0.04,
  diversityBonus: 0.04,
  duplicatePenalty: 0.08,
});

export function validateRankingWeights(weights: RankingWeights): RankingWeights {
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`${name} ranking weight must be between zero and one`);
    }
  }
  return { ...weights };
}
