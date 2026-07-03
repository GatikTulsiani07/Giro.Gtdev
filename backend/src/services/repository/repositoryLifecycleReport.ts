import { buildRepositoryChangeReport } from "./repositoryChangeReport.js";
import { buildRepositoryReindexDecision } from "./repositoryReindexDecision.js";
import { buildRepositoryReindexPlan } from "./repositoryReindexPlan.js";

export interface RepositoryLifecycleReport {
  changes: ReturnType<typeof buildRepositoryChangeReport>;
  decision: ReturnType<typeof buildRepositoryReindexDecision>;
  plan: ReturnType<typeof buildRepositoryReindexPlan>;
}

export function buildRepositoryLifecycleReport(input: {
  added: number;
  modified: number;
  deleted: number;
}): RepositoryLifecycleReport {
  const changes = buildRepositoryChangeReport(input);
  const decision = buildRepositoryReindexDecision(changes);
  const plan = buildRepositoryReindexPlan(decision);

  return {
    changes,
    decision,
    plan,
  };
}