import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableId } from "../repositoryExecution/determinism.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeRepositoryIntelligenceStore } from "../repositoryIntelligence/store.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import type { SemanticGraph, SemanticSymbol } from "../semanticCodeIntelligence/types.js";
import { runtimeFeatureIntelligenceService } from "../featureIntelligence/service.js";
import type { FeatureGraph, FeatureRecord } from "../featureIntelligence/types.js";
import { runtimeChangeIntelligenceService } from "../changeIntelligence/service.js";
import type { ChangeTarget, ChangeTargetKind } from "../changeIntelligence/types.js";
import { runtimeRepositoryKnowledgeEngine } from "../repositoryKnowledge/service.js";
import type { KnowledgeNamespace } from "../repositoryKnowledge/types.js";
import { runtimeAutonomousWorkflowOrchestrator } from "../autonomousWorkflow/service.js";
import { classifyRepositoryQuery, deterministicRepositoryQueryId, normalizeRepositoryQuery } from "./classifier.js";
import { buildRepositoryQueryPlan } from "./planner.js";
import { runtimeRepositoryQueryStore, type RepositoryQueryStore } from "./store.js";
import {
  REPOSITORY_QUERY_SCHEMA_VERSION, RepositoryQueryError,
  type QueryDiagnostic, type QueryEngineName, type RepositoryQuery,
  type RepositoryQueryExecution, type RepositoryQueryInput,
  type RepositoryQueryResponse,
} from "./types.js";

interface QueryDependencies {
  readonly repositories: RepositoryStore;
  readonly repositoryIntelligence: Pick<
    typeof runtimeRepositoryIntelligenceService, "getPublishedSnapshot"
  > & { verify(): Promise<void> };
  readonly semantic: typeof runtimeSemanticCodeIntelligenceService;
  readonly features: typeof runtimeFeatureIntelligenceService;
  readonly changes: typeof runtimeChangeIntelligenceService;
  readonly knowledge: typeof runtimeRepositoryKnowledgeEngine;
  readonly workflows: typeof runtimeAutonomousWorkflowOrchestrator;
}

export const runtimeRepositoryQueryDependencies: QueryDependencies = {
  repositories: repositoryStore,
  repositoryIntelligence: {
    getPublishedSnapshot: (repositoryId, repositoryRevision) =>
      runtimeRepositoryIntelligenceService.getPublishedSnapshot(
        repositoryId, repositoryRevision),
    verify: () => runtimeRepositoryIntelligenceStore.verify(),
  },
  semantic: runtimeSemanticCodeIntelligenceService,
  features: runtimeFeatureIntelligenceService,
  changes: runtimeChangeIntelligenceService,
  knowledge: runtimeRepositoryKnowledgeEngine,
  workflows: runtimeAutonomousWorkflowOrchestrator,
};

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();
const tokens = (query: string) => query.split(/[^a-z0-9_$./-]+/)
  .filter((token) => token.length >= 3 && !new Set([
    "where", "what", "which", "does", "this", "that", "show", "explain",
    "modify", "change", "repository", "interface", "function", "service",
  ]).has(token));

function relevantSymbols(graph: SemanticGraph, normalizedQuery: string): SemanticSymbol[] {
  const terms = tokens(normalizedQuery);
  const direct = graph.symbols.filter((symbol) => {
    const haystack = `${symbol.name} ${symbol.qualifiedName} ${symbol.signature} ${symbol.file}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
  const ids = new Set(direct.map((symbol) => symbol.symbolId));
  for (const edge of graph.relationships) {
    if (ids.has(edge.fromSymbolId)) ids.add(edge.toSymbolId);
    if (ids.has(edge.toSymbolId)) ids.add(edge.fromSymbolId);
  }
  return graph.symbols.filter((symbol) => ids.has(symbol.symbolId))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line ||
    a.symbolId.localeCompare(b.symbolId));
}

function relevantFeatures(graph: FeatureGraph, normalizedQuery: string, file?: string): FeatureRecord[] {
  const terms = tokens(normalizedQuery);
  return graph.features.filter((feature) =>
    (file ? feature.files.includes(file) : false) ||
    terms.some((term) => `${feature.name} ${feature.description} ${feature.owningModules.join(" ")}`
      .toLowerCase().includes(term)))
    .sort((a, b) => b.confidence - a.confidence || a.featureId.localeCompare(b.featureId));
}

function changeTarget(
  selectors: RepositoryQueryExecution["plan"]["selectors"],
  symbols: readonly SemanticSymbol[],
  features: readonly FeatureRecord[],
): ChangeTarget {
  const priority: ReadonlyArray<readonly [ChangeTargetKind, string | undefined]> = [
    ["file", selectors.find((item) => item.kind === "file")?.value],
    ["symbol", selectors.find((item) => item.kind === "symbol")?.value ?? symbols[0]?.symbolId],
    ["feature", selectors.find((item) => item.kind === "feature")?.value ?? features[0]?.featureId],
    ["module", selectors.find((item) => item.kind === "module")?.value],
    ["api_endpoint", selectors.find((item) => item.kind === "API")?.value],
  ];
  const selected = priority.find(([, value]) => Boolean(value));
  return selected ? { kind: selected[0], value: selected[1]! } :
    { kind: "repository_component", value: "repository" };
}

function knowledgeNamespace(intents: RepositoryQuery["intents"]): KnowledgeNamespace | undefined {
  if (intents.includes("architecture")) return "architecture";
  if (intents.includes("implementation")) return "implementation";
  if (intents.includes("dependency")) return "dependencies";
  if (intents.includes("knowledge")) return "repository";
  return undefined;
}

export class RepositoryQueryEngine {
  constructor(
    private readonly store: RepositoryQueryStore = runtimeRepositoryQueryStore,
    private readonly dependencies: QueryDependencies = runtimeRepositoryQueryDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async query(input: RepositoryQueryInput): Promise<RepositoryQueryExecution> {
    const repository = await this.dependencies.repositories.getRepository(input.repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        repository.ownerUserId !== input.repositoryOwnerId ||
        input.userId !== input.repositoryOwnerId) {
      throw new RepositoryQueryError(
        "repository_query_access_denied", "Repository is not owned by the requesting user.");
    }
    if (repository.currentRevision !== input.repositoryRevision ||
        repository.indexedRevision !== input.repositoryRevision) {
      throw new RepositoryQueryError(
        "repository_query_revision_conflict",
        "Query revision is not the current published repository revision.");
    }
    const normalizedQuery = normalizeRepositoryQuery(input.query);
    if (!normalizedQuery) throw new RepositoryQueryError(
      "repository_query_empty", "Repository query must not be empty.");
    const queryId = deterministicRepositoryQueryId(input);
    const cached = await this.store.get(input.tenantId, input.userId, queryId);
    if (cached?.query.lifecycle === "completed" && cached.response &&
        cached.query.repositoryRevision === repository.currentRevision) {
      await this.store.recordCacheHit(input.tenantId, input.userId, queryId);
      return { ...cached, cacheHit: true };
    }

    const classified = classifyRepositoryQuery(input.query);
    const now = (input.requestedAt ? new Date(input.requestedAt) : this.clock()).toISOString();
    const query: RepositoryQuery = {
      queryId, schemaVersion: REPOSITORY_QUERY_SCHEMA_VERSION,
      persistenceVersion: 1, tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      workflowId: input.workflowId ?? null,
      sessionId: input.sessionId ?? null,
      userId: input.userId, originalQuery: input.query, normalizedQuery,
      intents: classified.intents, confidence: classified.confidence,
      lifecycle: "running", createdAt: now, updatedAt: now, completedAt: null,
    };
    const plan = buildRepositoryQueryPlan(
      queryId, query.intents, normalizedQuery, input.workflowId);
    let execution: RepositoryQueryExecution = {
      query, plan, response: null, diagnostics: [], cacheHit: false,
      engineUsage: [], latencyMs: 0,
    };
    execution = await this.store.save(execution);
    const started = Date.now();
    const diagnostics: QueryDiagnostic[] = [];
    const usage: QueryEngineName[] = [];
    let response: RepositoryQueryResponse | null = null;
    try {
      response = await this.execute(input, execution, diagnostics, usage);
    } catch (error) {
      diagnostics.push({
        code: error instanceof RepositoryQueryError
          ? error.code : "repository_query_engine_failure",
        message: error instanceof Error ? error.message : "Intelligence engine failed.",
        severity: "error",
      });
    }
    const completedAt = this.clock().toISOString();
    const lifecycle = response
      ? diagnostics.some((item) =>
        item.severity === "error" ||
        item.code === "repository_query_partial_engine_failure" ||
        item.code === "repository_query_published_intelligence_unavailable")
        ? "partial" : "completed"
      : "failed";
    const completed: RepositoryQueryExecution = {
      ...execution,
      query: { ...execution.query, lifecycle, updatedAt: completedAt, completedAt },
      response: response ? {
        ...response,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      } : null,
      diagnostics, engineUsage: usage,
      latencyMs: input.requestedAt ? 0 : Math.max(0, Date.now() - started),
    };
    return this.store.save(completed, execution.query.persistenceVersion);
  }

  private async execute(
    input: RepositoryQueryInput,
    execution: RepositoryQueryExecution,
    diagnostics: QueryDiagnostic[],
    usage: QueryEngineName[],
  ): Promise<RepositoryQueryResponse> {
    const planned = new Set(execution.plan.steps.map((step) => step.engine));
    const call = async <T>(engine: QueryEngineName, operation: () => Promise<T>): Promise<T | null> => {
      try {
        const value = await operation();
        usage.push(engine);
        if (value === null) diagnostics.push({
          code: "repository_query_published_intelligence_unavailable",
          message: `${engine} has no published context for this repository revision.`,
          severity: "warning", engine,
        });
        return value;
      } catch {
        diagnostics.push({
          code: "repository_query_partial_engine_failure",
          message: `${engine} was unavailable; only traceable results from other engines are returned.`,
          severity: "warning", engine,
        });
        return null;
      }
    };
    const intelligence = planned.has("Repository Intelligence")
      ? await call("Repository Intelligence", () =>
        this.dependencies.repositoryIntelligence.getPublishedSnapshot(
          input.repositoryId, input.repositoryRevision))
      : null;
    const semantic = planned.has("Semantic Code Intelligence")
      ? await call("Semantic Code Intelligence", () =>
        this.dependencies.semantic.get(
          input.tenantId, input.userId, input.repositoryId, input.repositoryRevision))
      : null;
    const featureGraph = planned.has("Feature Intelligence")
      ? await call("Feature Intelligence", () =>
        this.dependencies.features.get(
          input.tenantId, input.userId, input.repositoryId, input.repositoryRevision))
      : null;

    this.validateLineage(execution, intelligence, semantic, featureGraph, planned);
    const fileSelector = execution.plan.selectors.find((item) => item.kind === "file")?.value;
    const symbols = semantic ? relevantSymbols(semantic, execution.query.normalizedQuery) : [];
    const features = featureGraph
      ? relevantFeatures(featureGraph, execution.query.normalizedQuery, fileSelector) : [];
    const symbolIds = new Set(symbols.map((item) => item.symbolId));
    const featureIds = new Set(features.map((item) => item.featureId));
    const semanticEdges = semantic?.relationships.filter((edge) =>
      symbolIds.has(edge.fromSymbolId) || symbolIds.has(edge.toSymbolId)) ?? [];
    const featureEdges = featureGraph?.relationships.filter((edge) =>
      featureIds.has(edge.fromFeatureId) ||
      (edge.toFeatureId ? featureIds.has(edge.toFeatureId) : false)) ?? [];
    const flows = featureGraph?.flows.filter((flow) => featureIds.has(flow.featureId)) ?? [];
    let change = null;
    if (planned.has("Change Intelligence") && intelligence && semantic && featureGraph) {
      change = await call("Change Intelligence", () => this.dependencies.changes.analyze({
        tenantId: input.tenantId, ownerId: input.userId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        workflowId: input.workflowId ?? stableId("query_workflow", execution.query.queryId),
        requestedTarget: changeTarget(execution.plan.selectors, symbols, features),
        changeType: "modify", rationale: execution.query.originalQuery,
        repositoryIntelligence: intelligence, semanticGraph: semantic,
        featureGraph,
        requestedAt: execution.query.createdAt,
      }));
    }
    const knowledge = planned.has("Repository Knowledge")
      ? await call("Repository Knowledge", () => this.dependencies.knowledge.retrieve({
        tenantId: input.tenantId, ownerId: input.userId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        namespace: knowledgeNamespace(execution.query.intents),
        subject: execution.plan.selectors.find((item) => item.kind === "knowledge")?.value,
        minimumConfidence: 0, limit: 20,
      })) : null;
    const workflow = planned.has("Workflow Orchestrator") && input.workflowId
      ? await call("Workflow Orchestrator", () =>
        this.dependencies.workflows.get(input.tenantId, input.workflowId!, input.userId))
      : null;
    if (planned.has("Workflow Orchestrator") && !input.workflowId) diagnostics.push({
      code: "repository_query_workflow_id_required",
      message: "A workflow ID is required to return workflow context.",
      severity: "info", engine: "Workflow Orchestrator",
    });

    const relevantFiles = sortedUnique([
      ...symbols.map((item) => item.file),
      ...features.flatMap((item) => item.files),
      ...(intelligence && execution.query.intents.includes("repository overview")
        ? [...intelligence.symbols.entrypoints,
          ...intelligence.codeOrganization.largestModules.slice(0, 10).map((item) => item.path)]
        : []),
    ]);
    const evidenceCount = Number(Boolean(intelligence)) + symbols.length +
      features.length + (knowledge?.length ?? 0) + Number(Boolean(change)) +
      Number(Boolean(workflow));
    const confidence = evidenceCount === 0 ? 0 :
      Number(Math.min(execution.query.confidence,
        0.5 + Math.min(evidenceCount, 10) * 0.05).toFixed(2));
    const summary = this.summary(intelligence, symbols, features, knowledge ?? [], change);
    const matchingSubsystems = intelligence?.subsystems.filter((subsystem) =>
      tokens(execution.query.normalizedQuery).some((term) =>
        `${subsystem.name} ${subsystem.rootPath} ${subsystem.summary}`.toLowerCase()
          .includes(term))) ?? [];
    return {
      queryId: execution.query.queryId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      intents: execution.query.intents,
      ...(summary ? { summary } : {}),
      ...(intelligence && (execution.query.intents.includes("architecture") ||
          execution.query.intents.includes("repository overview")) ? {
        architecture: {
          overview: intelligence.architecture,
          subsystems: matchingSubsystems.length > 0
            ? matchingSubsystems : intelligence.subsystems,
        },
      } : {}),
      ...(features.length ? { relatedFeatures: features } : {}),
      ...(relevantFiles.length ? { relevantFiles } : {}),
      ...(symbols.length ? { relevantSymbols: symbols } : {}),
      ...(semanticEdges.length || featureEdges.length ? {
        dependencyGraph: { semantic: semanticEdges, features: featureEdges },
      } : {}),
      ...(flows.length ? { featureFlow: flows } : {}),
      ...(change ? {
        changeImpact: { impact: change.impact, risk: change.risk },
        implementationRoadmap: change.implementationPlan,
      } : {}),
      ...(knowledge?.length ? { knowledgeReferences: knowledge } : {}),
      ...(workflow ? { workflow: {
        workflowId: workflow.workflowId,
        repositoryId: workflow.repositoryId,
        repositoryRevision: workflow.repositoryRevision,
        lifecycle: workflow.lifecycle,
        currentStage: workflow.currentStage,
        checkpoints: workflow.checkpoints,
      } } : {}),
      confidence,
      ...(diagnostics.length ? { diagnostics } : {}),
    };
  }

  private validateLineage(
    execution: RepositoryQueryExecution,
    intelligence: RepositoryIntelligenceRecord | null,
    semantic: SemanticGraph | null,
    features: FeatureGraph | null,
    planned: ReadonlySet<QueryEngineName>,
  ): void {
    const revision = execution.query.repositoryRevision;
    if ((intelligence && (intelligence.repositoryRevision !== revision ||
          intelligence.status !== "published")) ||
        (semantic && (semantic.repositoryRevision !== revision ||
          semantic.lifecycle !== "published")) ||
        (features && (features.repositoryRevision !== revision ||
          features.lifecycle !== "published"))) {
      throw new RepositoryQueryError(
        "repository_query_revision_lineage_invalid",
        "Intelligence revision or publication lineage is inconsistent.");
    }
    if (features && semantic &&
        features.semanticGraphVersion !== semantic.graphVersion) {
      throw new RepositoryQueryError(
        "repository_query_semantic_lineage_invalid",
        "Feature intelligence does not reference the published semantic graph.");
    }
    if (features && intelligence &&
        features.repositoryIntelligenceVersion !== intelligence.intelligenceVersion) {
      throw new RepositoryQueryError(
        "repository_query_feature_lineage_invalid",
        "Feature intelligence does not reference published repository intelligence.");
    }
    if (semantic) {
      const ids = new Set(semantic.symbols.map((symbol) => symbol.symbolId));
      if (semantic.relationships.some((edge) =>
        !ids.has(edge.fromSymbolId) || !ids.has(edge.toSymbolId))) {
        throw new RepositoryQueryError(
          "repository_query_graph_integrity_invalid",
          "Semantic graph contains orphan relationships.");
      }
      if (features) {
        const featureIds = new Set(features.features.map((feature) => feature.featureId));
        const invalidFeatureSymbols = features.features.some((feature) =>
          feature.symbolIds.some((symbolId) => !ids.has(symbolId)));
        const invalidRelationships = features.relationships.some((edge) =>
          !featureIds.has(edge.fromFeatureId) ||
          (edge.toFeatureId !== null && !featureIds.has(edge.toFeatureId)));
        const invalidFlows = features.flows.some((flow) =>
          !featureIds.has(flow.featureId) || flow.steps.some((step) =>
            step.symbolId !== null && !ids.has(step.symbolId)));
        if (invalidFeatureSymbols || invalidRelationships || invalidFlows) {
          throw new RepositoryQueryError(
            "repository_query_feature_lineage_invalid",
            "Feature graph contains orphan feature, flow, or semantic references.");
        }
      }
    }
  }

  private summary(
    intelligence: RepositoryIntelligenceRecord | null,
    symbols: readonly SemanticSymbol[],
    features: readonly FeatureRecord[],
    knowledge: readonly { content: { summary: string } }[],
    change: Awaited<ReturnType<typeof runtimeChangeIntelligenceService.analyze>> | null,
  ): string | undefined {
    if (features[0]) return features[0].description;
    if (symbols[0]) return `${symbols[0].qualifiedName} is defined in ${symbols[0].file}:${symbols[0].line}.`;
    if (change) return change.risk.reasons.join(" ") || undefined;
    if (knowledge[0]?.content.summary) return knowledge[0].content.summary;
    if (intelligence) return `Published repository intelligence covers ${intelligence.metrics.filesAnalyzed} files, ${intelligence.subsystems.length} subsystems, and ${intelligence.metrics.symbolsAnalyzed} symbols.`;
    return undefined;
  }

  recover() { return this.store.recover(); }
  collect(tenantId: string, retainedQueries = 1_000) {
    return this.store.collect(tenantId, retainedQueries);
  }
  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  async verify() {
    await Promise.all([
      this.store.verify(),
      this.dependencies.repositoryIntelligence.verify(),
      this.dependencies.semantic.verify(),
      this.dependencies.features.verify(),
      this.dependencies.changes.verify(),
      this.dependencies.knowledge.verify(),
      this.dependencies.workflows.verify(),
    ]);
  }
}

export const runtimeRepositoryQueryEngine = new RepositoryQueryEngine();
