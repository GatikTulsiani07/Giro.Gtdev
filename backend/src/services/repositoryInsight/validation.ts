import {
  INSIGHT_TYPES, REPOSITORY_INSIGHT_SCHEMA_VERSION, RepositoryInsightError,
  type RepositoryInsight, type RepositoryInsightGeneration,
  type RepositoryInsightSources,
} from "./types.js";

export function validateInsightSources(sources: RepositoryInsightSources): void {
  const revision = sources.repositoryIntelligence.repositoryRevision;
  const repositoryId = sources.repositoryIntelligence.repositoryId;
  const tenantId = sources.semanticGraph.tenantId;
  const ownerId = sources.semanticGraph.ownerId;
  if (sources.repositoryIntelligence.status !== "published" ||
      sources.repositoryGraph.status !== "published" ||
      sources.semanticGraph.lifecycle !== "published" ||
      sources.featureGraph.lifecycle !== "published" ||
      sources.repositoryGraph.repositoryRevision !== revision ||
      sources.semanticGraph.repositoryRevision !== revision ||
      sources.featureGraph.repositoryRevision !== revision ||
      sources.repositoryGraph.repositoryId !== repositoryId ||
      sources.semanticGraph.repositoryId !== repositoryId ||
      sources.featureGraph.repositoryId !== repositoryId ||
      sources.featureGraph.tenantId !== tenantId ||
      sources.featureGraph.ownerId !== ownerId) {
    throw new RepositoryInsightError(
      "repository_insight_revision_or_publication_invalid",
      "All structural intelligence must be published for the requested revision.");
  }
  if (sources.changeAnalyses.some((item) =>
      item.lifecycle !== "published" ||
      item.request.tenantId !== tenantId || item.request.ownerId !== ownerId ||
      item.request.repositoryId !== repositoryId ||
      item.request.repositoryRevision !== revision) ||
      sources.workflows.some((item) =>
        item.tenantId !== tenantId || item.ownerId !== ownerId ||
        item.repositoryId !== repositoryId ||
        item.repositoryRevision !== revision) ||
      sources.queryHistory.some((item) =>
        item.query.tenantId !== tenantId || item.query.userId !== ownerId ||
        item.query.repositoryId !== repositoryId ||
        item.query.repositoryRevision !== revision ||
        !["completed", "partial"].includes(item.query.lifecycle))) {
    throw new RepositoryInsightError(
      "repository_insight_auxiliary_ownership_invalid",
      "Auxiliary intelligence does not match repository ownership and revision.");
  }
  const graphNodeIds = new Set(sources.repositoryGraph.nodes.map((item) => item.nodeId));
  if (sources.repositoryGraph.edges.some((edge) =>
    !graphNodeIds.has(edge.fromNodeId) || !graphNodeIds.has(edge.toNodeId))) {
    throw new RepositoryInsightError(
      "repository_insight_graph_integrity_invalid",
      "Repository graph contains orphan dependency edges.");
  }
  const symbolIds = new Set(sources.semanticGraph.symbols.map((item) => item.symbolId));
  if (sources.semanticGraph.relationships.some((edge) =>
    !symbolIds.has(edge.fromSymbolId) || !symbolIds.has(edge.toSymbolId))) {
    throw new RepositoryInsightError(
      "repository_insight_semantic_consistency_invalid",
      "Semantic graph contains orphan relationships.");
  }
  if (sources.featureGraph.semanticGraphVersion !== sources.semanticGraph.graphVersion ||
      sources.featureGraph.repositoryIntelligenceVersion !==
        sources.repositoryIntelligence.intelligenceVersion) {
    throw new RepositoryInsightError(
      "repository_insight_feature_lineage_invalid",
      "Feature graph lineage does not match published structural intelligence.");
  }
  const featureIds = new Set(sources.featureGraph.features.map((item) => item.featureId));
  if (sources.featureGraph.features.some((feature) =>
      feature.symbolIds.some((id) => !symbolIds.has(id))) ||
      sources.featureGraph.relationships.some((edge) =>
        !featureIds.has(edge.fromFeatureId) ||
        (edge.toFeatureId !== null && !featureIds.has(edge.toFeatureId))) ||
      sources.featureGraph.flows.some((flow) =>
        !featureIds.has(flow.featureId) || flow.steps.some((step) =>
          step.symbolId !== null && !symbolIds.has(step.symbolId)))) {
    throw new RepositoryInsightError(
      "repository_insight_feature_lineage_invalid",
      "Feature graph contains orphan feature or semantic references.");
  }
}

export function validateInsightGeneration(
  generation: RepositoryInsightGeneration,
): void {
  const factors = generation.insights.flatMap((insight) => [
    insight.score.dependencyDepth, insight.score.featureImpact,
    insight.score.coupling, insight.score.usageFrequency,
    insight.score.queryFrequency, insight.score.architecturalCentrality,
  ]);
  if (!generation.generationId ||
      generation.schemaVersion !== REPOSITORY_INSIGHT_SCHEMA_VERSION ||
      !generation.tenantId || !generation.ownerId || !generation.repositoryId ||
      !/^[0-9a-f]{40}$/.test(generation.repositoryRevision) ||
      generation.insights.some((insight) =>
        !insight.insightId || !INSIGHT_TYPES.includes(insight.type) ||
        insight.repositoryId !== generation.repositoryId ||
        insight.repositoryRevision !== generation.repositoryRevision ||
        !insight.title || !insight.summary ||
        insight.confidence < 0 || insight.confidence > 1 ||
        insight.score.total < 0 || insight.score.total > 100 ||
        !Number.isFinite(insight.score.total) ||
        insight.supportingEvidence.length === 0 ||
        insight.supportingEvidence.some((item) =>
          !item.evidenceId || !item.reference || !item.sourceEngine ||
          !item.sourceVersion ||
          typeof item.details !== "object" || item.details === null))) {
    throw new RepositoryInsightError(
      "repository_insight_generation_invalid",
      "Repository insight generation or evidence is invalid.");
  }
  if (factors.some((value) =>
    !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RepositoryInsightError(
      "repository_insight_generation_invalid",
      "Repository insight score factors are invalid.");
  }
  const ids = generation.insights.map((item) => item.insightId);
  if (new Set(ids).size !== ids.length) {
    throw new RepositoryInsightError(
      "repository_insight_duplicate_id", "Insight IDs must be unique.");
  }
  for (const insight of generation.insights) {
    const evidenceIds = insight.supportingEvidence.map((item) =>
      item.evidenceId);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new RepositoryInsightError(
        "repository_insight_duplicate_evidence",
        "Evidence IDs must be unique within each insight.");
    }
  }
}

export function validateInsightEvidence(
  sources: RepositoryInsightSources,
  insights: readonly RepositoryInsight[],
): void {
  const permittedSources = new Set<string>([
    `Repository Intelligence\0${
      sources.repositoryIntelligence.intelligenceVersion
    }`,
    `Semantic Code Intelligence\0${sources.semanticGraph.graphVersion}`,
    `Feature Intelligence\0${sources.featureGraph.graphVersion}`,
    ...sources.changeAnalyses.map((item) =>
      `Change Intelligence\0${item.analysisId}`),
    ...sources.workflows.map((item) =>
      `Workflow Orchestrator\0${item.workflowVersion}`),
    ...sources.knowledge.map((item) =>
      `Repository Knowledge\0${item.version}`),
  ]);
  const featureIds = new Set(
    sources.featureGraph.features.map((item) => item.featureId));
  const semanticIds = new Set(
    sources.semanticGraph.symbols.map((item) => item.symbolId));
  const repositoryReportedSymbols = new Set([
    ...sources.repositoryIntelligence.symbols.orphanSymbols,
    ...sources.repositoryIntelligence.symbols.deadExports,
    ...sources.repositoryIntelligence.quality.duplicateImplementations
      .flatMap((item) => item.symbols),
  ]);
  if (insights.some((insight) =>
      insight.supportingEvidence.some((item) =>
        !permittedSources.has(`${item.sourceEngine}\0${item.sourceVersion}`)) ||
      insight.relatedFeatures.some((item) => !featureIds.has(item)) ||
      insight.relatedSymbols.some((item) =>
        !semanticIds.has(item) && !repositoryReportedSymbols.has(item)))) {
    throw new RepositoryInsightError(
      "repository_insight_evidence_integrity_invalid",
      "Insight evidence does not trace to a published intelligence source.");
  }
}

export const cloneInsight = <T>(value: T): T => structuredClone(value);
