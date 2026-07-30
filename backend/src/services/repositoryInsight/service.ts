import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import { runtimeRepositoryGraphStore } from "../repositoryGraph/graphStore.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeRepositoryIntelligenceStore } from "../repositoryIntelligence/store.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import { runtimeFeatureIntelligenceService } from "../featureIntelligence/service.js";
import { runtimeChangeIntelligenceService } from "../changeIntelligence/service.js";
import { runtimeRepositoryKnowledgeEngine } from "../repositoryKnowledge/service.js";
import { runtimeAutonomousWorkflowOrchestrator } from "../autonomousWorkflow/service.js";
import { runtimeRepositoryQueryStore } from "../repositoryQuery/store.js";
import {
  detectRepositoryInsights, repositoryInsightContentHash,
} from "./detector.js";
import { navigateRepositoryInsights } from "./navigation.js";
import {
  runtimeRepositoryInsightSourceReader,
  type RepositoryInsightSourceReader,
} from "./source.js";
import {
  runtimeRepositoryInsightStore, type RepositoryInsightStore,
} from "./store.js";
import {
  REPOSITORY_INSIGHT_SCHEMA_VERSION, RepositoryInsightError,
  type GenerateRepositoryInsightsInput, type InsightNavigationQuery,
  type InsightSourceVersions, type RepositoryInsightGeneration,
  type RepositoryInsightSources,
} from "./types.js";
import {
  validateInsightEvidence, validateInsightGeneration, validateInsightSources,
} from "./validation.js";

interface InsightDependencies {
  readonly repositories: RepositoryStore;
  readonly repositoryGraph: typeof runtimeRepositoryGraphStore;
  readonly repositoryIntelligence: {
    getPublishedSnapshot(repositoryId: string, revision: string):
      ReturnType<typeof runtimeRepositoryIntelligenceService.getPublishedSnapshot>;
    verify(): Promise<void>;
  };
  readonly semantic: typeof runtimeSemanticCodeIntelligenceService;
  readonly features: typeof runtimeFeatureIntelligenceService;
  readonly sources: RepositoryInsightSourceReader;
  readonly verifyAuxiliaryEngines: () => Promise<void>;
}

export const runtimeRepositoryInsightDependencies: InsightDependencies = {
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
  sources: runtimeRepositoryInsightSourceReader,
  verifyAuxiliaryEngines: async () => {
    await Promise.all([
      runtimeChangeIntelligenceService.verify(),
      runtimeRepositoryKnowledgeEngine.verify(),
      runtimeAutonomousWorkflowOrchestrator.verify(),
      runtimeRepositoryQueryStore.verify(),
    ]);
  },
};

function sourceVersions(sources: RepositoryInsightSources): InsightSourceVersions {
  return {
    repositoryIntelligence:
      sources.repositoryIntelligence.intelligenceVersion,
    repositoryGraph: sources.repositoryGraph.graphVersion,
    semanticGraph: sources.semanticGraph.graphVersion,
    featureGraph: sources.featureGraph.graphVersion,
    changes: stableHash(sources.changeAnalyses.map((item) =>
      [item.analysisId, item.persistenceVersion, item.updatedAt])),
    workflows: stableHash(sources.workflows.map((item) =>
      [item.workflowId, item.workflowVersion, item.updatedAt])),
    knowledge: stableHash(sources.knowledge.map((item) =>
      [item.knowledgeId, item.version, item.contentHash,
        item.repositoryRevision])),
    queries: stableHash(sources.queryHistory.map((item) =>
      [item.query.queryId, item.query.persistenceVersion,
        item.query.updatedAt])),
  };
}

export class RepositoryInsightEngine {
  constructor(
    private readonly store: RepositoryInsightStore =
      runtimeRepositoryInsightStore,
    private readonly dependencies: InsightDependencies =
      runtimeRepositoryInsightDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async generate(input: GenerateRepositoryInsightsInput) {
    await this.assertOwnership(input.ownerId, input.repositoryOwnerId,
      input.repositoryId, input.repositoryRevision);
    const [repositoryIntelligence, repositoryGraph, semanticGraph,
      featureGraph, auxiliary] = await Promise.all([
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
      this.dependencies.sources.load(
        input.tenantId, input.ownerId, input.repositoryId,
        input.repositoryRevision),
    ]);
    if (!repositoryIntelligence || !repositoryGraph ||
        !semanticGraph || !featureGraph) {
      throw new RepositoryInsightError(
        "repository_insight_published_sources_unavailable",
        "Published repository, graph, semantic, and feature intelligence are required.");
    }
    const sources: RepositoryInsightSources = {
      repositoryIntelligence, repositoryGraph, semanticGraph, featureGraph,
      ...auxiliary,
    };
    validateInsightSources(sources);
    const versions = sourceVersions(sources);
    const sourceFingerprint = stableHash(versions);
    const current = await this.store.getCurrent(
      input.tenantId, input.ownerId, input.repositoryId,
      input.repositoryRevision);
    if (current?.sourceFingerprint === sourceFingerprint) {
      await this.store.recordReuse(
        input.tenantId, input.ownerId, current.generationId,
        current.insights.length);
      return current;
    }

    const generatedAt = (input.generatedAt
      ? new Date(input.generatedAt) : this.clock()).toISOString();
    const started = Date.now();
    const detected = detectRepositoryInsights(sources, generatedAt);
    const currentById = new Map(current?.insights.map((item) =>
      [item.insightId, item]) ?? []);
    let reusedCount = 0;
    const insights = detected.map((insight) => {
      const previous = currentById.get(insight.insightId);
      if (!previous ||
          repositoryInsightContentHash(previous) !==
            repositoryInsightContentHash(insight)) return insight;
      reusedCount += 1;
      return { ...insight, createdAt: previous.createdAt };
    });
    validateInsightEvidence(sources, insights);
    const generationId = stableId("insight_generation", {
      tenantId: input.tenantId, ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      sourceFingerprint,
    });
    const generation: RepositoryInsightGeneration = {
      generationId, schemaVersion: REPOSITORY_INSIGHT_SCHEMA_VERSION,
      persistenceVersion: 1, tenantId: input.tenantId,
      ownerId: input.ownerId, repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      sourceVersions: versions, sourceFingerprint, lifecycle: "published",
      insights, diagnostics: [], generatedCount: insights.length - reusedCount,
      reusedCount,
      generationLatencyMs: input.generatedAt
        ? 0 : Math.max(0, Date.now() - started),
      recoveryCount: 0, createdAt: generatedAt, updatedAt: generatedAt,
      publishedAt: generatedAt,
    };
    validateInsightGeneration(generation);
    return this.store.save(generation);
  }

  async navigate(query: InsightNavigationQuery) {
    await this.assertOwnership(
      query.ownerId, query.ownerId, query.repositoryId,
      query.repositoryRevision);
    const generation = await this.store.getCurrent(
      query.tenantId, query.ownerId, query.repositoryId,
      query.repositoryRevision);
    if (!generation) return [];
    return navigateRepositoryInsights(generation.insights, query);
  }

  private async assertOwnership(
    ownerId: string, repositoryOwnerId: string,
    repositoryId: string, revision: string,
  ) {
    const repository = await this.dependencies.repositories
      .getRepository(repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        ownerId !== repositoryOwnerId ||
        repository.ownerUserId !== repositoryOwnerId) {
      throw new RepositoryInsightError(
        "repository_insight_access_denied",
        "Repository is not owned by the requesting user.");
    }
    if (repository.currentRevision !== revision ||
        repository.indexedRevision !== revision) {
      throw new RepositoryInsightError(
        "repository_insight_revision_conflict",
        "Insight revision is not the current published repository revision.");
    }
  }

  recover() { return this.store.recover(); }
  collect(tenantId: string, retainedGenerations = 20) {
    return this.store.collect(tenantId, retainedGenerations);
  }
  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  async verify() {
    await Promise.all([
      this.store.verify(), this.dependencies.sources.verify(),
      this.dependencies.repositoryGraph.verify(),
      this.dependencies.repositoryIntelligence.verify(),
      this.dependencies.semantic.verify(), this.dependencies.features.verify(),
      this.dependencies.verifyAuxiliaryEngines(),
    ]);
  }
}

export const runtimeRepositoryInsightEngine = new RepositoryInsightEngine();
