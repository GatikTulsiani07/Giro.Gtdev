import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import { currentTraceContext, runWithChildSpan } from "../../observability/tracing.js";
import type { RepositoryArtifactStore } from "./store.js";
import { runtimeRepositoryArtifactStore } from "./store.js";
import type {
  ArtifactQuotas,
  GenerateArtifactInput,
  ReviewArtifactInput,
} from "./types.js";

export const DEFAULT_ARTIFACT_QUOTAS: ArtifactQuotas = Object.freeze({
  artifactsPerWorkspace: 32,
  versionsPerArtifact: 100,
  artifactBytes: 2 * 1024 * 1024,
  operationsPerArtifact: 1_000,
  diagnosticsPerArtifact: 500,
  retainedArtifacts: 100,
  retainedVersions: 100,
  retainedDiagnostics: 1_000,
  generationTimeoutMs: 5 * 60 * 1_000,
  artifactTtlMs: 30 * 24 * 60 * 60 * 1_000,
});

export class RepositoryArtifactEngine {
  constructor(
    private readonly store: RepositoryArtifactStore =
      runtimeRepositoryArtifactStore,
    private readonly quotas: ArtifactQuotas = DEFAULT_ARTIFACT_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async generate(input: GenerateArtifactInput) {
    return runWithChildSpan(async () => {
      const artifact = await this.store.generate(input, this.quotas);
      this.log("repository_artifact.generated", artifact.artifactId, {
        workspaceId: artifact.workspaceId,
        executionId: artifact.executionId,
        workUnitId: artifact.workUnitId,
        artifactType: artifact.artifactType,
        artifactVersion: artifact.artifactVersion,
      });
      await this.recordMetrics();
      return artifact;
    });
  }

  get(tenantId: string, artifactId: string, ownerId: string) {
    return this.store.get(tenantId, artifactId, ownerId);
  }

  async review(input: ReviewArtifactInput) {
    const artifact = await this.store.review(input);
    await this.recordMetrics();
    return artifact;
  }

  archive(
    tenantId: string,
    artifactId: string,
    ownerId: string,
    expectedVersion: number,
  ) {
    return this.store.archive(
      tenantId, artifactId, ownerId, expectedVersion,
    );
  }

  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    this.log("repository_artifact.recovered", null, { recoveryCount: count });
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
    runtimeMetrics.recordRepositoryArtifact(await this.store.metrics());
  }

  private log(
    operation: string,
    artifactId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      artifactId,
      ...fields,
    });
  }
}

export const runtimeRepositoryArtifactEngine = new RepositoryArtifactEngine();
