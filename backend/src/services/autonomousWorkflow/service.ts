import { logger, type StructuredLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  currentTraceContext,
  runWithChildSpan,
} from "../../observability/tracing.js";
import type { WorkflowServiceComposition } from "./composition.js";
import { runtimeWorkflowServiceComposition } from "./composition.js";
import type { AutonomousWorkflowStore } from "./store.js";
import { runtimeAutonomousWorkflowStore } from "./store.js";
import {
  AutonomousWorkflowError,
  type AdvanceWorkflowInput,
  type ApproveWorkflowInput,
  type CancelWorkflowInput,
  type CreateWorkflowInput,
  type ResumeWorkflowInput,
  type WorkflowQuotas,
} from "./types.js";

export const DEFAULT_WORKFLOW_QUOTAS: WorkflowQuotas = Object.freeze({
  activePerOwner: 20,
  retriesPerStage: 3,
  resumesPerWorkflow: 3,
  diagnosticsPerWorkflow: 1_000,
  requestBytes: 16 * 1024 * 1024,
  stageLeaseMs: 5 * 60 * 1_000,
  workflowDurationMs: 30 * 24 * 60 * 60 * 1_000,
  retainedWorkflows: 1_000,
  retainedVersions: 1_000,
  retainedDiagnostics: 1_000,
});

function normalizedFailure(error: unknown): {
  code: string; message: string;
} {
  if (error && typeof error === "object" &&
      "code" in error && typeof error.code === "string") {
    return {
      code: error.code,
      message: error instanceof Error
        ? error.message : "Existing service rejected the workflow stage.",
    };
  }
  return {
    code: "autonomous_workflow_stage_failed",
    message: error instanceof Error
      ? error.message : "Existing service rejected the workflow stage.",
  };
}

export class AutonomousWorkflowOrchestrator {
  constructor(
    private readonly store: AutonomousWorkflowStore =
      runtimeAutonomousWorkflowStore,
    private readonly composition: WorkflowServiceComposition =
      runtimeWorkflowServiceComposition,
    private readonly quotas: WorkflowQuotas = DEFAULT_WORKFLOW_QUOTAS,
    private readonly structuredLogger: StructuredLogger = logger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: CreateWorkflowInput) {
    const workflow = await this.store.create(
      input, this.quotas, this.clock());
    this.log("autonomous_workflow.created", workflow.workflowId, {
      repositoryId: workflow.repositoryId,
      executionId: workflow.executionId,
      workflowVersion: workflow.workflowVersion,
    });
    await this.recordMetrics();
    return workflow;
  }

  get(tenantId: string, workflowId: string, ownerId: string) {
    return this.store.get(tenantId, workflowId, ownerId);
  }

  list(tenantId: string, ownerId: string) {
    if (!this.store.list) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_query_unavailable",
        "Workflow listing is unavailable.",
      );
    }
    return this.store.list(tenantId, ownerId);
  }

  async advance(input: AdvanceWorkflowInput) {
    return runWithChildSpan(async () => {
      const begun = await this.store.beginStage(
        input, this.quotas, this.clock());
      let execution;
      try {
        execution = await this.composition.execute(
          input.request.stage, input.request.payload);
      } catch (error) {
        const failure = normalizedFailure(error);
        await this.store.failStage(
          input.tenantId,
          input.workflowId,
          input.ownerId,
          begun.workflowVersion,
          failure.code,
          failure.message,
          this.quotas,
          this.clock(),
        );
        await this.recordMetrics();
        throw new AutonomousWorkflowError(
          "autonomous_workflow_stage_failed",
          "Existing service rejected the workflow stage.", {
            stage: input.request.stage,
            causeCode: failure.code,
          });
      }
      const workflow = await this.store.completeStage(
        input.tenantId,
        input.workflowId,
        input.ownerId,
        begun.workflowVersion,
        execution.result,
        this.clock(),
      );
      this.log("autonomous_workflow.stage_completed", workflow.workflowId, {
        stage: input.request.stage,
        workflowVersion: workflow.workflowVersion,
        lifecycle: workflow.lifecycle,
        referenceId: execution.result.referenceId,
      });
      await this.recordMetrics();
      return { workflow, output: execution.output };
    });
  }

  async approve(input: ApproveWorkflowInput) {
    const workflow = await this.store.get(
      input.tenantId, input.workflowId, input.ownerId);
    if (!workflow ||
        workflow.workflowVersion !== input.expectedWorkflowVersion ||
        workflow.lifecycle !== "awaiting_approval") {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_approval_conflict",
        "Workflow is not awaiting this approval.");
    }
    const executionCheckpoint = workflow.checkpoints.find((checkpoint) =>
      checkpoint.stage === "execution");
    if (!executionCheckpoint) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_approval_conflict",
        "Workflow execution checkpoint is unavailable.");
    }
    await this.composition.approve(input.executionApproval);
    const approved = await this.store.approve(
      input, executionCheckpoint.result.referenceId, this.clock());
    await this.recordMetrics();
    return approved;
  }

  async cancel(input: CancelWorkflowInput) {
    const workflow = await this.store.get(
      input.tenantId, input.workflowId, input.ownerId);
    if (!workflow ||
        workflow.workflowVersion !== input.expectedWorkflowVersion ||
        workflow.lifecycle === "completed") {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_cancellation_conflict",
        "Workflow cannot be cancelled from its current version.");
    }
    await this.composition.cancel(input.executionCancellation);
    const cancelled = await this.store.cancel(input, this.clock());
    await this.recordMetrics();
    return cancelled;
  }

  async resume(input: ResumeWorkflowInput) {
    const workflow = await this.store.resume(
      input, this.quotas, this.clock());
    await this.recordMetrics();
    return workflow;
  }

  retry(input: ResumeWorkflowInput) {
    return this.resume(input);
  }

  async replay(tenantId: string, workflowId: string, ownerId: string) {
    const workflow = await this.store.get(tenantId, workflowId, ownerId);
    if (!workflow) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_not_found", "Workflow was not found.");
    }
    if (workflow.lifecycle !== "completed") {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_replay_conflict",
        "Only completed workflows can be replayed.");
    }
    return workflow;
  }

  async recover() {
    const dependencyRecovery = await this.composition.recoverDependencies();
    const workflowRecovery =
      await this.store.recover(this.clock(), this.quotas);
    this.log("autonomous_workflow.recovered", null, {
      workflowRecovery,
      dependencyRecovery,
    });
    await this.recordMetrics();
    return { workflowRecovery, dependencyRecovery };
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
    runtimeMetrics.recordAutonomousWorkflows(await this.store.metrics());
  }

  private log(
    operation: string,
    workflowId: string | null,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const trace = currentTraceContext();
    this.structuredLogger.info(operation, {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      workflowId,
      ...fields,
    });
  }
}

export const runtimeAutonomousWorkflowOrchestrator =
  new AutonomousWorkflowOrchestrator();
