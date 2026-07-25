import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import { currentTraceContext, runWithChildSpan } from "../../observability/tracing.js";
import type { RepositoryWorkspaceStore } from "./store.js";
import { runtimeRepositoryWorkspaceStore } from "./store.js";
import type {
  CreateWorkspaceInput, GeneratePatchInput, WorkspaceClaim, WorkspaceLifecycle,
  WorkspaceQuotas,
} from "./types.js";

export const DEFAULT_WORKSPACE_QUOTAS: WorkspaceQuotas = Object.freeze({
  activePerOwner: 16, patchesPerWorkspace: 100,
  fileOperationsPerPatch: 250, symbolOperationsPerPatch: 500,
  patchBytes: 2 * 1024 * 1024, diagnosticsPerPatch: 250,
  leaseMs: 60_000, durationMs: 24 * 60 * 60 * 1000,
  archivedWorkspaces: 100, patchHistory: 100, retainedDiagnostics: 1_000,
});

export class RepositoryWorkspacePatchEngine {
  constructor(
    private readonly store: RepositoryWorkspaceStore = runtimeRepositoryWorkspaceStore,
    private readonly quotas: WorkspaceQuotas = DEFAULT_WORKSPACE_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async create(input: CreateWorkspaceInput) {
    return runWithChildSpan(async () => {
      const workspace = await this.store.create(input, this.quotas);
      this.log("repository_workspace.created", workspace.workspaceId, {
        repositoryId: workspace.repositoryId,
        repositoryRevision: workspace.repositoryRevision,
        executionId: workspace.executionId, workUnitId: workspace.workUnitId,
        snapshotVersion: workspace.snapshotVersion,
      });
      await this.recordMetrics();
      return workspace;
    });
  }
  get(tenantId: string, workspaceId: string) { return this.store.get(tenantId, workspaceId); }
  prepare(tenantId: string, workspaceId: string, ownerId: string) {
    return this.store.prepare(tenantId, workspaceId, ownerId);
  }
  markReady(tenantId: string, workspaceId: string, ownerId: string) {
    return this.store.markReady(tenantId, workspaceId, ownerId);
  }
  claim(tenantId: string, workspaceId: string, ownerId: string) {
    return this.store.claim(tenantId, workspaceId, ownerId, this.quotas.leaseMs);
  }
  activate(claim: WorkspaceClaim) { return this.store.activate(claim); }
  beginValidation(claim: WorkspaceClaim) { return this.store.beginValidation(claim); }
  heartbeat(claim: WorkspaceClaim) {
    return this.store.heartbeat(claim, this.quotas.leaseMs);
  }
  async generatePatch(input: GeneratePatchInput) {
    return runWithChildSpan(async () => {
      const patch = await this.store.generatePatch(input, this.quotas);
      this.log("repository_patch.generated", patch.workspaceId, {
        patchId: patch.patchId, patchVersion: patch.patchVersion,
        fileOperationCount: patch.fileOperations.length,
        symbolOperationCount: patch.symbolOperations.length,
        diagnosticCount: patch.diagnostics.length, confidence: patch.confidence,
      });
      await this.recordMetrics();
      return patch;
    });
  }
  transition(
    tenantId: string, workspaceId: string, ownerId: string,
    lifecycle: Extract<WorkspaceLifecycle, "archived" | "failed" | "cancelled">,
  ) {
    return this.store.transition(
      tenantId, workspaceId, ownerId, lifecycle, this.quotas,
    );
  }
  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    this.log("repository_workspace.recovered", null, { recoveryCount: count });
    await this.recordMetrics();
    return count;
  }
  collect(tenantId: string) { return this.store.collect(tenantId, this.quotas); }
  metrics(tenantId?: string) { return this.store.metrics(tenantId); }
  verify() { return this.store.verify(); }

  private async recordMetrics(): Promise<void> {
    runtimeMetrics.recordRepositoryWorkspace(await this.store.metrics());
  }
  private log(
    operation: string, workspaceId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId, spanId: trace?.spanId, workspaceId, ...fields,
    });
  }
}

export const runtimeRepositoryWorkspacePatchEngine =
  new RepositoryWorkspacePatchEngine();
