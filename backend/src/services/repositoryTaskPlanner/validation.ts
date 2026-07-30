import type { FeatureGraph } from "../featureIntelligence/types.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import type { RepositorySymbolGraph } from "../repositoryGraph/graphTypes.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";
import {
  REPOSITORY_TASK_PLAN_SCHEMA_VERSION, REPOSITORY_TASK_PLANNER_VERSION,
  RepositoryTaskPlannerError, type RepositoryTaskPlan,
} from "./types.js";

export interface RepositoryTaskPlannerSources {
  repositoryIntelligence: RepositoryIntelligenceRecord;
  repositoryGraph: RepositorySymbolGraph;
  semanticGraph: SemanticGraph;
  featureGraph: FeatureGraph;
}

export function validateTaskPlannerSources(
  sources: RepositoryTaskPlannerSources,
  tenantId: string,
  ownerId: string,
  repositoryId: string,
  revision: string,
) {
  const { repositoryIntelligence: intelligence, repositoryGraph: graph,
    semanticGraph: semantic, featureGraph: feature } = sources;
  if (intelligence.repositoryId !== repositoryId ||
      graph.repositoryId !== repositoryId ||
      semantic.repositoryId !== repositoryId ||
      feature.repositoryId !== repositoryId ||
      intelligence.repositoryRevision !== revision ||
      graph.repositoryRevision !== revision ||
      semantic.repositoryRevision !== revision ||
      feature.repositoryRevision !== revision ||
      semantic.tenantId !== tenantId || semantic.ownerId !== ownerId ||
      feature.tenantId !== tenantId || feature.ownerId !== ownerId ||
      intelligence.status !== "published" || graph.status !== "published" ||
      semantic.lifecycle !== "published" || feature.lifecycle !== "published") {
    throw new RepositoryTaskPlannerError(
      "repository_task_planner_sources_invalid",
      "Planning requires owned, published intelligence for the requested revision.");
  }
  if (feature.semanticGraphVersion !== semantic.graphVersion ||
      feature.repositoryIntelligenceVersion !==
        intelligence.intelligenceVersion) {
    throw new RepositoryTaskPlannerError(
      "repository_task_planner_feature_lineage_invalid",
      "Feature lineage does not match semantic and repository intelligence.");
  }
  const nodes = new Set(graph.nodes.map((item) => item.nodeId));
  if (graph.edges.some((edge) =>
    !nodes.has(edge.fromNodeId) || !nodes.has(edge.toNodeId))) {
    throw new RepositoryTaskPlannerError(
      "repository_task_planner_graph_integrity_invalid",
      "Repository graph contains an orphan dependency endpoint.");
  }
  const symbols = new Set(semantic.symbols.map((item) => item.symbolId));
  if (semantic.relationships.some((edge) =>
    !symbols.has(edge.fromSymbolId) || !symbols.has(edge.toSymbolId))) {
    throw new RepositoryTaskPlannerError(
      "repository_task_planner_semantic_consistency_invalid",
      "Semantic graph contains an orphan relationship.");
  }
  const features = new Set(feature.features.map((item) => item.featureId));
  if (feature.features.some((item) =>
    item.symbolIds.some((symbolId) => !symbols.has(symbolId))) ||
      feature.relationships.some((edge) =>
        !features.has(edge.fromFeatureId) ||
        (edge.toFeatureId !== null && !features.has(edge.toFeatureId)))) {
    throw new RepositoryTaskPlannerError(
      "repository_task_planner_feature_lineage_invalid",
      "Feature graph contains orphan feature or semantic references.");
  }
}

const phaseKinds = [
  "preparation", "investigation", "implementation", "validation",
  "testing", "review", "deployment readiness",
];

export function validateRepositoryTaskPlan(plan: RepositoryTaskPlan) {
  const task = plan.task;
  const phasesRequired = task.lifecycle === "published" ||
    task.lifecycle === "partial";
  const phaseIds = new Set(plan.phases.map((item) => item.phaseId));
  const forbiddenCode = /```|(?:^|\s)(?:function|class)\s+\w+\s*[({]/i;
  if (!task.taskId ||
      task.schemaVersion !== REPOSITORY_TASK_PLAN_SCHEMA_VERSION ||
      !task.tenantId || !task.ownerId || !task.repositoryId ||
      !/^[0-9a-f]{40}$/.test(task.repositoryRevision) ||
      !task.userRequest.trim() || !task.normalizedObjective ||
      task.confidence < 0 || task.confidence > 1 ||
      !plan.sourceVersions.repositoryIntelligence ||
      !plan.sourceVersions.repositoryGraph ||
      !plan.sourceVersions.semanticGraph ||
      !plan.sourceVersions.featureGraph ||
      plan.orchestrationLatencyMs < 0 || plan.accuracyInputCount < 0 ||
      plan.recoveryCount < 0 ||
      (phasesRequired && plan.phases.length !== phaseKinds.length) ||
      plan.phases.some((item, position) =>
        item.position !== position ||
        item.kind !== phaseKinds[position] ||
        !item.phaseId || !item.objective ||
        item.dependsOn.some((id) => !phaseIds.has(id)) ||
        item.dependsOn.some((id) =>
          plan.phases.findIndex((phase) => phase.phaseId === id) >= position) ||
        [...item.actions, item.objective].some((text) =>
          forbiddenCode.test(text))) ||
      phaseIds.size !== plan.phases.length ||
      Object.values(plan.risk.inputs).some((value) =>
        !Number.isFinite(value) || value < 0) ||
      [
        plan.risk.implementationComplexity, plan.risk.architecturalRisk,
        plan.risk.dependencyRisk, plan.risk.regressionRisk,
        plan.risk.overallRisk,
      ].some((value) => value < 0 || value > 100)) {
    throw new RepositoryTaskPlannerError(
      "repository_task_plan_invalid",
      "Task plan structure, evidence, ordering, or safety contract is invalid.",
      { plannerVersion: REPOSITORY_TASK_PLANNER_VERSION });
  }
}

export const cloneTaskPlan = <T>(value: T): T => structuredClone(value);
