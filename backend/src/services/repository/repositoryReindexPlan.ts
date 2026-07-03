import type { RepositoryReindexDecision } from "./repositoryReindexDecision.js";

export interface RepositoryReindexPlan {
  shouldRun: boolean;
  mode: "none" | "incremental" | "full";
  reason: string;
}

export function buildRepositoryReindexPlan(
  decision: RepositoryReindexDecision,
): RepositoryReindexPlan {
  if (!decision.shouldReindex) {
    return {
      shouldRun: false,
      mode: "none",
      reason: decision.reason,
    };
  }

  if (decision.reason.toLowerCase().includes("high")) {
    return {
      shouldRun: true,
      mode: "full",
      reason: decision.reason,
    };
  }

  return {
    shouldRun: true,
    mode: "incremental",
    reason: decision.reason,
  };
}