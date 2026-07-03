import type { RepositoryLifecycleReport } from "./repositoryLifecycleReport.js";

export type RepositoryLifecycleState =
  | "idle"
  | "indexing"
  | "ready"
  | "reindex-required";

export interface RepositoryLifecycleStatus {
  state: RepositoryLifecycleState;
  healthy: boolean;
}

export function buildRepositoryLifecycleStatus(
  report: RepositoryLifecycleReport,
): RepositoryLifecycleStatus {
  if (!report.plan.shouldRun) {
    return {
      state: "ready",
      healthy: true,
    };
  }

  if (report.plan.mode === "full") {
    return {
      state: "reindex-required",
      healthy: false,
    };
  }

  return {
    state: "indexing",
    healthy: false,
  };
}