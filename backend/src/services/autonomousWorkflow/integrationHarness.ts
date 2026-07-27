import { stableHash } from "../repositoryExecution/determinism.js";
import {
  ExistingServicesWorkflowComposition,
  type WorkflowServiceComposition,
} from "./composition.js";
import {
  MemoryAutonomousWorkflowStore,
  type AutonomousWorkflowStore,
} from "./store.js";
import {
  AutonomousWorkflowOrchestrator,
  DEFAULT_WORKFLOW_QUOTAS,
} from "./service.js";
import {
  AutonomousWorkflowError,
  WORKFLOW_STAGES,
  type AutonomousWorkflow,
  type CreateWorkflowInput,
  type WorkflowDependencyRecovery,
  type WorkflowQuotas,
  type WorkflowStage,
  type WorkflowStageExecution,
} from "./types.js";

export const WORKFLOW_ENGINE_REGISTRY = Object.freeze([
  { stage: "intelligence", service: "repository-intelligence" },
  { stage: "planning", service: "repository-planning" },
  { stage: "execution", service: "repository-execution" },
  { stage: "agent_runtime", service: "agent-runtime" },
  { stage: "tool_invocation", service: "tool-invocation" },
  { stage: "collaboration", service: "multi-agent-collaboration" },
  { stage: "workspace", service: "repository-workspace" },
  { stage: "patch", service: "repository-patch" },
  { stage: "artifact", service: "repository-artifact" },
  { stage: "review", service: "repository-review" },
  { stage: "proposal", service: "repository-proposal" },
  { stage: "apply", service: "repository-apply-coordinator" },
  { stage: "knowledge", service: "repository-knowledge" },
] as const);

export interface WorkflowLineage {
  readonly stage: WorkflowStage;
  readonly referenceId: string;
  readonly referenceVersion: string;
  readonly outputHash: string;
}

export interface WorkflowHarnessStageContext {
  readonly workflow: AutonomousWorkflow;
  readonly stage: WorkflowStage;
  readonly previousOutput: unknown;
  readonly previousLineage: WorkflowLineage | null;
  readonly outputs: Readonly<Partial<Record<WorkflowStage, unknown>>>;
}

export interface WorkflowHarnessStageInput {
  readonly payload: unknown;
  readonly consumed: WorkflowLineage | null;
}

export interface WorkflowHarnessScenario {
  readonly create: CreateWorkflowInput;
  readonly stageInput: (
    context: WorkflowHarnessStageContext,
  ) => WorkflowHarnessStageInput | Promise<WorkflowHarnessStageInput>;
  readonly executionApproval: (
    workflow: AutonomousWorkflow,
    executionOutput: unknown,
  ) => unknown | Promise<unknown>;
  readonly failureInjection?: Readonly<Partial<Record<WorkflowStage, number>>>;
  readonly cancelAfterFailureAt?: WorkflowStage;
  readonly resumeAfterExhaustion?: boolean;
  readonly maxAttemptsPerStage?: number;
  readonly interruptOnceAt?: WorkflowStage;
  readonly onInterrupted?: () => void;
}

export interface WorkflowHarnessMetrics {
  readonly totalDurationMs: number;
  readonly stageDurationsMs: Readonly<Record<WorkflowStage, number>>;
  readonly retries: number;
  readonly recoveries: number;
  readonly diagnostics: number;
  readonly stageSuccessRate: Readonly<Record<WorkflowStage, number>>;
  readonly replayCount: number;
}

export interface WorkflowHarnessResult {
  readonly workflow: AutonomousWorkflow;
  readonly stageOrder: readonly WorkflowStage[];
  readonly outputs: Readonly<Partial<Record<WorkflowStage, unknown>>>;
  readonly lineage: Readonly<Partial<Record<WorkflowStage, WorkflowLineage>>>;
  readonly metrics: WorkflowHarnessMetrics;
}

export interface WorkflowReplayValidation {
  readonly valid: true;
  readonly replayCount: number;
  readonly deterministicHash: string;
}

class FailureInjectingComposition implements WorkflowServiceComposition {
  private readonly remaining: Map<WorkflowStage, number>;

  constructor(
    private readonly delegate: WorkflowServiceComposition,
    failures: Readonly<Partial<Record<WorkflowStage, number>>>,
  ) {
    this.remaining = new Map(WORKFLOW_STAGES.map((stage) => [
      stage, Math.max(0, failures[stage] ?? 0),
    ]));
  }

  execute(stage: WorkflowStage, payload: unknown):
  Promise<WorkflowStageExecution> {
    const remaining = this.remaining.get(stage) ?? 0;
    if (remaining > 0) {
      this.remaining.set(stage, remaining - 1);
      throw new AutonomousWorkflowError(
        "integration_harness_injected_failure",
        `Deterministic integration failure injected at ${stage}.`,
        { stage, remaining: remaining - 1 },
      );
    }
    return this.delegate.execute(stage, payload);
  }

  approve(payload: unknown): Promise<void> {
    return this.delegate.approve(payload);
  }

  cancel(payload?: unknown): Promise<void> {
    return this.delegate.cancel(payload);
  }

  recoverDependencies(): Promise<WorkflowDependencyRecovery> {
    return this.delegate.recoverDependencies();
  }
}

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, async flush() {},
};

function requireLineage(
  expected: WorkflowLineage | null,
  actual: WorkflowLineage | null,
  stage: WorkflowStage,
): void {
  if (stableHash(actual) !== stableHash(expected)) {
    throw new AutonomousWorkflowError(
      "integration_harness_lineage_mismatch",
      `${stage} did not consume the immediately preceding stage output.`,
      { stage },
    );
  }
}

function requireScope(
  workflow: AutonomousWorkflow,
  stage: WorkflowStage,
  output: unknown,
): void {
  if (!output || typeof output !== "object") return;
  const record = output as Record<string, unknown>;
  const nested = (record.workspace && typeof record.workspace === "object")
    ? record.workspace as Record<string, unknown> : record;
  const checks: Array<[string, string]> = [
    ["repositoryId", workflow.repositoryId],
    ["repositoryRevision", workflow.repositoryRevision],
    ["executionId", workflow.executionId],
  ];
  for (const [field, expected] of checks) {
    const actual = nested[field] ?? record[field];
    if (typeof actual === "string" && actual !== expected) {
      throw new AutonomousWorkflowError(
        "integration_harness_cross_engine_mismatch",
        `${stage} returned a mismatched ${field}.`,
        { stage, field, expected, actual },
      );
    }
  }
}

function metricsFor(
  workflow: AutonomousWorkflow,
  replayCount: number,
): WorkflowHarnessMetrics {
  const durations = Object.fromEntries(
    WORKFLOW_STAGES.map((stage) => [stage, 0]),
  ) as Record<WorkflowStage, number>;
  const successes = Object.fromEntries(
    WORKFLOW_STAGES.map((stage) => [stage, 0]),
  ) as Record<WorkflowStage, number>;
  for (const checkpoint of workflow.checkpoints) {
    durations[checkpoint.stage] += checkpoint.durationMs;
    successes[checkpoint.stage] += 1;
  }
  const attempts = Object.fromEntries(WORKFLOW_STAGES.map((stage) => [
    stage,
    workflow.attemptHistory.filter((event) =>
      event.stage === stage && event.event === "started").length,
  ])) as Record<WorkflowStage, number>;
  return Object.freeze({
    totalDurationMs: workflow.completedAt
      ? Math.max(0, Date.parse(workflow.completedAt) -
          Date.parse(workflow.createdAt))
      : 0,
    stageDurationsMs: Object.freeze(durations),
    retries: Object.values(workflow.retryCounts)
      .reduce((total, count) => total + count, 0),
    recoveries: workflow.recoveryCount,
    diagnostics: workflow.diagnostics.length,
    stageSuccessRate: Object.freeze(Object.fromEntries(
      WORKFLOW_STAGES.map((stage) => [
        stage, attempts[stage] === 0 ? 0 : successes[stage] / attempts[stage],
      ]),
    ) as Record<WorkflowStage, number>),
    replayCount,
  });
}

function replayProjection(result: WorkflowHarnessResult): unknown {
  return {
    workflowId: result.workflow.workflowId,
    stageOrder: result.stageOrder,
    lineage: Object.fromEntries(Object.entries(result.lineage).map(
      ([stage, value]) => [stage, value ? {
        stage: value.stage,
        referenceId: value.referenceId,
        referenceVersion: value.referenceVersion,
      } : value],
    )),
    diagnostics: result.workflow.diagnostics.map((diagnostic) => ({
      stage: diagnostic.stage,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      retryable: diagnostic.retryable,
    })),
    metrics: { ...result.metrics, replayCount: 0 },
    versions: result.workflow.versions.map((version) => ({
      workflowVersion: version.workflowVersion,
      lifecycle: version.lifecycle,
      currentStage: version.currentStage,
      checkpointCount: version.checkpointCount,
      retryCount: version.retryCount,
      failureCount: version.failureCount,
      recoveryCount: version.recoveryCount,
      reason: version.reason,
    })),
  };
}

export class EndToEndEngineeringWorkflowHarness {
  private replayCount = 0;
  private readonly orchestrator: AutonomousWorkflowOrchestrator;

  constructor(
    private readonly store: AutonomousWorkflowStore =
      new MemoryAutonomousWorkflowStore(),
    private readonly composition: WorkflowServiceComposition =
      new ExistingServicesWorkflowComposition(),
    private readonly quotas: WorkflowQuotas = DEFAULT_WORKFLOW_QUOTAS,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.orchestrator = new AutonomousWorkflowOrchestrator(
      store, composition, quotas, silentLogger, clock,
    );
  }

  async verifyStartup(): Promise<void> {
    const registered = WORKFLOW_ENGINE_REGISTRY.map(({ stage }) => stage);
    if (stableHash(registered) !== stableHash(WORKFLOW_STAGES) ||
        new Set(registered).size !== WORKFLOW_STAGES.length) {
      throw new AutonomousWorkflowError(
        "integration_harness_engine_discovery_failed",
        "The orchestrator engine registry is incomplete or unordered.",
      );
    }
    for (const entry of WORKFLOW_ENGINE_REGISTRY) {
      if (!entry.service.trim()) {
        throw new AutonomousWorkflowError(
          "integration_harness_engine_discovery_failed",
          `${entry.stage} has no discoverable service.`,
        );
      }
    }
    await this.store.verify(this.quotas);
  }

  async run(scenario: WorkflowHarnessScenario): Promise<WorkflowHarnessResult> {
    await this.verifyStartup();
    const injected = new FailureInjectingComposition(
      this.composition, scenario.failureInjection ?? {},
    );
    const orchestrator = new AutonomousWorkflowOrchestrator(
      this.store, injected, this.quotas, silentLogger, this.clock,
    );
    let workflow = await orchestrator.create(scenario.create);
    const outputs: Partial<Record<WorkflowStage, unknown>> = {};
    const lineage: Partial<Record<WorkflowStage, WorkflowLineage>> = {};
    let previousOutput: unknown;
    let previousLineage: WorkflowLineage | null = null;
    const maxAttempts = scenario.maxAttemptsPerStage ??
      this.quotas.retriesPerStage + this.quotas.resumesPerWorkflow + 2;
    const attempts = new Map<WorkflowStage, number>();
    let interruptionInjected = false;

    while (workflow.currentStage) {
      if (workflow.lifecycle === "awaiting_approval") {
        workflow = await orchestrator.approve({
          tenantId: workflow.tenantId,
          workflowId: workflow.workflowId,
          ownerId: workflow.ownerId,
          expectedWorkflowVersion: workflow.workflowVersion,
          idempotencyKey: `integration-approval-${workflow.workflowId}`,
          executionApproval: await scenario.executionApproval(
            workflow, outputs.execution,
          ),
        });
        continue;
      }
      const stage = workflow.currentStage;
      const count = (attempts.get(stage) ?? 0) + 1;
      attempts.set(stage, count);
      if (count > maxAttempts) {
        throw new AutonomousWorkflowError(
          "integration_harness_retry_exhausted",
          `Integration attempts exhausted at ${stage}.`,
        );
      }
      const request = await scenario.stageInput({
        workflow, stage, previousOutput, previousLineage,
        outputs: Object.freeze({ ...outputs }),
      });
      requireLineage(previousLineage, request.consumed, stage);
      if (!interruptionInjected && scenario.interruptOnceAt === stage) {
        await this.store.beginStage({
          tenantId: workflow.tenantId,
          workflowId: workflow.workflowId,
          ownerId: workflow.ownerId,
          expectedWorkflowVersion: workflow.workflowVersion,
          request: { stage, payload: request.payload },
        }, this.quotas, this.clock());
        interruptionInjected = true;
        scenario.onInterrupted?.();
        await orchestrator.recover();
        workflow = (await this.store.get(
          workflow.tenantId, workflow.workflowId, workflow.ownerId))!;
        continue;
      }
      try {
        const advanced = await orchestrator.advance({
          tenantId: workflow.tenantId,
          workflowId: workflow.workflowId,
          ownerId: workflow.ownerId,
          expectedWorkflowVersion: workflow.workflowVersion,
          request: { stage, payload: request.payload },
        });
        workflow = advanced.workflow;
        const checkpoint = workflow.checkpoints.at(-1)!;
        const currentLineage: WorkflowLineage = {
          stage,
          referenceId: checkpoint.result.referenceId,
          referenceVersion: checkpoint.result.referenceVersion,
          outputHash: checkpoint.result.outputHash,
        };
        requireScope(workflow, stage, advanced.output);
        outputs[stage] = advanced.output;
        lineage[stage] = currentLineage;
        previousOutput = advanced.output;
        previousLineage = currentLineage;
      } catch (error) {
        workflow = (await this.store.get(
          workflow.tenantId, workflow.workflowId, workflow.ownerId))!;
        if (workflow.inFlight) throw error;
        if (scenario.cancelAfterFailureAt === stage) {
          workflow = await orchestrator.cancel({
            tenantId: workflow.tenantId,
            workflowId: workflow.workflowId,
            ownerId: workflow.ownerId,
            expectedWorkflowVersion: workflow.workflowVersion,
            idempotencyKey: `integration-cancel-${workflow.workflowId}-${stage}`,
          });
          break;
        }
        if (workflow.lifecycle === "failed" &&
            scenario.resumeAfterExhaustion &&
            workflow.resumeCount < this.quotas.resumesPerWorkflow) {
          workflow = await orchestrator.resume({
            tenantId: workflow.tenantId,
            workflowId: workflow.workflowId,
            ownerId: workflow.ownerId,
            expectedWorkflowVersion: workflow.workflowVersion,
          });
          continue;
        }
        if (workflow.lifecycle !== "failed") continue;
        throw error;
      }
    }

    return Object.freeze({
      workflow,
      stageOrder: Object.freeze(workflow.checkpoints.map(({ stage }) => stage)),
      outputs: Object.freeze({ ...outputs }),
      lineage: Object.freeze({ ...lineage }),
      metrics: metricsFor(workflow, this.replayCount),
    });
  }

  recover(): Promise<{
    workflowRecovery: number;
    dependencyRecovery: WorkflowDependencyRecovery;
  }> {
    return this.orchestrator.recover();
  }

  validateReplay(
    baseline: WorkflowHarnessResult,
    replay: WorkflowHarnessResult,
  ): WorkflowReplayValidation {
    const baselineHash = stableHash(replayProjection(baseline));
    const replayHash = stableHash(replayProjection(replay));
    if (baselineHash !== replayHash) {
      throw new AutonomousWorkflowError(
        "integration_harness_replay_mismatch",
        "Completed workflow replay changed deterministic output.",
        { baselineHash, replayHash },
      );
    }
    this.replayCount += 1;
    return Object.freeze({
      valid: true,
      replayCount: this.replayCount,
      deterministicHash: replayHash,
    });
  }
}
