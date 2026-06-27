import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export function buildRepositoryIntelligenceMarkdown(
  intelligence: RepositoryIntelligenceResult,
): string {
  return [
    "# Repository Intelligence",
    "",
    `Repository: ${intelligence.repositoryName}`,
    `Health Score: ${intelligence.summary.healthScore}`,
    `Health Category: ${intelligence.summary.healthCategory}`,
    `Intelligence Score: ${intelligence.intelligence.score}`,
    `Intelligence Grade: ${intelligence.intelligence.grade}`,
    `Architecture Ready: ${intelligence.status.architectureReady}`,
    `Retrieval Ready: ${intelligence.status.retrievalReady}`,
    `Indexed: ${intelligence.status.indexed}`,
    "",
    "## Retrieval",
    `Grade: ${intelligence.summary.retrievalGrade}`,
    "",
    "## Index",
    `Status: ${intelligence.summary.indexStatus}`,
  ].join("\n");
}