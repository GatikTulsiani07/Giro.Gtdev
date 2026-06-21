import type { ArchitectureQualitySummary } from "./architectureQualitySummary.js";
import type { ArchitectureFinding } from "./architectureFindingTypes.js";
import type { ArchitectureReviewResult } from "./architectureReviewResult.js";
import { generateArchitectureFindings } from "./architectureFindingsGenerator.js";

export function reviewArchitecture(
  summary: ArchitectureQualitySummary,
): ArchitectureReviewResult {
  const findings: ArchitectureFinding[] =
    generateArchitectureFindings(summary);

  return {
    summary,
    findings,
    recommendationCount: findings.length,
  };
}