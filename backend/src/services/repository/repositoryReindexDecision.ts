import type { RepositoryChangeReport } from "./repositoryChangeReport.js";

export interface RepositoryReindexDecision {
  shouldReindex: boolean;
  reason: string;
}

export function buildRepositoryReindexDecision(
  report: RepositoryChangeReport,
): RepositoryReindexDecision {
  if (!report.shouldReindex) {
    return {
      shouldReindex: false,
      reason: "Repository has no changes.",
    };
  }

  if (report.severity === "high") {
    return {
      shouldReindex: true,
      reason: "High repository activity detected.",
    };
  }

  if (report.severity === "medium") {
    return {
      shouldReindex: true,
      reason: "Moderate repository changes detected.",
    };
  }

  return {
    shouldReindex: true,
    reason: "Minor repository updates detected.",
  };
}