import type {
  AgentRuntimeClaim,
  AgentRuntimeStore,
} from "./store.js";
import type {
  AgentExecutionContext,
  AgentRuntimeQuotas,
  AgentStructuredOutput,
} from "./types.js";

export type DeterministicReasoner = (
  context: AgentExecutionContext,
) => Promise<AgentStructuredOutput>;

export class AgentRuntimeExecutor {
  constructor(
    private readonly store: AgentRuntimeStore,
    private readonly reasoner: DeterministicReasoner,
    private readonly structuredLogger: StructuredLogger = logger,
  ) {}

  async execute(
    claim: AgentRuntimeClaim,
    context: AgentExecutionContext,
    quotas: AgentRuntimeQuotas,
  ): Promise<void> {
    return runWithChildSpan(async () => {
      const trace = currentTraceContext();
      this.structuredLogger.info("agent_runtime.execute.started", {
        traceId: trace?.traceId,
        spanId: trace?.spanId,
        runtimeId: claim.runtimeId,
        executionVersion: claim.executionVersion,
        workUnitVersion: claim.workUnitVersion,
        workerId: claim.workerId,
      });
      await this.store.transition(claim, "running");
      try {
        const output = await this.reasoner(context);
        const published = await this.store.publish(claim, output, quotas);
        this.structuredLogger.info("agent_runtime.execute.completed", {
          runtimeId: claim.runtimeId,
          outputId: published.outputId,
          outputVersion: published.outputVersion,
        });
      } catch (error) {
        const code = error instanceof Error && error.name === "TimeoutError"
          ? "runtime_timeout" as const
          : "transient_runtime_failure" as const;
        await this.store.fail(claim, code, error instanceof Error ? error.message : "Runtime failed.", quotas);
        this.structuredLogger.error("agent_runtime.execute.failed", {
          runtimeId: claim.runtimeId,
          failureCode: code,
          error,
        });
      }
    });
  }
}
import { logger, type StructuredLogger } from "../../lib/logger.js";
import { currentTraceContext, runWithChildSpan } from "../../observability/tracing.js";
