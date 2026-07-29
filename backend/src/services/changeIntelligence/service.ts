import { runtimeMetrics } from "../../observability/metrics.js";
import { runtimeFeatureIntelligenceService } from "../featureIntelligence/service.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import { analyzeChange, deterministicChangeId } from "./engine.js";
import {
  runtimeChangeIntelligenceStore,
  type ChangeIntelligenceStore,
} from "./store.js";
import {
  ChangeIntelligenceError,
  type AnalyzeChangeInput,
} from "./types.js";

export class ChangeIntelligenceService {
  constructor(
    private readonly store: ChangeIntelligenceStore =
      runtimeChangeIntelligenceStore,
  ) {}

  async analyze(input: AnalyzeChangeInput) {
    const changeId = deterministicChangeId(input);
    const previous = await this.store.get(input.tenantId, input.ownerId, changeId);
    if (previous &&
        previous.request.repositoryRevision === input.repositoryRevision &&
        previous.repositoryIntelligenceVersion ===
          input.repositoryIntelligence.intelligenceVersion &&
        previous.semanticGraphVersion === input.semanticGraph.graphVersion &&
        previous.featureGraphVersion === input.featureGraph.graphVersion &&
        previous.lifecycle === "published") {
      await this.store.recordReuse(input.tenantId, input.ownerId, changeId);
      await this.recordMetrics();
      return previous;
    }
    const saved = await this.store.save(analyzeChange(input));
    await this.recordMetrics();
    return saved;
  }

  async analyzePublished(input: Omit<AnalyzeChangeInput,
    "repositoryIntelligence" | "semanticGraph" | "featureGraph">) {
    const [repositoryIntelligence, semanticGraph, featureGraph] =
      await Promise.all([
        runtimeRepositoryIntelligenceService.getPublishedSnapshot(
          input.repositoryId, input.repositoryRevision,
        ),
        runtimeSemanticCodeIntelligenceService.get(
          input.tenantId, input.ownerId, input.repositoryId,
          input.repositoryRevision,
        ),
        runtimeFeatureIntelligenceService.get(
          input.tenantId, input.ownerId, input.repositoryId,
          input.repositoryRevision,
        ),
      ]);
    if (!repositoryIntelligence || !semanticGraph || !featureGraph) {
      throw new ChangeIntelligenceError(
        "change_intelligence_dependency_unavailable",
        "Published repository, semantic, and feature intelligence are required.",
      );
    }
    return this.analyze({
      ...input, repositoryIntelligence, semanticGraph, featureGraph,
    });
  }

  get(tenantId: string, ownerId: string, changeId: string) {
    return this.store.get(tenantId, ownerId, changeId);
  }

  async recover() {
    const count = await this.store.recover();
    await this.recordMetrics();
    return count;
  }

  collect(tenantId: string, retainedAnalyses = 100) {
    return this.store.collect(tenantId, retainedAnalyses);
  }

  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  verify() { return this.store.verify(); }

  private async recordMetrics() {
    runtimeMetrics.recordChangeIntelligence(await this.store.metrics());
  }
}

export const runtimeChangeIntelligenceService = new ChangeIntelligenceService();
