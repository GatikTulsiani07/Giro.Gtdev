import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  currentTraceContext,
  runWithChildSpan,
} from "../../observability/tracing.js";
import type { RepositoryKnowledgeStore } from "./store.js";
import { runtimeRepositoryKnowledgeStore } from "./store.js";
import type {
  CreateKnowledgeInput,
  KnowledgeQuotas,
  RememberKnowledgeInput,
  RetrieveKnowledgeQuery,
} from "./types.js";

export const DEFAULT_KNOWLEDGE_QUOTAS: KnowledgeQuotas = Object.freeze({
  entriesPerRepository: 10_000,
  versionsPerEntry: 100,
  factsPerVersion: 5_000,
  sourcesPerVersion: 1_000,
  diagnosticsPerVersion: 1_000,
  contentBytes: 8 * 1024 * 1024,
  memoriesPerRepository: 100_000,
  retainedEntries: 10_000,
  retainedVersions: 100,
  retainedMemories: 100_000,
  writeTimeoutMs: 5 * 60 * 1_000,
});

export class RepositoryKnowledgeEngine {
  constructor(
    private readonly store: RepositoryKnowledgeStore =
      runtimeRepositoryKnowledgeStore,
    private readonly quotas: KnowledgeQuotas = DEFAULT_KNOWLEDGE_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async create(input: CreateKnowledgeInput) {
    return runWithChildSpan(async () => {
      const entry = await this.store.create(input, this.quotas);
      this.log("repository_knowledge.created", entry.knowledgeId, {
        repositoryId: entry.repositoryId,
        repositoryRevision: entry.repositoryRevision,
        namespace: entry.namespace,
        version: entry.version,
      });
      await this.recordMetrics();
      return entry;
    });
  }

  get(tenantId: string, knowledgeId: string, ownerId: string) {
    return this.store.get(tenantId, knowledgeId, ownerId);
  }

  async retrieve(query: RetrieveKnowledgeQuery) {
    const results = await this.store.retrieve(query);
    await this.recordMetrics();
    return results;
  }

  async remember(input: RememberKnowledgeInput) {
    const record = await this.store.remember(input, this.quotas);
    await this.recordMetrics();
    return record;
  }

  listMemories(tenantId: string, repositoryId: string, ownerId: string) {
    return this.store.listMemories(tenantId, repositoryId, ownerId);
  }

  archive(
    tenantId: string,
    knowledgeId: string,
    ownerId: string,
    expectedVersion: number,
  ) {
    return this.store.archive(
      tenantId, knowledgeId, ownerId, expectedVersion);
  }

  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    this.log("repository_knowledge.recovered", null, {
      recoveryCount: count,
    });
    await this.recordMetrics();
    return count;
  }

  collect(tenantId: string) {
    return this.store.collect(tenantId, this.quotas);
  }

  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }

  verify() {
    return this.store.verify(this.quotas);
  }

  private async recordMetrics(): Promise<void> {
    runtimeMetrics.recordRepositoryKnowledge(await this.store.metrics());
  }

  private log(
    operation: string,
    knowledgeId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      knowledgeId,
      ...fields,
    });
  }
}

export const runtimeRepositoryKnowledgeEngine =
  new RepositoryKnowledgeEngine();
