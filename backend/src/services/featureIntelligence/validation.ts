import {
  FEATURE_INTELLIGENCE_SCHEMA_VERSION,
  FeatureIntelligenceError,
  type FeatureGraph,
} from "./types.js";

export function validateFeatureGraph(graph: FeatureGraph): void {
  const featureIds = new Set(graph.features.map((item) => item.featureId));
  const relationshipIds = new Set(
    graph.relationships.map((item) => item.relationshipId),
  );
  const flowIds = new Set(graph.flows.map((item) => item.flowId));
  const invalid =
    graph.schemaVersion !== FEATURE_INTELLIGENCE_SCHEMA_VERSION ||
    graph.features.length !== featureIds.size ||
    graph.relationships.length !== relationshipIds.size ||
    graph.flows.length !== flowIds.size ||
    graph.metrics.featuresDiscovered !== graph.features.length ||
    graph.features.some((feature) =>
      feature.graphVersion !== graph.graphVersion ||
      feature.tenantId !== graph.tenantId ||
      feature.repositoryId !== graph.repositoryId ||
      feature.repositoryRevision !== graph.repositoryRevision ||
      !feature.name || !feature.primaryEntryPoint || !feature.primaryExitPoint ||
      feature.entryPoints.length === 0 || feature.exitPoints.length === 0 ||
      feature.files.length === 0 || feature.symbolIds.length === 0) ||
    graph.relationships.some((edge) =>
      edge.graphVersion !== graph.graphVersion ||
      !featureIds.has(edge.fromFeatureId) ||
      (edge.toFeatureId !== null && !featureIds.has(edge.toFeatureId)) ||
      (edge.toFeatureId === null && !edge.target)) ||
    graph.flows.some((flow) =>
      flow.graphVersion !== graph.graphVersion ||
      !featureIds.has(flow.featureId) ||
      flow.steps.length < 2 ||
      flow.steps.some((step, index) => step.position !== index) ||
      flow.entryPoint !== flow.steps[0]?.symbolId ||
      flow.exitPoint !== flow.steps.at(-2)?.symbolId);
  if (invalid) {
    throw new FeatureIntelligenceError(
      "feature_graph_integrity_invalid",
      "Feature graph identity, lineage, or relationship integrity is invalid.",
    );
  }
}

export function cloneFeatureGraph(graph: FeatureGraph): FeatureGraph {
  return structuredClone(graph);
}
