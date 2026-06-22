import {
  getArchitectureReport,
} from "./architectureReportPersistence.js";

export interface ArchitectureDashboardData {
  repositoryId: string;
  hasReport: boolean;
  report: unknown;
}

export function getArchitectureDashboardData(
  repositoryId: string,
): ArchitectureDashboardData {
  const report = getArchitectureReport(repositoryId);

  return {
    repositoryId,
    hasReport: report !== undefined,
    report: report ?? null,
  };
}