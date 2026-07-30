import {
  REPOSITORY_EVOLUTION_ANALYSIS_VERSION,
  REPOSITORY_EVOLUTION_SCHEMA_VERSION,
  RepositoryEvolutionError,
  type RepositoryEvolutionRecord, type RepositoryEvolutionSources,
} from "./types.js";

export function validateEvolutionSources(
  sources: RepositoryEvolutionSources,
): void {
  const revisions = [
    sources.base.repositoryIntelligence.repositoryRevision,
    sources.target.repositoryIntelligence.repositoryRevision,
  ];
  if (revisions[0] === revisions[1]) {
    throw new RepositoryEvolutionError(
      "repository_evolution_revision_lineage_invalid",
      "Base and target revisions must differ.");
  }
  for (const [index, side] of [sources.base, sources.target].entries()) {
    const revision = revisions[index]!;
    const repositoryId = side.repositoryIntelligence.repositoryId;
    const lifecycleAllowed = index === 0
      ? new Set(["published", "superseded"])
      : new Set(["published"]);
    if (!lifecycleAllowed.has(side.repositoryIntelligence.status) ||
        !lifecycleAllowed.has(side.repositoryGraph.status) ||
        !lifecycleAllowed.has(side.semanticGraph.lifecycle) ||
        !lifecycleAllowed.has(side.featureGraph.lifecycle) ||
        side.repositoryGraph.repositoryId !== repositoryId ||
        side.semanticGraph.repositoryId !== repositoryId ||
        side.featureGraph.repositoryId !== repositoryId ||
        side.repositoryGraph.repositoryRevision !== revision ||
        side.semanticGraph.repositoryRevision !== revision ||
        side.featureGraph.repositoryRevision !== revision) {
      throw new RepositoryEvolutionError(
        "repository_evolution_published_sources_invalid",
        "Every compared source must be published for the requested revision.");
    }
    if (side.featureGraph.semanticGraphVersion !== side.semanticGraph.graphVersion ||
        side.featureGraph.repositoryIntelligenceVersion !==
          side.repositoryIntelligence.intelligenceVersion) {
      throw new RepositoryEvolutionError(
        "repository_evolution_feature_lineage_invalid",
        "Feature lineage does not match semantic and repository intelligence.");
    }
    const graphNodes = new Set(side.repositoryGraph.nodes.map((item) =>
      item.nodeId));
    if (side.repositoryGraph.edges.some((item) =>
      !graphNodes.has(item.fromNodeId) || !graphNodes.has(item.toNodeId))) {
      throw new RepositoryEvolutionError(
        "repository_evolution_graph_integrity_invalid",
        "Repository graph contains an orphan dependency endpoint.");
    }
    const symbols = new Set(side.semanticGraph.symbols.map((item) =>
      item.symbolId));
    if (side.semanticGraph.relationships.some((item) =>
      !symbols.has(item.fromSymbolId) || !symbols.has(item.toSymbolId))) {
      throw new RepositoryEvolutionError(
        "repository_evolution_semantic_consistency_invalid",
        "Semantic graph contains an orphan relationship.");
    }
    const features = new Set(side.featureGraph.features.map((item) =>
      item.featureId));
    if (side.featureGraph.features.some((feature) =>
      feature.symbolIds.some((symbolId) => !symbols.has(symbolId))) ||
      side.featureGraph.relationships.some((item) =>
        !features.has(item.fromFeatureId) ||
        (item.toFeatureId !== null && !features.has(item.toFeatureId))) ||
      side.featureGraph.flows.some((flow) =>
        !features.has(flow.featureId) || flow.steps.some((step) =>
          step.symbolId !== null && !symbols.has(step.symbolId)))) {
      throw new RepositoryEvolutionError(
        "repository_evolution_feature_lineage_invalid",
        "Feature intelligence contains orphan semantic or feature references.");
    }
    if (side.workflows.some((item) =>
      item.tenantId !== side.semanticGraph.tenantId ||
      item.ownerId !== side.semanticGraph.ownerId ||
      item.repositoryId !== repositoryId ||
      item.repositoryRevision !== revision) ||
      side.knowledge.some((item) => item.repositoryRevision !== revision)) {
      throw new RepositoryEvolutionError(
        "repository_evolution_auxiliary_ownership_invalid",
        "Workflow or knowledge intelligence crossed a revision boundary.");
    }
  }
  if (sources.base.repositoryIntelligence.repositoryId !==
      sources.target.repositoryIntelligence.repositoryId ||
      sources.base.semanticGraph.tenantId !== sources.target.semanticGraph.tenantId ||
      sources.base.semanticGraph.ownerId !== sources.target.semanticGraph.ownerId) {
    throw new RepositoryEvolutionError(
      "repository_evolution_ownership_invalid",
      "Compared intelligence does not share repository ownership.");
  }
}

export function validateEvolutionRecord(record: RepositoryEvolutionRecord): void {
  const validRevision = (value: string) => /^[0-9a-f]{40}$/.test(value);
  const timelineIds = record.timelines.map((item) => item.timelineId);
  const trendIds = record.trends.map((item) => item.trendId);
  if (!record.evolutionId ||
      record.schemaVersion !== REPOSITORY_EVOLUTION_SCHEMA_VERSION ||
      record.analysisVersion !== REPOSITORY_EVOLUTION_ANALYSIS_VERSION ||
      !record.tenantId || !record.ownerId || !record.repositoryId ||
      !validRevision(record.baseRevision) ||
      !validRevision(record.targetRevision) ||
      record.baseRevision === record.targetRevision ||
      !record.sourceFingerprint ||
      record.comparisonLatencyMs < 0 || record.reusedCount < 0 ||
      record.timelines.some((item) =>
        item.evolutionId !== record.evolutionId ||
        item.baseRevision !== record.baseRevision ||
        item.targetRevision !== record.targetRevision ||
        item.evidence.length === 0 ||
        item.evidence.some((entry) =>
          !entry.evidenceId || !entry.sourceEngine ||
          !entry.sourceVersion || !entry.reference)) ||
      record.trends.some((item) =>
        item.evolutionId !== record.evolutionId ||
        item.magnitude < 0 || item.magnitude > 1 ||
        item.confidence < 0 || item.confidence > 1 ||
        item.evidence.length === 0) ||
      new Set(timelineIds).size !== timelineIds.length ||
      new Set(trendIds).size !== trendIds.length) {
    throw new RepositoryEvolutionError(
      "repository_evolution_record_invalid",
      "Evolution record, history, trend, or evidence integrity is invalid.");
  }
}

export const cloneEvolution = <T>(value: T): T => structuredClone(value);
