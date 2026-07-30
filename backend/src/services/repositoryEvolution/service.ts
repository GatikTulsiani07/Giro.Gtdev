import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import { runtimeRepositoryGraphStore } from "../repositoryGraph/graphStore.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeRepositoryIntelligenceStore } from "../repositoryIntelligence/store.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import { runtimeFeatureIntelligenceService } from "../featureIntelligence/service.js";
import { runtimeAutonomousWorkflowOrchestrator } from "../autonomousWorkflow/service.js";
import { runtimeRepositoryKnowledgeEngine } from "../repositoryKnowledge/service.js";
import {
  buildEvolutionTimelines, compareRepositoryEvolution,
  generateEvolutionTrends,
} from "./comparison.js";
import { navigateEvolutionHistory } from "./navigation.js";
import {
  runtimeRepositoryEvolutionSourceReader,
  type RepositoryEvolutionSourceReader,
} from "./source.js";
import {
  runtimeRepositoryEvolutionStore, type RepositoryEvolutionStore,
} from "./store.js";
import {
  REPOSITORY_EVOLUTION_ANALYSIS_VERSION,
  REPOSITORY_EVOLUTION_SCHEMA_VERSION,
  RepositoryEvolutionError,
  type CompareRepositoryRevisionsInput, type EvolutionNavigationQuery,
  type EvolutionSourceVersions, type RepositoryEvolutionRecord,
  type RepositoryEvolutionSources,
} from "./types.js";
import {
  validateEvolutionRecord, validateEvolutionSources,
} from "./validation.js";

interface EvolutionDependencies {
  readonly repositories: RepositoryStore;
  readonly repositoryGraph: typeof runtimeRepositoryGraphStore;
  readonly repositoryIntelligence: {
    getPublishedSnapshot(repositoryId: string, revision: string):
      ReturnType<typeof runtimeRepositoryIntelligenceService.getPublishedSnapshot>;
    verify(): Promise<void>;
  };
  readonly semantic: typeof runtimeSemanticCodeIntelligenceService;
  readonly features: typeof runtimeFeatureIntelligenceService;
  readonly auxiliary: RepositoryEvolutionSourceReader;
  readonly verifyAuxiliaryEngines: () => Promise<void>;
}

export const runtimeRepositoryEvolutionDependencies: EvolutionDependencies = {
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
  auxiliary: runtimeRepositoryEvolutionSourceReader,
  verifyAuxiliaryEngines: async () => {
    await Promise.all([
      runtimeAutonomousWorkflowOrchestrator.verify(),
      runtimeRepositoryKnowledgeEngine.verify(),
    ]);
  },
};

function sourceVersions(
  sources: RepositoryEvolutionSources,
): EvolutionSourceVersions {
  const workflowVersions = [
    ...sources.base.workflows, ...sources.target.workflows,
  ].map((item) => [
    item.repositoryRevision, item.workflowId,
    item.workflowVersion, item.updatedAt,
  ] as const).sort((a, b) =>
    a.join("\0").localeCompare(b.join("\0")));
  const knowledgeVersions = [
    ...sources.base.knowledge, ...sources.target.knowledge,
  ].map((item) => [
    item.repositoryRevision, item.knowledgeId,
    item.version, item.contentHash,
  ] as const).sort((a, b) =>
    a.join("\0").localeCompare(b.join("\0")));
  return {
    baseRepositoryIntelligence:
      sources.base.repositoryIntelligence.intelligenceVersion,
    targetRepositoryIntelligence:
      sources.target.repositoryIntelligence.intelligenceVersion,
    baseRepositoryGraph: sources.base.repositoryGraph.graphVersion,
    targetRepositoryGraph: sources.target.repositoryGraph.graphVersion,
    baseSemanticGraph: sources.base.semanticGraph.graphVersion,
    targetSemanticGraph: sources.target.semanticGraph.graphVersion,
    baseFeatureGraph: sources.base.featureGraph.graphVersion,
    targetFeatureGraph: sources.target.featureGraph.graphVersion,
    workflows: stableHash(workflowVersions),
    knowledge: stableHash(knowledgeVersions),
  };
}

export class RepositoryEvolutionIntelligenceEngine {
  constructor(
    private readonly store: RepositoryEvolutionStore =
      runtimeRepositoryEvolutionStore,
    private readonly dependencies: EvolutionDependencies =
      runtimeRepositoryEvolutionDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async compare(input: CompareRepositoryRevisionsInput) {
    await this.assertOwnership(input);
    const historical = this.dependencies.auxiliary.loadRevision
      ? await Promise.all([
        this.dependencies.auxiliary.loadRevision(
          input.tenantId, input.ownerId, input.repositoryId,
          input.baseRevision),
        this.dependencies.auxiliary.loadRevision(
          input.tenantId, input.ownerId, input.repositoryId,
          input.targetRevision),
      ])
      : [null, null] as const;
    if (historical[0] && historical[1]) {
      return this.compareSources(input, {
        base: historical[0], target: historical[1],
      });
    }
    const [
      baseRepositoryIntelligence, targetRepositoryIntelligence,
      baseRepositoryGraph, targetRepositoryGraph,
      baseSemanticGraph, targetSemanticGraph,
      baseFeatureGraph, targetFeatureGraph, auxiliary,
    ] = await Promise.all([
      this.dependencies.repositoryIntelligence.getPublishedSnapshot(
        input.repositoryId, input.baseRevision),
      this.dependencies.repositoryIntelligence.getPublishedSnapshot(
        input.repositoryId, input.targetRevision),
      this.dependencies.repositoryGraph.loadPublished(
        input.repositoryId, input.baseRevision),
      this.dependencies.repositoryGraph.loadPublished(
        input.repositoryId, input.targetRevision),
      this.dependencies.semantic.get(
        input.tenantId, input.ownerId, input.repositoryId, input.baseRevision),
      this.dependencies.semantic.get(
        input.tenantId, input.ownerId, input.repositoryId, input.targetRevision),
      this.dependencies.features.get(
        input.tenantId, input.ownerId, input.repositoryId, input.baseRevision),
      this.dependencies.features.get(
        input.tenantId, input.ownerId, input.repositoryId, input.targetRevision),
      this.dependencies.auxiliary.load(
        input.tenantId, input.ownerId, input.repositoryId,
        input.baseRevision, input.targetRevision),
    ]);
    if (!baseRepositoryIntelligence || !targetRepositoryIntelligence ||
        !baseRepositoryGraph || !targetRepositoryGraph ||
        !baseSemanticGraph || !targetSemanticGraph ||
        !baseFeatureGraph || !targetFeatureGraph) {
      throw new RepositoryEvolutionError(
        "repository_evolution_published_sources_unavailable",
        "Both revisions require published repository, graph, semantic, and feature intelligence.");
    }
    const sources: RepositoryEvolutionSources = {
      base: {
        repositoryIntelligence: baseRepositoryIntelligence,
        repositoryGraph: baseRepositoryGraph,
        semanticGraph: baseSemanticGraph, featureGraph: baseFeatureGraph,
        workflows: auxiliary.baseWorkflows,
        knowledge: auxiliary.baseKnowledge,
      },
      target: {
        repositoryIntelligence: targetRepositoryIntelligence,
        repositoryGraph: targetRepositoryGraph,
        semanticGraph: targetSemanticGraph, featureGraph: targetFeatureGraph,
        workflows: auxiliary.targetWorkflows,
        knowledge: auxiliary.targetKnowledge,
      },
    };
    return this.compareSources(input, sources);
  }

  private async compareSources(
    input: CompareRepositoryRevisionsInput,
    sources: RepositoryEvolutionSources,
  ) {
    validateEvolutionSources(sources);
    const versions = sourceVersions(sources);
    const sourceFingerprint = stableHash(versions);
    const current = await this.store.get(
      input.tenantId, input.ownerId, input.repositoryId,
      input.baseRevision, input.targetRevision);
    if (current?.sourceFingerprint === sourceFingerprint) {
      await this.store.recordReuse(
        input.tenantId, input.ownerId, current.evolutionId);
      return current;
    }
    const comparisonTimestamp = (input.comparisonTimestamp
      ? new Date(input.comparisonTimestamp) : this.clock()).toISOString();
    const started = Date.now();
    const evolutionId = stableId("repository_evolution", {
      tenantId: input.tenantId, ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      baseRevision: input.baseRevision, targetRevision: input.targetRevision,
      analysisVersion: REPOSITORY_EVOLUTION_ANALYSIS_VERSION,
    });
    const comparison = compareRepositoryEvolution(sources);
    const timelines = buildEvolutionTimelines(
      evolutionId, input.baseRevision, input.targetRevision,
      comparisonTimestamp, comparison);
    const trends = generateEvolutionTrends(evolutionId, comparison, sources);
    const record: RepositoryEvolutionRecord = {
      evolutionId, schemaVersion: REPOSITORY_EVOLUTION_SCHEMA_VERSION,
      persistenceVersion: 1, tenantId: input.tenantId,
      ownerId: input.ownerId, repositoryId: input.repositoryId,
      baseRevision: input.baseRevision, targetRevision: input.targetRevision,
      comparisonTimestamp,
      analysisVersion: REPOSITORY_EVOLUTION_ANALYSIS_VERSION,
      sourceFingerprint, sourceVersions: versions, lifecycle: "published",
      comparison, timelines, trends, diagnostics: [], reusedCount: 0,
      comparisonLatencyMs: input.comparisonTimestamp
        ? 0 : Math.max(0, Date.now() - started),
      recoveryCount: 0, createdAt: comparisonTimestamp,
      updatedAt: comparisonTimestamp, publishedAt: comparisonTimestamp,
    };
    validateEvolutionRecord(record);
    return this.store.save(record);
  }

  async navigate(query: EvolutionNavigationQuery) {
    await this.assertOwnedRepository(
      query.ownerId, query.repositoryId, query.targetRevision);
    const records = await this.store.list(
      query.tenantId, query.ownerId, query.repositoryId);
    return navigateEvolutionHistory(records, query);
  }

  private async assertOwnership(input: CompareRepositoryRevisionsInput) {
    if (input.ownerId !== input.repositoryOwnerId) {
      throw new RepositoryEvolutionError(
        "repository_evolution_access_denied",
        "Repository ownership does not match the requesting user.");
    }
    await this.assertOwnedRepository(
      input.ownerId, input.repositoryId, input.targetRevision);
    if (input.baseRevision === input.targetRevision) {
      throw new RepositoryEvolutionError(
        "repository_evolution_revision_lineage_invalid",
        "Base and target revisions must differ.");
    }
  }

  private async assertOwnedRepository(
    ownerId: string, repositoryId: string, targetRevision?: string,
  ) {
    const repository = await this.dependencies.repositories
      .getRepository(repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        repository.ownerUserId !== ownerId) {
      throw new RepositoryEvolutionError(
        "repository_evolution_access_denied",
        "Repository is not owned by the requesting user.");
    }
    if (targetRevision &&
        (repository.currentRevision !== targetRevision ||
         repository.indexedRevision !== targetRevision)) {
      throw new RepositoryEvolutionError(
        "repository_evolution_revision_conflict",
        "Target revision is not the current indexed repository revision.");
    }
  }

  recover() { return this.store.recover(); }
  collect(tenantId: string, retainedRecords = 50) {
    return this.store.collect(tenantId, retainedRecords);
  }
  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  async verify() {
    await Promise.all([
      this.store.verify(), this.dependencies.auxiliary.verify(),
      this.dependencies.repositoryGraph.verify(),
      this.dependencies.repositoryIntelligence.verify(),
      this.dependencies.semantic.verify(), this.dependencies.features.verify(),
      this.dependencies.verifyAuxiliaryEngines(),
    ]);
  }
}

export const runtimeRepositoryEvolutionIntelligenceEngine =
  new RepositoryEvolutionIntelligenceEngine();
