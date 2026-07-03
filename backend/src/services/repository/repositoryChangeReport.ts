import {
  buildRepositoryChangeSummary,
  type RepositoryChangeSummary,
} from "./repositoryChangeDetector.js";
import {
  assessRepositoryChangeSeverity,
  type RepositoryChangeSeverity,
} from "./repositoryChangeSeverity.js";

export interface RepositoryChangeReport {
  summary: RepositoryChangeSummary;
  severity: RepositoryChangeSeverity;
  shouldReindex: boolean;
}

export function buildRepositoryChangeReport(input: {
  added: number;
  modified: number;
  deleted: number;
}): RepositoryChangeReport {
  const summary = buildRepositoryChangeSummary(input);
  const severity = assessRepositoryChangeSeverity(summary);

  return {
    summary,
    severity,
    shouldReindex: severity !== "none",
  };
}