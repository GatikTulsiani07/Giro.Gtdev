import { createHash } from "node:crypto";
import type { FeatureRecord } from "../featureIntelligence/types.js";
import { validateFeatureGraph } from "../featureIntelligence/validation.js";
import type { SemanticSymbol } from "../semanticCodeIntelligence/types.js";
import { validateSemanticGraph } from "../semanticCodeIntelligence/validation.js";
import {
  CHANGE_INTELLIGENCE_SCHEMA_VERSION,
  ChangeIntelligenceError,
  type AnalyzeChangeInput,
  type ChangeAnalysis,
  type ChangeImpactGraph,
  type ChangeImplementationPlan,
  type ChangeRequest,
  type ChangeRiskAssessment,
  type ChangeRiskLevel,
  type ImpactDependencyChain,
  type ImpactDependencyStep,
  type ImpactNodeKind,
  type ImplementationPlanPhase,
} from "./types.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalized(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

export function deterministicChangeId(input: Pick<AnalyzeChangeInput,
  "repositoryId" | "repositoryRevision" | "workflowId" | "requestedTarget" |
  "changeType" | "rationale">): string {
  return hash(["change-v1", input.repositoryId, input.repositoryRevision,
    input.workflowId, input.requestedTarget.kind,
    normalized(input.requestedTarget.value), input.changeType,
    input.rationale.trim()]);
}

function assertLineage(input: AnalyzeChangeInput): void {
  const { repositoryIntelligence: repository, semanticGraph: semantic,
    featureGraph: feature } = input;
  const subsystemIds = new Set(repository.subsystems.map((item) =>
    item.subsystemId));
  const repositoryGraphInvalid =
    subsystemIds.size !== repository.subsystems.length ||
    repository.subsystems.some((item) => item.dependencies.some((dependency) =>
      !subsystemIds.has(dependency))) ||
    repository.architecture.dependencyGraph.some((edge) =>
      !subsystemIds.has(edge.from) || !subsystemIds.has(edge.to) ||
      edge.from === edge.to || edge.count < 1) ||
    repository.metrics.generatedSubsystems !== repository.subsystems.length;
  try {
    validateSemanticGraph(semantic);
    validateFeatureGraph(feature);
  } catch {
    throw new ChangeIntelligenceError(
      "change_intelligence_graph_integrity_invalid",
      "Semantic or feature graph integrity validation failed.",
    );
  }
  if (!input.tenantId || !input.ownerId || !input.workflowId ||
      !input.requestedTarget.value.trim() || !input.rationale.trim() ||
      input.ownerId !== input.repositoryOwnerId ||
      semantic.ownerId !== input.ownerId || feature.ownerId !== input.ownerId ||
      semantic.tenantId !== input.tenantId || feature.tenantId !== input.tenantId ||
      repository.repositoryId !== input.repositoryId ||
      semantic.repositoryId !== input.repositoryId ||
      feature.repositoryId !== input.repositoryId ||
      repository.repositoryRevision !== input.repositoryRevision ||
      semantic.repositoryRevision !== input.repositoryRevision ||
      feature.repositoryRevision !== input.repositoryRevision ||
      repository.status !== "published" || semantic.lifecycle !== "published" ||
      feature.lifecycle !== "published" ||
      feature.repositoryIntelligenceVersion !== repository.intelligenceVersion ||
      feature.semanticGraphVersion !== semantic.graphVersion ||
      repositoryGraphInvalid ||
      repository.publicationMetadata.repositoryRevision !==
        repository.repositoryRevision) {
    throw new ChangeIntelligenceError(
      "change_intelligence_lineage_invalid",
      "Published repository, semantic, and feature intelligence with matching ownership and revision are required.",
    );
  }
}

function matches(value: string, query: string): boolean {
  const candidate = normalized(value);
  return candidate === query || candidate.includes(query);
}

function resolveDirect(input: AnalyzeChangeInput): {
  files: string[];
  symbols: string[];
  features: FeatureRecord[];
  apis: string[];
  modules: string[];
} {
  const query = normalized(input.requestedTarget.value);
  const semantic = input.semanticGraph;
  const feature = input.featureGraph;
  let symbols: SemanticSymbol[] = [];
  let features: FeatureRecord[] = [];
  let files: string[] = [];
  let apis: string[] = [];
  let modules: string[] = [];

  switch (input.requestedTarget.kind) {
    case "feature":
      features = feature.features.filter((item) =>
        matches(item.featureId, query) || matches(item.name, query));
      break;
    case "module":
      modules = unique(feature.features.flatMap((item) =>
        item.owningModules.filter((module) => matches(module, query))));
      features = feature.features.filter((item) =>
        item.owningModules.some((module) => matches(module, query)));
      symbols = semantic.symbols.filter((item) => matches(item.file, query));
      break;
    case "file":
      files = unique(semantic.symbols.map((item) => item.file)
        .filter((file) => matches(file, query)));
      break;
    case "symbol":
      symbols = semantic.symbols.filter((item) =>
        matches(item.symbolId, query) || matches(item.qualifiedName, query) ||
        matches(item.name, query));
      break;
    case "api_endpoint":
    case "route":
      apis = unique(feature.relationships.filter((edge) =>
        edge.kind === "exposes_endpoint" && matches(edge.target, query))
        .map((edge) => edge.target));
      features = feature.features.filter((item) =>
        feature.relationships.some((edge) => edge.fromFeatureId === item.featureId &&
          edge.kind === "exposes_endpoint" && matches(edge.target, query)));
      break;
    case "service":
      symbols = semantic.symbols.filter((item) =>
        (matches(item.qualifiedName, query) || matches(item.name, query) ||
          matches(item.file, query)) &&
        /service|usecase|use_case/iu.test(`${item.file} ${item.qualifiedName}`));
      break;
    case "repository_component":
      symbols = semantic.symbols.filter((item) =>
        (matches(item.qualifiedName, query) || matches(item.name, query) ||
          matches(item.file, query)) &&
        /repositor(?:y|ies)|store|persistence|database|(?:^|\/)db(?:\/|$)/iu
          .test(`${item.file} ${item.qualifiedName}`));
      break;
  }
  files = unique([...files, ...symbols.map((item) => item.file),
    ...features.flatMap((item) => item.files)]);
  symbols = semantic.symbols.filter((item) =>
    symbols.some((direct) => direct.symbolId === item.symbolId) ||
    files.includes(item.file) || features.some((f) => f.symbolIds.includes(item.symbolId)));
  features = feature.features.filter((item) =>
    features.some((direct) => direct.featureId === item.featureId) ||
    item.files.some((file) => files.includes(file)) ||
    item.symbolIds.some((id) => symbols.some((symbol) => symbol.symbolId === id)));
  apis = unique([...apis, ...feature.relationships.filter((edge) =>
    edge.kind === "exposes_endpoint" &&
    features.some((item) => item.featureId === edge.fromFeatureId))
    .map((edge) => edge.target)]);
  return { files, symbols: unique(symbols.map((item) => item.symbolId)),
    features, apis, modules };
}

function step(kind: ImpactNodeKind, id: string, position: number): ImpactDependencyStep {
  return { position, kind, id };
}

function buildImpact(input: AnalyzeChangeInput, changeId: string): ChangeImpactGraph {
  const direct = resolveDirect(input);
  if (direct.files.length === 0 && direct.symbols.length === 0 &&
      direct.features.length === 0 && direct.apis.length === 0) {
    throw new ChangeIntelligenceError(
      "change_target_not_found",
      "The requested target does not exist in the published intelligence graphs.",
      { target: input.requestedTarget },
    );
  }
  const semantic = input.semanticGraph;
  const directSymbols = new Set(direct.symbols);
  const impactedSymbols = new Set(direct.symbols);
  const chains: ImpactDependencyChain[] = [];
  const queue = [...direct.symbols].map((id) => ({ id, path: [id] }));
  const seenPaths = new Set<string>();
  while (queue.length > 0 && chains.length < 500) {
    const current = queue.shift()!;
    if (current.path.length > 9) continue;
    const adjacent = semantic.relationships.filter((edge) =>
      edge.fromSymbolId === current.id || edge.toSymbolId === current.id)
      .map((edge) => edge.fromSymbolId === current.id
        ? edge.toSymbolId : edge.fromSymbolId)
      .sort();
    for (const next of unique(adjacent)) {
      if (current.path.includes(next)) continue;
      const path = [...current.path, next];
      const key = path.join("\0");
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      impactedSymbols.add(next);
      if (chains.length >= 500) break;
      chains.push({
        chainId: hash(["impact-chain-v1", changeId, path]),
        steps: path.map((id, position) => step("symbol", id, position)),
      });
      if (path.length < 9) queue.push({ id: next, path });
    }
  }
  const symbolById = new Map(semantic.symbols.map((item) => [item.symbolId, item]));
  const indirectFiles = unique([...impactedSymbols].filter((id) =>
    !directSymbols.has(id)).map((id) => symbolById.get(id)?.file ?? "")
    .filter((file) => file && !direct.files.includes(file)));
  const affectedFeatures = input.featureGraph.features.filter((feature) =>
    feature.files.some((file) => direct.files.includes(file) ||
      indirectFiles.includes(file)) ||
    feature.symbolIds.some((id) => impactedSymbols.has(id)));
  for (const edge of input.featureGraph.relationships.filter((item) =>
    item.toFeatureId !== null &&
    affectedFeatures.some((feature) => feature.featureId === item.fromFeatureId))) {
    const path = [edge.fromFeatureId, edge.toFeatureId!];
    chains.push({
      chainId: hash(["feature-impact-chain-v1", changeId, edge.relationshipId]),
      steps: path.map((id, position) => step("feature", id, position)),
    });
  }
  const featureIds = unique(affectedFeatures.map((item) => item.featureId));
  const affectedApis = unique(input.featureGraph.relationships.filter((edge) =>
    edge.kind === "exposes_endpoint" && featureIds.includes(edge.fromFeatureId))
    .map((edge) => edge.target));
  const workflows = unique([input.workflowId, ...input.featureGraph.flows
    .filter((flow) => featureIds.includes(flow.featureId)).map((flow) => flow.flowId)]);
  const dedupedChains = [...new Map(chains.map((chain) =>
    [chain.chainId, chain])).values()]
    .sort((a, b) => a.chainId.localeCompare(b.chainId));
  return {
    impactGraphId: hash(["impact-graph-v1", changeId,
      direct.files, indirectFiles, [...impactedSymbols].sort(), featureIds]),
    changeId,
    directlyAffectedFiles: direct.files,
    indirectlyAffectedFiles: indirectFiles,
    affectedSymbolIds: unique(impactedSymbols),
    affectedFeatureIds: featureIds,
    affectedApis,
    affectedWorkflowIds: workflows,
    dependencyChains: dedupedChains,
    maximumDependencyDepth: dedupedChains.reduce((maximum, chain) =>
      Math.max(maximum, chain.steps.length - 1), 0),
  };
}

function assessRisk(
  input: AnalyzeChangeInput,
  changeId: string,
  impact: ChangeImpactGraph,
): ChangeRiskAssessment {
  const factors = {
    directFiles: Math.min(20, impact.directlyAffectedFiles.length * 4),
    indirectFiles: Math.min(20, impact.indirectlyAffectedFiles.length * 2),
    features: Math.min(15, impact.affectedFeatureIds.length * 5),
    publicApis: Math.min(15, impact.affectedApis.length * 5),
    workflows: Math.min(10, Math.max(0, impact.affectedWorkflowIds.length - 1) * 2),
    dependencyDepth: Math.min(10, impact.maximumDependencyDepth * 2),
    destructiveChange: ["remove", "migrate"].includes(input.changeType) ? 15 : 0,
    publicTarget: ["api_endpoint", "route"].includes(input.requestedTarget.kind) ? 10 : 0,
  };
  const score = Math.min(100, Object.values(factors).reduce((sum, value) => sum + value, 0));
  const level: ChangeRiskLevel = score >= 75 ? "critical"
    : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  const reasons = Object.entries(factors).filter(([, value]) => value > 0)
    .map(([name, value]) => `${name}:${value}`).sort();
  return {
    riskAssessmentId: hash(["risk-v1", changeId, score, reasons]),
    changeId, level, score, reasons, factors,
  };
}

function buildPlan(
  input: AnalyzeChangeInput,
  changeId: string,
  impact: ChangeImpactGraph,
  risk: ChangeRiskAssessment,
): ChangeImplementationPlan {
  const definitions: Array<[ImplementationPlanPhase, string, string[]]> = [
    ["preparation", "Verify repository revision and intelligence lineage.",
      [input.repositoryRevision]],
    ["preparation", "Confirm ownership and snapshot the requested change surface.",
      [input.requestedTarget.value]],
    ["dependencies", "Review dependency chains in deterministic depth order.",
      impact.dependencyChains.map((item) => item.chainId)],
    ["implementation", "Apply the proposed change to directly affected files.",
      [...impact.directlyAffectedFiles]],
    ["implementation", "Reconcile indirectly affected symbols and features.",
      [...impact.affectedSymbolIds, ...impact.affectedFeatureIds]],
    ["validation", "Validate impacted APIs and workflow flows.",
      [...impact.affectedApis, ...impact.affectedWorkflowIds]],
    ["validation", "Run repository checks for the impacted dependency surface.",
      [...impact.directlyAffectedFiles, ...impact.indirectlyAffectedFiles]],
    ["review", `Review ${risk.level} risk factors and dependency boundaries.`,
      [...risk.reasons]],
  ];
  const steps = definitions.map(([phase, action, targets], position) => ({
    stepId: hash(["implementation-plan-step-v1", changeId, position, phase,
      action, unique(targets)]),
    position, phase, action, targets: unique(targets),
  }));
  return {
    implementationPlanId: hash(["implementation-plan-v1", changeId,
      steps.map((item) => item.stepId)]),
    changeId, steps,
  };
}

export function analyzeChange(input: AnalyzeChangeInput): ChangeAnalysis {
  assertLineage(input);
  const timestamp = input.requestedAt ?? new Date().toISOString();
  const changeId = deterministicChangeId(input);
  const request: ChangeRequest = {
    changeId, tenantId: input.tenantId, ownerId: input.ownerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    workflowId: input.workflowId, requestedTarget: {
      kind: input.requestedTarget.kind,
      value: input.requestedTarget.value.trim(),
    },
    changeType: input.changeType, rationale: input.rationale.trim(),
    createdAt: timestamp, updatedAt: timestamp,
  };
  const impact = buildImpact(input, changeId);
  const risk = assessRisk(input, changeId, impact);
  const implementationPlan = buildPlan(input, changeId, impact, risk);
  const analysisId = hash(["change-analysis-v1", changeId,
    input.repositoryIntelligence.intelligenceVersion,
    input.semanticGraph.graphVersion, input.featureGraph.graphVersion,
    impact.impactGraphId, risk.riskAssessmentId,
    implementationPlan.implementationPlanId]);
  return {
    analysisId, schemaVersion: CHANGE_INTELLIGENCE_SCHEMA_VERSION,
    persistenceVersion: 1, lifecycle: "published", request,
    repositoryIntelligenceVersion:
      input.repositoryIntelligence.intelligenceVersion,
    semanticGraphVersion: input.semanticGraph.graphVersion,
    featureGraphVersion: input.featureGraph.graphVersion,
    impact, risk, implementationPlan, diagnostics: [],
    createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp,
  };
}
