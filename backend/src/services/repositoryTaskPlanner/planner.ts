import type { AutonomousWorkflow } from "../autonomousWorkflow/types.js";
import type { ChangeAnalysis } from "../changeIntelligence/types.js";
import type { FeatureGraph } from "../featureIntelligence/types.js";
import type { KnowledgeRetrievalResult } from "../repositoryKnowledge/types.js";
import type { RepositoryEvolutionRecord } from "../repositoryEvolution/types.js";
import type { RepositoryInsight } from "../repositoryInsight/types.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import { stableId } from "../repositoryExecution/determinism.js";
import type { RepositorySymbolGraph } from "../repositoryGraph/graphTypes.js";
import type { RepositoryQueryExecution } from "../repositoryQuery/types.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";
import type {
  RepositoryTask, RepositoryTaskPlan, TaskEngineStep, TaskExecutionPhase,
  TaskImpact, TaskPlanningDiagnostic, TaskRiskAssessment,
  TaskValidationChecklist,
} from "./types.js";

export interface RepositoryTaskPlanningContext {
  readonly task: RepositoryTask;
  readonly orchestrationPlan: readonly TaskEngineStep[];
  readonly repositoryIntelligence: RepositoryIntelligenceRecord;
  readonly repositoryGraph: RepositorySymbolGraph;
  readonly semanticGraph: SemanticGraph;
  readonly featureGraph: FeatureGraph;
  readonly query: RepositoryQueryExecution | null;
  readonly change: ChangeAnalysis | null;
  readonly insights: readonly RepositoryInsight[];
  readonly evolution: RepositoryEvolutionRecord | null;
  readonly knowledge: readonly KnowledgeRetrievalResult[];
  readonly workflow: AutonomousWorkflow | null;
  readonly diagnostics: readonly TaskPlanningDiagnostic[];
  readonly engineUsage: readonly RepositoryTaskPlan["engineUsage"][number][];
  readonly latencyMs: number;
}

const unique = (values: readonly string[]) => [...new Set(
  values.filter(Boolean))].sort();
const tokens = (value: string) => unique(value.toLowerCase()
  .split(/[^a-z0-9_$./-]+/).filter((item) => item.length >= 3));
const boundedScore = (value: number) =>
  Number(Math.max(0, Math.min(100, value)).toFixed(2));

function orderedFiles(
  files: readonly string[],
  graph: RepositorySymbolGraph,
) {
  const selected = new Set(files);
  const nodes = new Map(graph.nodes.map((item) => [item.nodeId, item]));
  const dependencies = new Map<string, Set<string>>();
  for (const file of files) dependencies.set(file, new Set());
  for (const edge of graph.edges) {
    const from = nodes.get(edge.fromNodeId)?.file;
    const to = nodes.get(edge.toNodeId)?.file;
    if (from && to && from !== to && selected.has(from) && selected.has(to)) {
      dependencies.get(from)?.add(to);
    }
  }
  const result: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file) || visiting.has(file)) return;
    visiting.add(file);
    for (const dependency of [...(dependencies.get(file) ?? [])].sort()) {
      visit(dependency);
    }
    visiting.delete(file);
    visited.add(file);
    result.push(file);
  };
  for (const file of [...files].sort()) visit(file);
  return result;
}

export function discoverTaskImpact(
  context: RepositoryTaskPlanningContext,
): TaskImpact {
  const terms = tokens(context.task.normalizedObjective);
  const queryResponse = context.query?.response;
  const semanticMatches = context.semanticGraph.symbols.filter((symbol) =>
    terms.some((term) => `${symbol.name} ${symbol.qualifiedName} ${symbol.file}`
      .toLowerCase().includes(term)));
  const featureMatches = context.featureGraph.features.filter((feature) =>
    terms.some((term) =>
      `${feature.name} ${feature.description} ${feature.files.join(" ")}`
        .toLowerCase().includes(term)));
  const initialFiles = unique([
    ...(queryResponse?.relevantFiles ?? []),
    ...semanticMatches.map((item) => item.file),
    ...featureMatches.flatMap((item) => item.files),
    ...(context.change?.impact.directlyAffectedFiles ?? []),
    ...(context.change?.impact.indirectlyAffectedFiles ?? []),
    ...context.insights.flatMap((item) => item.relatedFiles),
  ]);
  const affectedFeatures = unique([
    ...(queryResponse?.relatedFeatures?.map((item) => item.featureId) ?? []),
    ...featureMatches.map((item) => item.featureId),
    ...(context.change?.impact.affectedFeatureIds ?? []),
    ...context.insights.flatMap((item) => item.relatedFeatures),
  ]);
  const affectedSymbols = unique([
    ...(queryResponse?.relevantSymbols?.map((item) => item.symbolId) ?? []),
    ...semanticMatches.map((item) => item.symbolId),
    ...(context.change?.impact.affectedSymbolIds ?? []),
    ...context.insights.flatMap((item) => item.relatedSymbols),
  ]);
  const affectedModules = unique(context.repositoryIntelligence.subsystems
    .filter((module) =>
      module.files.some((file) => initialFiles.includes(file)) ||
      terms.some((term) =>
        `${module.name} ${module.rootPath}`.toLowerCase().includes(term)))
    .map((item) => item.subsystemId));
  const selectedNodes = new Set(context.repositoryGraph.nodes.filter((node) =>
    initialFiles.includes(node.file) || affectedSymbols.includes(node.nodeId))
    .map((node) => node.nodeId));
  const nodes = new Map(context.repositoryGraph.nodes.map((node) =>
    [node.nodeId, node]));
  const relevantEdges = context.repositoryGraph.edges.filter((edge) =>
    selectedNodes.has(edge.fromNodeId) || selectedNodes.has(edge.toNodeId));
  const dependencies = unique(relevantEdges.map((edge) => {
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    return `${edge.kind}:${from?.qualifiedName ?? edge.fromNodeId}` +
      `->${to?.qualifiedName ?? edge.toNodeId}`;
  }));
  const downstreamImpact = unique([
    ...relevantEdges.filter((edge) => selectedNodes.has(edge.toNodeId))
      .map((edge) => nodes.get(edge.fromNodeId)?.qualifiedName ?? ""),
    ...(context.change?.impact.dependencyChains.map((chain) =>
      chain.steps.map((step) => `${step.kind}:${step.id}`).join(" -> ")) ?? []),
    ...(context.evolution?.trends.map((trend) => trend.summary) ?? []),
  ]);
  return {
    affectedFeatures, affectedModules, affectedFiles: initialFiles,
    affectedSymbols, dependencies, downstreamImpact,
  };
}

function riskLevel(value: number): TaskRiskAssessment["level"] {
  return value >= 80 ? "critical" : value >= 60 ? "high" :
    value >= 35 ? "medium" : "low";
}

export function assessTaskRisk(
  context: RepositoryTaskPlanningContext,
  impact: TaskImpact,
): TaskRiskAssessment {
  const featureSize = context.featureGraph.features
    .filter((item) => impact.affectedFeatures.includes(item.featureId))
    .reduce((sum, item) => sum + item.files.length + item.symbolIds.length, 0);
  const coupling = context.repositoryIntelligence.subsystems
    .filter((item) => impact.affectedModules.includes(item.subsystemId))
    .reduce((sum, item) => sum + item.metrics.incomingDependencies +
      item.metrics.outgoingDependencies, 0);
  const severeInsights = context.insights.filter((item) =>
    ["high", "critical"].includes(item.severity)).length;
  const publicSymbols = context.semanticGraph.symbols.filter((item) =>
    impact.affectedSymbols.includes(item.symbolId) &&
    item.visibility === "public").length;
  const dependencyDepth =
    context.change?.impact.maximumDependencyDepth ?? 0;
  const unstableTrends = context.evolution?.trends.filter((item) =>
    item.direction === "unstable" || item.direction === "increasing").length ?? 0;
  const inputs = {
    affectedFiles: impact.affectedFiles.length,
    affectedSymbols: impact.affectedSymbols.length,
    affectedFeatures: impact.affectedFeatures.length,
    featureSize, coupling, severeInsights, publicSymbols,
    dependencyDepth, downstreamSignals: impact.downstreamImpact.length,
    unstableTrends,
  };
  const implementationComplexity = boundedScore(
    impact.affectedFiles.length * 5 + impact.affectedSymbols.length * 2 +
    featureSize * 1.5);
  const architecturalRisk = boundedScore(
    coupling * 5 + severeInsights * 12 + unstableTrends * 8);
  const dependencyRisk = boundedScore(
    impact.dependencies.length * 4 + dependencyDepth * 12);
  const regressionRisk = boundedScore(
    impact.downstreamImpact.length * 6 + publicSymbols * 10 +
    (context.change?.risk.score ?? 0) * 0.35);
  const overallRisk = boundedScore(
    implementationComplexity * 0.28 + architecturalRisk * 0.24 +
    dependencyRisk * 0.22 + regressionRisk * 0.26);
  return {
    implementationComplexity, architecturalRisk, dependencyRisk,
    regressionRisk, overallRisk, level: riskLevel(overallRisk), inputs,
  };
}

function phase(
  taskId: string,
  position: number,
  kind: TaskExecutionPhase["kind"],
  objective: string,
  targets: readonly string[],
  actions: readonly string[],
  dependencies: readonly TaskExecutionPhase[],
  evidenceReferences: readonly string[],
): TaskExecutionPhase {
  return {
    phaseId: stableId("task_phase", { taskId, position, kind }),
    position, kind,
    title: kind.replace(/\b\w/g, (value) => value.toUpperCase()),
    objective, targets: unique(targets), actions: unique(actions),
    dependsOn: dependencies.length === 0 ? [] :
      [dependencies[dependencies.length - 1]!.phaseId],
    evidenceReferences: unique(evidenceReferences),
  };
}

export function buildTaskExecutionPhases(
  context: RepositoryTaskPlanningContext,
  impact: TaskImpact,
): TaskExecutionPhase[] {
  const phases: TaskExecutionPhase[] = [];
  const files = orderedFiles(impact.affectedFiles, context.repositoryGraph);
  const evidence = unique([
    context.repositoryIntelligence.intelligenceVersion,
    context.semanticGraph.graphVersion, context.featureGraph.graphVersion,
    context.change?.analysisId ?? "", context.query?.query.queryId ?? "",
    ...context.insights.map((item) => item.insightId),
    context.evolution?.evolutionId ?? "",
    ...context.knowledge.map((item) => item.knowledgeId),
    context.workflow?.workflowId ?? "",
  ]);
  phases.push(phase(context.task.taskId, 0, "preparation",
    "Fence the task to published intelligence and confirm its acceptance criteria.",
    [...impact.affectedFeatures, ...impact.affectedModules], [
      `Confirm the objective: ${context.task.normalizedObjective}`,
      "Record the current repository revision and intelligence versions.",
      "Resolve any planning diagnostics before implementation begins.",
    ], phases, evidence));
  phases.push(phase(context.task.taskId, 1, "investigation",
    "Trace the affected behavior and downstream impact before editing.",
    [...impact.affectedSymbols, ...impact.dependencies], [
      "Read affected entry points and dependency edges in evidence order.",
      "Confirm feature ownership and module boundaries.",
      "Review relevant insights, evolution trends, and knowledge references.",
    ], phases, evidence));
  phases.push(phase(context.task.taskId, 2, "implementation",
    "Apply the requested change in dependency-safe implementation order.",
    files, files.length > 0
      ? files.map((file, index) =>
        `Update ${file} at implementation position ${index + 1}.`)
      : ["Implement only after investigation identifies evidence-backed targets."],
    phases, evidence));
  phases.push(phase(context.task.taskId, 3, "validation",
    "Validate semantic, feature, API, and dependency consistency.",
    [...impact.affectedFiles, ...impact.affectedSymbols], [
      "Re-evaluate semantic relationships for affected symbols.",
      "Verify feature lineage and ownership remain consistent.",
      "Compare downstream impact with the planned blast radius.",
    ], phases, evidence));
  phases.push(phase(context.task.taskId, 4, "testing",
    "Exercise required tests and regression coverage for affected behavior.",
    impact.affectedFiles, [
      "Run focused tests for affected features and symbols.",
      "Run integration tests across affected dependency boundaries.",
      "Run regression coverage for downstream consumers.",
    ], phases, evidence));
  phases.push(phase(context.task.taskId, 5, "review",
    "Review the implementation against architecture and risk evidence.",
    [...impact.affectedModules, ...impact.affectedFeatures], [
      "Review public API and compatibility impact.",
      "Review dependency direction and architectural coupling.",
      "Confirm the implementation matches the normalized objective only.",
    ], phases, evidence));
  phases.push(phase(context.task.taskId, 6, "deployment readiness",
    "Confirm release, rollback, and operational readiness.",
    impact.affectedFiles, [
      "Confirm all required validation and review items are complete.",
      "Document rollback boundaries for affected modules and APIs.",
      "Confirm workflow checkpoints and deployment dependencies are ready.",
    ], phases, evidence));
  return phases;
}

export function buildTaskValidationChecklist(
  context: RepositoryTaskPlanningContext,
  impact: TaskImpact,
): TaskValidationChecklist {
  const existingTestFiles = context.semanticGraph.fileAnalyses
    .map((item) => item.file)
    .filter((file) => /(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  const requiredTests = unique([
    ...existingTestFiles.filter((file) => impact.affectedFiles.some((affected) =>
      file.includes(affected.split("/").slice(0, -1).join("/")))),
    ...impact.affectedFeatures.map((feature) =>
      `Focused tests for feature ${feature}`),
    ...impact.downstreamImpact.map((consumer) =>
      `Regression coverage for ${consumer}`),
    context.task.category === "security" ? "Security boundary regression tests" : "",
    context.task.category === "performance" ? "Performance benchmark comparison" : "",
    context.task.category === "API change" ? "API contract compatibility tests" : "",
  ]);
  return {
    requiredTests: requiredTests.length > 0 ? requiredTests :
      ["Focused unit and integration tests for evidence-backed targets"],
    verificationSteps: unique([
      "Verify repository revision fencing remains unchanged.",
      "Verify semantic and feature graph integrity after the task.",
      ...impact.dependencies.map((item) => `Verify dependency ${item}`),
    ]),
    affectedWorkflows: unique([
      ...(context.change?.impact.affectedWorkflowIds ?? []),
      ...(context.workflow ? [context.workflow.workflowId] : []),
    ]),
    reviewChecklist: unique([
      "Objective and acceptance criteria are satisfied.",
      "No unrelated repository areas were changed.",
      "Public API compatibility was reviewed.",
      "Dependency and regression risks were addressed.",
      "Tests, rollback boundaries, and deployment readiness were reviewed.",
    ]),
  };
}

export function buildRepositoryTaskPlan(
  context: RepositoryTaskPlanningContext,
): RepositoryTaskPlan {
  const impact = discoverTaskImpact(context);
  const risk = assessTaskRisk(context, impact);
  const phases = buildTaskExecutionPhases(context, impact);
  const validationChecklist = buildTaskValidationChecklist(context, impact);
  const accuracyInputCount = [
    context.repositoryIntelligence, context.repositoryGraph,
    context.semanticGraph, context.featureGraph, context.query,
    context.change, context.insights.length ? context.insights : null,
    context.evolution, context.knowledge.length ? context.knowledge : null,
    context.workflow,
  ].filter(Boolean).length;
  return {
    task: context.task,
    sourceVersions: {
      repositoryIntelligence:
        context.repositoryIntelligence.intelligenceVersion,
      repositoryGraph: context.repositoryGraph.graphVersion,
      semanticGraph: context.semanticGraph.graphVersion,
      featureGraph: context.featureGraph.graphVersion,
    },
    orchestrationPlan: context.orchestrationPlan,
    impact, phases, risk, validationChecklist,
    changeRoadmap: context.change?.implementationPlan ??
      context.query?.response?.implementationRoadmap ?? null,
    changeRisk: context.change?.risk ??
      context.query?.response?.changeImpact?.risk ?? null,
    diagnostics: context.diagnostics,
    engineUsage: [...new Set(context.engineUsage)],
    cacheHit: false, orchestrationLatencyMs: context.latencyMs,
    accuracyInputCount, recoveryCount: 0,
  };
}
