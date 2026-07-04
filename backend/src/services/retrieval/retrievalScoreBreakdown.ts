import type { RetrievalSignals } from "./types.js";

export interface RetrievalScoreBreakdown {
  semantic: number;
  keyword: number;
  symbol: number;
  graph: number;
  total: number;
}

export function buildRetrievalScoreBreakdown(
  signals: RetrievalSignals,
): RetrievalScoreBreakdown {
  const semantic = signals.semantic ?? 0;
  const keyword = signals.keyword ?? 0;
  const symbol = signals.symbol ?? 0;
  const graph = signals.graph ?? 0;

  return {
    semantic,
    keyword,
    symbol,
    graph,
    total: semantic + keyword + symbol + graph,
  };
}