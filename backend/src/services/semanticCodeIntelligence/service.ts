import { runtimeMetrics } from "../../observability/metrics.js";
import { SemanticAdapterRegistry } from "./adapter.js";
import { buildSemanticGraph, SemanticNavigator } from "./engine.js";
import {
  runtimeSemanticCodeIntelligenceStore,
  type SemanticCodeIntelligenceStore,
} from "./store.js";
import type { BuildSemanticGraphInput } from "./types.js";
import { verifySemanticAdapters } from "./validation.js";

export class SemanticCodeIntelligenceService {
  constructor(
    private readonly store: SemanticCodeIntelligenceStore =
      runtimeSemanticCodeIntelligenceStore,
    private readonly adapters = new SemanticAdapterRegistry(),
  ) {}

  async index(input: BuildSemanticGraphInput) {
    const graph = buildSemanticGraph(input, this.adapters);
    const saved = await this.store.save(graph);
    await this.recordMetrics();
    return saved;
  }

  get(
    tenantId: string, ownerId: string, repositoryId: string, repositoryRevision: string,
  ) {
    return this.store.get(tenantId, ownerId, repositoryId, repositoryRevision);
  }

  async navigate(
    tenantId: string, ownerId: string, repositoryId: string,
    repositoryRevision: string,
  ) {
    const graph = await this.get(
      tenantId, ownerId, repositoryId, repositoryRevision,
    );
    return graph ? new SemanticNavigator(graph) : null;
  }

  async recover() {
    const count = await this.store.recover();
    await this.recordMetrics();
    return count;
  }

  collect(tenantId: string, retainedVersions = 10) {
    return this.store.collect(tenantId, retainedVersions);
  }

  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }

  async verify() {
    verifySemanticAdapters(this.adapters);
    await this.store.verify();
  }

  private async recordMetrics() {
    runtimeMetrics.recordSemanticCodeIntelligence(await this.store.metrics());
  }
}

export const runtimeSemanticCodeIntelligenceService =
  new SemanticCodeIntelligenceService();
