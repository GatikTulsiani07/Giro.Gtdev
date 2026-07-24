import { Buffer } from "node:buffer";
import type {
  AgentExecutionContext,
  AgentStructuredOutput,
  RegisteredAgent,
} from "./types.js";
import { AgentRuntimeError } from "./types.js";

export function immutableClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
}

export function validateExecutionContext(
  context: AgentExecutionContext,
  agent: RegisteredAgent,
): AgentExecutionContext {
  const published = [
    context.repositorySnapshot,
    context.retrievalBundle,
    context.graphExpansion,
    context.intelligenceSnapshot,
  ];
  if (!context.tenantId.trim() || !context.executionId.trim() || !context.executionVersion.trim() ||
      !context.workUnitId.trim() || !context.workUnitVersion.trim() || !context.repositoryId.trim()) {
    throw new AgentRuntimeError("invalid_execution_context", "Execution context identity is incomplete.");
  }
  if (published.some((artifact) => artifact.published !== true || !artifact.version.trim())) {
    throw new AgentRuntimeError("unpublished_artifact", "Only published repository artifacts may enter a runtime.");
  }
  if (!context.policy.planningOnly || context.policy.repositoryMutation ||
      agent.capability.allowed.some((item) => !context.policy.allowed.includes(item)) ||
      agent.capability.forbidden.some((item) => !context.policy.forbidden.includes(item))) {
    throw new AgentRuntimeError("invalid_capability", "Execution policy does not enforce the capability boundary.");
  }
  return immutableClone(context);
}

const stringArrays: ReadonlyArray<keyof AgentStructuredOutput> = [
  "reasoning",
  "findings",
  "risks",
  "assumptions",
  "proposedFiles",
  "proposedSymbols",
  "validation",
  "tests",
];

export function validateStructuredOutput(
  output: AgentStructuredOutput,
  maxBytes: number,
): number {
  if (!output || typeof output !== "object" || typeof output.summary !== "string" ||
      !output.summary.trim() || typeof output.confidence !== "number" ||
      !Number.isFinite(output.confidence) || output.confidence < 0 || output.confidence > 1 ||
      stringArrays.some((field) => !Array.isArray(output[field]) ||
        (output[field] as readonly unknown[]).some((value) => typeof value !== "string"))) {
    throw new AgentRuntimeError("output_validation_failed", "Malformed structured agent output.");
  }
  const bytes = Buffer.byteLength(JSON.stringify(output));
  if (bytes > maxBytes) {
    throw new AgentRuntimeError("output_quota_exceeded", "Agent output exceeds the configured size limit.", {
      limit: maxBytes,
      bytes,
    });
  }
  return bytes;
}

export function isRetryableFailure(code: string): boolean {
  return code === "transient_runtime_failure" || code === "runtime_timeout" || code === "lease_expired";
}
