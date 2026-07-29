import { runtimeMetrics } from "../../observability/metrics.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import {
  buildFeatureGraph,
  FeatureNavigator,
} from "./engine.js";
import {
  runtimeFeatureIntelligenceStore,
  type FeatureIntelligenceStore,
} from "./store.js";
import type { BuildFeatureGraphInput } from "./types.js";
import { FeatureIntelligenceError } from "./types.js";

export class FeatureIntelligenceService {
  constructor(
    private readonly store: FeatureIntelligenceStore =
      runtimeFeatureIntelligenceStore,
  ) {}

  async index(input: BuildFeatureGraphInput) {
    const saved = await this.store.save(buildFeatureGraph(input));
    await this.recordMetrics();
    return saved;
  }

  async indexPublished(input: Omit<
    BuildFeatureGraphInput,
    "repositoryIntelligence" | "semanticGraph"
  >) {
    const [repositoryIntelligence, semanticGraph] = await Promise.all([
      runtimeRepositoryIntelligenceService.getPublishedSnapshot(
        input.repositoryId, input.repositoryRevision,
      ),
      runtimeSemanticCodeIntelligenceService.get(
        input.tenantId, input.ownerId, input.repositoryId,
        input.repositoryRevision,
      ),
    ]);
    if (!repositoryIntelligence || !semanticGraph) {
      throw new FeatureIntelligenceError(
        "feature_intelligence_dependency_unavailable",
        "Published repository and semantic intelligence are required.",
      );
    }
    return this.index({ ...input, repositoryIntelligence, semanticGraph });
  }

  get(
    tenantId: string, ownerId: string, repositoryId: string, revision: string,
  ) {
    return this.store.get(tenantId, ownerId, repositoryId, revision);
  }

  async navigate(
    tenantId: string, ownerId: string, repositoryId: string, revision: string,
  ) {
    const graph = await this.get(tenantId, ownerId, repositoryId, revision);
    return graph ? new FeatureNavigator(graph) : null;
  }

  async recover() {
    const count = await this.store.recover();
    await this.recordMetrics();
    return count;
  }

  collect(tenantId: string, retainedVersions = 10) {
    return this.store.collect(tenantId, retainedVersions);
  }

  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  verify() { return this.store.verify(); }

  private async recordMetrics() {
    runtimeMetrics.recordFeatureIntelligence(await this.store.metrics());
  }
}

export const runtimeFeatureIntelligenceService =
  new FeatureIntelligenceService();
