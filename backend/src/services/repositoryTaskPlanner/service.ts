import type { ChangeAnalysis, ChangeTarget, ChangeType } from "../changeIntelligence/types.js";
import { runtimeChangeIntelligenceService } from "../changeIntelligence/service.js";
import type { FeatureGraph } from "../featureIntelligence/types.js";
import { runtimeFeatureIntelligenceService } from "../featureIntelligence/service.js";
import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableId } from "../repositoryExecution/determinism.js";
import type { RepositorySymbolGraph } from "../repositoryGraph/graphTypes.js";
import { runtimeRepositoryGraphStore } from "../repositoryGraph/graphStore.js";
import type { RepositoryInsight } from "../repositoryInsight/types.js";
import { runtimeRepositoryInsightEngine } from "../repositoryInsight/service.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeRepositoryIntelligenceStore } from "../repositoryIntelligence/store.js";
import type { RepositoryEvolutionRecord } from "../repositoryEvolution/types.js";
import { runtimeRepositoryEvolutionIntelligenceEngine } from "../repositoryEvolution/service.js";
import type { RepositoryQueryExecution } from "../repositoryQuery/types.js";
import { runtimeRepositoryQueryEngine } from "../repositoryQuery/service.js";
import type { KnowledgeRetrievalResult } from "../repositoryKnowledge/types.js";
import { runtimeRepositoryKnowledgeEngine } from "../repositoryKnowledge/service.js";
import type { SemanticGraph } from "../semanticCodeIntelligence/types.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import type { AutonomousWorkflow } from "../autonomousWorkflow/types.js";
import { runtimeAutonomousWorkflowOrchestrator } from "../autonomousWorkflow/service.js";
import {
  classifyRepositoryTask, deterministicRepositoryTaskId,
  normalizeTaskObjective, selectTaskPlanningEngines,
} from "./classifier.js";
import { buildRepositoryTaskPlan } from "./planner.js";
import {
  runtimeRepositoryTaskPlannerStore, type RepositoryTaskPlannerStore,
} from "./store.js";
import {
  REPOSITORY_TASK_PLAN_SCHEMA_VERSION, RepositoryTaskPlannerError,
  type CreateRepositoryTaskPlanInput, type RepositoryTask,
  type TaskPlanningDiagnostic, type TaskPlanningEngine,
} from "./types.js";
import {
  validateRepositoryTaskPlan, validateTaskPlannerSources,
} from "./validation.js";

interface PlannerDependencies {
  repositories: RepositoryStore;
  repositoryGraph: {
    loadPublished(repositoryId: string, revision: string):
      Promise<RepositorySymbolGraph | null>;
    verify(): Promise<void>;
  };
  repositoryIntelligence: {
    getPublishedSnapshot(repositoryId: string, revision: string):
      Promise<RepositoryIntelligenceRecord | null>;
    verify(): Promise<void>;
  };
  semantic: {
    get(tenantId: string, ownerId: string, repositoryId: string,
      revision: string): Promise<SemanticGraph | null>;
    verify(): Promise<void>;
  };
  features: {
    get(tenantId: string, ownerId: string, repositoryId: string,
      revision: string): Promise<FeatureGraph | null>;
    verify(): Promise<void>;
  };
  query: Pick<typeof runtimeRepositoryQueryEngine, "query" | "verify">;
  changes: Pick<typeof runtimeChangeIntelligenceService, "analyze" | "verify">;
  insights: Pick<typeof runtimeRepositoryInsightEngine, "generate" | "verify">;
  evolution: Pick<
    typeof runtimeRepositoryEvolutionIntelligenceEngine, "compare" | "verify"
  >;
  knowledge: Pick<typeof runtimeRepositoryKnowledgeEngine, "retrieve" | "verify">;
  workflows: Pick<
    typeof runtimeAutonomousWorkflowOrchestrator, "list" | "verify"
  >;
}

export const runtimeRepositoryTaskPlannerDependencies: PlannerDependencies = {
  repositories: repositoryStore,
  repositoryGraph: runtimeRepositoryGraphStore,
  repositoryIntelligence: {
    getPublishedSnapshot: (repositoryId, revision) =>
      runtimeRepositoryIntelligenceService.getPublishedSnapshot(
        repositoryId, revision),
    verify: () => runtimeRepositoryIntelligenceStore.verify(),
  },
  semantic: runtimeSemanticCodeIntelligenceService,
  features: runtimeFeatureIntelligenceService,
  query: runtimeRepositoryQueryEngine,
  changes: runtimeChangeIntelligenceService,
  insights: runtimeRepositoryInsightEngine,
  evolution: runtimeRepositoryEvolutionIntelligenceEngine,
  knowledge: runtimeRepositoryKnowledgeEngine,
  workflows: runtimeAutonomousWorkflowOrchestrator,
};

function changeType(category: RepositoryTask["category"]): ChangeType {
  if (category === "bug fix") return "fix";
  if (category === "new feature") return "add";
  if (category === "refactor" ||
      category === "architecture improvement") return "refactor";
  if (category === "dependency update") return "migrate";
  return "modify";
}

function requestedTarget(
  objective: string, semantic: SemanticGraph, feature: FeatureGraph,
): ChangeTarget {
  const path = objective.match(
    /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+)(?:\s|$)/)?.[1];
  if (path) return { kind: "file", value: path };
  const words = objective.split(/[^a-z0-9_$]+/).filter((item) =>
    item.length >= 3);
  const symbol = semantic.symbols.find((item) => words.some((word) =>
    `${item.name} ${item.qualifiedName}`.toLowerCase().includes(word)));
  if (symbol) return { kind: "symbol", value: symbol.symbolId };
  const matchedFeature = feature.features.find((item) => words.some((word) =>
    `${item.name} ${item.description}`.toLowerCase().includes(word)));
  return matchedFeature
    ? { kind: "feature", value: matchedFeature.featureId }
    : { kind: "repository_component", value: "repository" };
}

export class RepositoryTaskPlanner {
  constructor(
    private readonly store: RepositoryTaskPlannerStore =
      runtimeRepositoryTaskPlannerStore,
    private readonly dependencies: PlannerDependencies =
      runtimeRepositoryTaskPlannerDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async plan(input: CreateRepositoryTaskPlanInput) {
    const repository = await this.dependencies.repositories
      .getRepository(input.repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        repository.ownerUserId !== input.repositoryOwnerId ||
        input.ownerId !== input.repositoryOwnerId) {
      throw new RepositoryTaskPlannerError(
        "repository_task_planner_access_denied",
        "Repository is not owned by the requesting user.");
    }
    if (repository.currentRevision !== input.repositoryRevision ||
        repository.indexedRevision !== input.repositoryRevision) {
      throw new RepositoryTaskPlannerError(
        "repository_task_planner_revision_conflict",
        "Task revision is not the current indexed repository revision.");
    }
    const objective = normalizeTaskObjective(input.userRequest);
    if (!objective) throw new RepositoryTaskPlannerError(
      "repository_task_planner_empty_objective",
      "Task objective must not be empty.");
    const taskId = deterministicRepositoryTaskId(input);
    const cached = await this.store.get(
      input.tenantId, input.ownerId, taskId);
    if (cached &&
        cached.task.repositoryRevision === repository.currentRevision) {
      await this.store.recordCacheHit(
        input.tenantId, input.ownerId, taskId);
      return { ...cached, cacheHit: true };
    }

    const classification = classifyRepositoryTask(input.userRequest);
    const orchestrationPlan = selectTaskPlanningEngines(
      classification.category, input.workflowId);
    const selected = new Set(orchestrationPlan.map((item) => item.engine));
    const now = (input.requestedAt
      ? new Date(input.requestedAt) : this.clock()).toISOString();
    const task: RepositoryTask = {
      taskId, schemaVersion: REPOSITORY_TASK_PLAN_SCHEMA_VERSION,
      persistenceVersion: 1, tenantId: input.tenantId,
      ownerId: input.ownerId, repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      userRequest: input.userRequest, normalizedObjective: objective,
      category: classification.category, confidence: classification.confidence,
      lifecycle: "planning", createdAt: now, updatedAt: now,
      completedAt: null,
    };
    const started = Date.now();
    const [intelligence, graph, semantic, feature] = await Promise.all([
      this.dependencies.repositoryIntelligence.getPublishedSnapshot(
        input.repositoryId, input.repositoryRevision),
      this.dependencies.repositoryGraph.loadPublished(
        input.repositoryId, input.repositoryRevision),
      this.dependencies.semantic.get(
        input.tenantId, input.ownerId, input.repositoryId,
        input.repositoryRevision),
      this.dependencies.features.get(
        input.tenantId, input.ownerId, input.repositoryId,
        input.repositoryRevision),
    ]);
    if (!intelligence || !graph || !semantic || !feature) {
      throw new RepositoryTaskPlannerError(
        "repository_task_planner_published_sources_unavailable",
        "Published repository, graph, semantic, and feature intelligence is required.");
    }
    validateTaskPlannerSources({
      repositoryIntelligence: intelligence, repositoryGraph: graph,
      semanticGraph: semantic, featureGraph: feature,
    }, input.tenantId, input.ownerId, input.repositoryId,
    input.repositoryRevision);

    const diagnostics: TaskPlanningDiagnostic[] = [];
    const usage: TaskPlanningEngine[] = [
      "Repository Intelligence", "Semantic Intelligence",
      "Feature Intelligence",
    ];
    const optional = async <T>(
      engine: TaskPlanningEngine, operation: () => Promise<T>,
      fallback: T,
    ) => {
      try {
        const value = await operation();
        usage.push(engine);
        return value;
      } catch (error) {
        diagnostics.push({
          code: "repository_task_planner_partial_orchestration_failure",
          message: error instanceof Error ? error.message :
            `${engine} was unavailable.`,
          severity: "warning", engine,
        });
        return fallback;
      }
    };

    let query: RepositoryQueryExecution | null = null;
    if (selected.has("Query Engine")) {
      query = await optional("Query Engine", () =>
        this.dependencies.query.query({
          tenantId: input.tenantId, userId: input.ownerId,
          repositoryOwnerId: input.repositoryOwnerId,
          repositoryId: input.repositoryId,
          repositoryRevision: input.repositoryRevision,
          query: input.userRequest, workflowId: input.workflowId,
          requestedAt: now,
        }), null);
    }
    let change: ChangeAnalysis | null = null;
    if (query?.response?.implementationRoadmap) {
      usage.push("Change Intelligence");
    } else if (selected.has("Change Intelligence")) {
      change = await optional("Change Intelligence", () =>
        this.dependencies.changes.analyze({
          tenantId: input.tenantId, ownerId: input.ownerId,
          repositoryOwnerId: input.repositoryOwnerId,
          repositoryId: input.repositoryId,
          repositoryRevision: input.repositoryRevision,
          workflowId: input.workflowId ?? stableId("task_workflow", taskId),
          requestedTarget: requestedTarget(objective, semantic, feature),
          changeType: changeType(classification.category),
          rationale: input.userRequest, repositoryIntelligence: intelligence,
          semanticGraph: semantic, featureGraph: feature, requestedAt: now,
        }), null);
    }
    let insights: readonly RepositoryInsight[] = [];
    if (selected.has("Repository Insights")) {
      const generated = await optional("Repository Insights", () =>
        this.dependencies.insights.generate({
          tenantId: input.tenantId, ownerId: input.ownerId,
          repositoryOwnerId: input.repositoryOwnerId,
          repositoryId: input.repositoryId,
          repositoryRevision: input.repositoryRevision, generatedAt: now,
        }), null);
      insights = generated?.insights ?? [];
    }
    let evolution: RepositoryEvolutionRecord | null = null;
    if (selected.has("Evolution Intelligence") &&
        repository.previousRevision) {
      evolution = await optional("Evolution Intelligence", () =>
        this.dependencies.evolution.compare({
          tenantId: input.tenantId, ownerId: input.ownerId,
          repositoryOwnerId: input.repositoryOwnerId,
          repositoryId: input.repositoryId,
          baseRevision: repository.previousRevision!,
          targetRevision: input.repositoryRevision, comparisonTimestamp: now,
        }), null);
    } else if (selected.has("Evolution Intelligence")) {
      diagnostics.push({
        code: "repository_task_planner_evolution_baseline_unavailable",
        message: "No previous published revision is available for evolution evidence.",
        severity: "info", engine: "Evolution Intelligence",
      });
    }
    let knowledge: readonly KnowledgeRetrievalResult[] =
      query?.response?.knowledgeReferences ?? [];
    if (knowledge.length > 0) usage.push("Knowledge Engine");
    else if (selected.has("Knowledge Engine")) {
      knowledge = await optional("Knowledge Engine", () =>
        this.dependencies.knowledge.retrieve({
          tenantId: input.tenantId, ownerId: input.ownerId,
          repositoryId: input.repositoryId,
          repositoryRevision: input.repositoryRevision,
          subject: objective, minimumConfidence: 0, limit: 20,
        }), []);
    }
    let workflow: AutonomousWorkflow | null = null;
    if (selected.has("Workflow Engine") && input.workflowId) {
      const workflows = await optional("Workflow Engine", () =>
        Promise.resolve(this.dependencies.workflows.list(
          input.tenantId, input.ownerId)), []);
      workflow = workflows.find((item) =>
        item.workflowId === input.workflowId &&
        item.repositoryId === input.repositoryId &&
        item.repositoryRevision === input.repositoryRevision) ?? null;
      if (!workflow) diagnostics.push({
        code: "repository_task_planner_workflow_unavailable",
        message: "Requested workflow was not published for this revision.",
        severity: "warning", engine: "Workflow Engine",
      });
    }
    const completedAt = this.clock().toISOString();
    const finalTask: RepositoryTask = {
      ...task,
      lifecycle: diagnostics.some((item) => item.severity === "warning")
        ? "partial" : "published",
      updatedAt: completedAt, completedAt,
    };
    const plan = buildRepositoryTaskPlan({
      task: finalTask, orchestrationPlan, repositoryIntelligence: intelligence,
      repositoryGraph: graph, semanticGraph: semantic, featureGraph: feature,
      query, change, insights, evolution, knowledge, workflow, diagnostics,
      engineUsage: usage,
      latencyMs: input.requestedAt ? 0 : Math.max(0, Date.now() - started),
    });
    validateRepositoryTaskPlan(plan);
    return this.store.save(plan);
  }

  recover() { return this.store.recover(); }
  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  collect(tenantId: string, retainedPlans = 50) {
    return this.store.collect(tenantId, retainedPlans);
  }
  async verify() {
    await Promise.all([
      this.store.verify(), this.dependencies.repositoryGraph.verify(),
      this.dependencies.repositoryIntelligence.verify(),
      this.dependencies.semantic.verify(), this.dependencies.features.verify(),
      this.dependencies.query.verify(), this.dependencies.changes.verify(),
      this.dependencies.insights.verify(), this.dependencies.evolution.verify(),
      this.dependencies.knowledge.verify(), this.dependencies.workflows.verify(),
    ]);
  }
}

export const runtimeRepositoryTaskPlanner = new RepositoryTaskPlanner();
