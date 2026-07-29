import {
  CHANGE_INTELLIGENCE_SCHEMA_VERSION,
  ChangeIntelligenceError,
  type ChangeAnalysis,
} from "./types.js";

export function validateChangeAnalysis(analysis: ChangeAnalysis): void {
  const chainIds = new Set(analysis.impact.dependencyChains.map((item) => item.chainId));
  const stepIds = new Set(analysis.implementationPlan.steps.map((item) => item.stepId));
  const invalid =
    analysis.schemaVersion !== CHANGE_INTELLIGENCE_SCHEMA_VERSION ||
    !analysis.analysisId || !analysis.request.changeId ||
    analysis.impact.changeId !== analysis.request.changeId ||
    analysis.risk.changeId !== analysis.request.changeId ||
    analysis.implementationPlan.changeId !== analysis.request.changeId ||
    !analysis.request.tenantId || !analysis.request.ownerId ||
    !analysis.request.repositoryId || !analysis.request.repositoryRevision ||
    !analysis.request.workflowId || !analysis.request.requestedTarget.value ||
    !analysis.repositoryIntelligenceVersion || !analysis.semanticGraphVersion ||
    !analysis.featureGraphVersion ||
    chainIds.size !== analysis.impact.dependencyChains.length ||
    stepIds.size !== analysis.implementationPlan.steps.length ||
    analysis.impact.dependencyChains.some((chain) =>
      chain.steps.length < 2 ||
      chain.steps.some((item, position) => item.position !== position)) ||
    analysis.implementationPlan.steps.some((item, position) =>
      item.position !== position) ||
    analysis.risk.score < 0 || analysis.risk.score > 100;
  if (invalid) {
    throw new ChangeIntelligenceError(
      "change_analysis_integrity_invalid",
      "Change analysis identity, lineage, graph, or plan integrity is invalid.",
    );
  }
}

export function cloneChangeAnalysis(analysis: ChangeAnalysis): ChangeAnalysis {
  return structuredClone(analysis);
}
