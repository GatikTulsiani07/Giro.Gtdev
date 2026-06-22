import { getArchitectureHistory } from "./architectureReportHistory.js";

export interface ArchitectureTrendPoint {
  generatedAt: string;
  score: number;
}

export function getArchitectureTrend(
  repositoryId: string,
): ArchitectureTrendPoint[] {
  const history = getArchitectureHistory(repositoryId);

  return history.map((entry) => ({
    generatedAt: entry.generatedAt,
    score: 0,
  }));
}