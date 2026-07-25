import { Buffer } from "node:buffer";

import type { ToolRegistry } from "./registry.js";
import { runtimeToolRegistry } from "./registry.js";
import type { ToolInvocationStore } from "./store.js";
import { runtimeToolInvocationStore } from "./store.js";
import type {
  PersistedToolResult,
  ToolDiagnostic,
  ToolExecutionContext,
  ToolFailure,
  ToolHandlerResult,
  ToolInvocationQuotas,
  ToolInvocationRequest,
  ToolMetrics,
  ToolStructuredOutput,
} from "./types.js";
import { ToolInvocationError } from "./types.js";
import {
  EMPTY_TOOL_METRICS,
  createInvocationIdentity,
  immutableToolClone,
  toolFailure,
  validateExecutionContext,
  validateToolOutput,
} from "./validation.js";

export const DEFAULT_TOOL_INVOCATION_QUOTAS: ToolInvocationQuotas = Object.freeze({
  invocationsPerRuntime: 100,
  parallelInvocations: 4,
  durationMs: 30_000,
  inputBytes: 64 * 1024,
  outputBytes: 1024 * 1024,
  storedDiagnosticsBytes: 64 * 1024,
  retries: 2,
  retentionCount: 1_000,
});

function normalizeFailure(error: unknown): ToolFailure {
  if (error instanceof ToolInvocationError) return error.failure;
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      kind: "timeout",
      code: "tool_timeout",
      message: "Tool invocation timed out.",
      retryable: true,
      details: {},
    };
  }
  if (error instanceof TypeError &&
      /circular|serialize|clone|json/iu.test(error.message)) {
    return {
      kind: "serialization",
      code: "tool_serialization_failed",
      message: "Tool input or output could not be serialized.",
      retryable: false,
      details: {},
    };
  }
  return {
    kind: "runtime",
    code: "tool_runtime_failed",
    message: error instanceof Error ? error.message : "Tool invocation failed.",
    retryable: true,
    details: {},
  };
}

async function executeWithTimeout(
  handler: () => Promise<ToolHandlerResult>,
  timeoutMs: number,
  controller: AbortController,
): Promise<ToolHandlerResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Tool invocation timed out.", "AbortError"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([handler(), expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class ToolInvocationService {
  constructor(
    private readonly store: ToolInvocationStore = runtimeToolInvocationStore,
    private readonly registry: ToolRegistry = runtimeToolRegistry,
    private readonly quotas: ToolInvocationQuotas = DEFAULT_TOOL_INVOCATION_QUOTAS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async invoke(
    request: ToolInvocationRequest,
    executionContext: ToolExecutionContext,
  ): Promise<PersistedToolResult> {
    const startedAt = this.clock();
    if (!request.toolId?.trim() || !request.toolVersion?.trim()) {
      throw toolFailure("validation", "invalid_tool_request", "Tool identity is required.");
    }
    const registered = this.registry.resolveReady(request.toolId, request.toolVersion);
    const context = validateExecutionContext(registered.definition, executionContext, startedAt);
    let identity;
    try {
      identity = createInvocationIdentity(request, registered.definition, context, this.quotas, startedAt);
    } catch (error) {
      if (error instanceof ToolInvocationError) throw error;
      throw toolFailure("serialization", "tool_input_serialization_failed",
        "Tool input could not be serialized.");
    }
    const began = await this.store.begin(identity, this.quotas);
    if (began.state === "replay") {
      return immutableToolClone({ ...began.result, replayed: true });
    }

    let retries = 0;
    let failure: ToolFailure | null = null;
    while (retries <= this.quotas.retries) {
      const controller = new AbortController();
      try {
        const elapsedMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
        const remainingMs = Math.min(identity.timeoutMs, this.quotas.durationMs - elapsedMs);
        if (remainingMs <= 0) {
          throw toolFailure("timeout", "tool_duration_quota_exceeded",
            "Tool invocation exceeded its total duration quota.", true);
        }
        const result = await executeWithTimeout(
          async () => registered.handler(request.input, context, controller.signal),
          remainingMs,
          controller,
        );
        const durationMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
        if (durationMs > this.quotas.durationMs) {
          throw toolFailure("timeout", "tool_duration_quota_exceeded",
            "Tool invocation exceeded its total duration quota.", true);
        }
        const diagnostics: ToolDiagnostic[] = (result.diagnostics ?? []).map((diagnostic) => ({
          ...diagnostic,
          createdAt: new Date(startedAt.getTime() + durationMs).toISOString(),
        }));
        const payloadBytes = Buffer.byteLength(JSON.stringify(result.payload));
        const metrics: ToolMetrics = {
          ...EMPTY_TOOL_METRICS,
          usage: 1,
          latencyMs: durationMs,
          retryCount: retries,
          payloadBytes,
          cacheMisses: 1,
          diagnosticGeneration: diagnostics.length,
          ...result.metrics,
        };
        const output: ToolStructuredOutput = immutableToolClone({
          version: registered.definition.version,
          payload: result.payload,
          diagnostics,
          metrics,
          durationMs,
          warnings: [...(result.warnings ?? [])],
        });
        validateToolOutput(registered.definition, output, this.quotas);
        return this.store.complete(context.tenantId, identity.invocationId, output, durationMs);
      } catch (error) {
        failure = normalizeFailure(error);
        if (!failure.retryable || retries >= this.quotas.retries) break;
        retries += 1;
      }
    }

    const durationMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
    const finalFailure = failure ?? {
      kind: "runtime" as const,
      code: "tool_runtime_failed",
      message: "Tool invocation failed.",
      retryable: false,
      details: {},
    };
    const diagnostic: ToolDiagnostic = {
      code: finalFailure.code,
      message: finalFailure.message,
      level: "error",
      details: finalFailure.details,
      createdAt: new Date(startedAt.getTime() + durationMs).toISOString(),
    };
    const metrics: ToolMetrics = {
      ...EMPTY_TOOL_METRICS,
      usage: 1,
      latencyMs: durationMs,
      timeouts: finalFailure.kind === "timeout" ? 1 : 0,
      failures: 1,
      retryCount: retries,
      cacheMisses: 1,
      diagnosticGeneration: 1,
    };
    return this.store.fail(
      context.tenantId,
      identity.invocationId,
      finalFailure,
      [diagnostic],
      metrics,
      durationMs,
      retries,
    );
  }

  get(tenantId: string, invocationId: string): Promise<PersistedToolResult | null> {
    return this.store.get(tenantId, invocationId);
  }

  metrics(tenantId?: string): Promise<ToolMetrics> {
    return this.store.metrics(tenantId);
  }

  recover(now?: Date): Promise<number> {
    return this.store.recover(now);
  }

  collect(tenantId: string): Promise<number> {
    return this.store.collect(tenantId, this.quotas.retentionCount);
  }

  verify(): Promise<void> {
    return this.store.verify(this.registry);
  }
}

export const runtimeToolInvocationService = new ToolInvocationService();
