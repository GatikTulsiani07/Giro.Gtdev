export const TOOL_FRAMEWORK_VERSION = "tool-invocation-v1";
export const TOOL_OUTPUT_VERSION = "tool-output-v1";

export type ToolCategory =
  | "Retrieval"
  | "Repository Graph"
  | "Repository Intelligence"
  | "Repository Planning"
  | "Execution"
  | "Sessions"
  | "Search"
  | "Diagnostics"
  | "Metrics";

export type ToolLifecycle =
  | "registered"
  | "loaded"
  | "ready"
  | "disabled"
  | "deprecated"
  | "failed";

export type ToolPermission =
  | "retrieval"
  | "graph_traversal"
  | "intelligence_lookup"
  | "planning"
  | "diagnostics"
  | "metrics";

export type ForbiddenToolCapability =
  | "shell_execution"
  | "git"
  | "repository_mutation"
  | "process_spawning"
  | "secrets"
  | "arbitrary_filesystem_writes"
  | "unrestricted_networking"
  | "arbitrary_code";

export interface ToolJsonSchema {
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly properties?: Readonly<Record<string, ToolJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: ToolJsonSchema;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ToolResourceLimits {
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly diagnosticsBytes: number;
  readonly resultItems: number;
  readonly traversalDepth: number;
}

export interface ToolDefinition {
  readonly toolId: string;
  readonly version: string;
  readonly capabilityHash: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
  readonly outputSchema: ToolJsonSchema;
  readonly requiredPermissions: readonly ToolPermission[];
  readonly forbiddenCapabilities: readonly ForbiddenToolCapability[];
  readonly timeoutMs: number;
  readonly resourceLimits: Readonly<ToolResourceLimits>;
  readonly lifecycle: ToolLifecycle;
}

export interface PublishedToolArtifact<T = unknown> {
  readonly version: string;
  readonly published: true;
  readonly payload: T;
}

export interface ToolExecutionContext {
  readonly tenantId: string;
  readonly repositorySnapshot: PublishedToolArtifact;
  readonly retrievalBundle: PublishedToolArtifact;
  readonly graph: PublishedToolArtifact;
  readonly intelligence: PublishedToolArtifact;
  readonly planning: PublishedToolArtifact;
  readonly executionMetadata: Readonly<{
    executionId: string;
    executionVersion: string;
    workUnitId: string;
    workUnitVersion: string;
    repositoryId: string;
    repositoryRevision: string;
    ownerId: string;
    leased: boolean;
    leaseOwnerId: string;
    leaseExpiresAt: string;
  }>;
  readonly runtimeMetadata: Readonly<{
    runtimeId: string;
    healthy: boolean;
    ownerId: string;
    allowedPermissions: readonly ToolPermission[];
  }>;
}

export interface ToolInvocationRequest {
  readonly idempotencyKey?: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly input: unknown;
  readonly timeoutMs?: number;
}

export type ToolInvocationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export type ToolFailureKind =
  | "validation"
  | "timeout"
  | "quota"
  | "permission"
  | "runtime"
  | "tool_unavailable"
  | "serialization";

export interface ToolFailure {
  readonly kind: ToolFailureKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ToolDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly level: "info" | "warning" | "error";
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ToolMetrics {
  readonly usage: number;
  readonly latencyMs: number;
  readonly timeouts: number;
  readonly failures: number;
  readonly retryCount: number;
  readonly payloadBytes: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly diagnosticGeneration: number;
}

export interface ToolStructuredOutput<T = unknown> {
  readonly version: string;
  readonly payload: T;
  readonly diagnostics: readonly ToolDiagnostic[];
  readonly metrics: Readonly<ToolMetrics>;
  readonly durationMs: number;
  readonly warnings: readonly string[];
}

export interface ToolInvocation {
  readonly invocationId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly executionVersion: string;
  readonly workUnitId: string;
  readonly workUnitVersion: string;
  readonly runtimeId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly inputHash: string;
  readonly timeoutMs: number;
  readonly timestamp: string;
  readonly status: ToolInvocationStatus;
  readonly outputHash: string | null;
  readonly durationMs: number | null;
  readonly diagnostics: readonly ToolDiagnostic[];
  readonly metrics: Readonly<ToolMetrics>;
  readonly retries: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly failure: ToolFailure | null;
}

export interface PersistedToolResult {
  readonly invocation: ToolInvocation;
  readonly output: ToolStructuredOutput | null;
  readonly replayed: boolean;
}

export interface ToolInvocationQuotas {
  readonly invocationsPerRuntime: number;
  readonly parallelInvocations: number;
  readonly durationMs: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly storedDiagnosticsBytes: number;
  readonly retries: number;
  readonly retentionCount: number;
}

export interface ToolInvocationIdentity {
  readonly invocationId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly executionVersion: string;
  readonly workUnitId: string;
  readonly workUnitVersion: string;
  readonly runtimeId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly inputHash: string;
  readonly timeoutMs: number;
  readonly timestamp: string;
}

export interface ToolHandlerResult {
  readonly payload: unknown;
  readonly diagnostics?: readonly Omit<ToolDiagnostic, "createdAt">[];
  readonly metrics?: Partial<ToolMetrics>;
  readonly warnings?: readonly string[];
}

export type InternalToolHandler = (
  input: unknown,
  context: ToolExecutionContext,
  signal: AbortSignal,
) => Promise<ToolHandlerResult> | ToolHandlerResult;

export interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: InternalToolHandler;
}

export class ToolInvocationError extends Error {
  constructor(readonly failure: ToolFailure) {
    super(failure.message);
    this.name = "ToolInvocationError";
  }

  get code(): string {
    return this.failure.code;
  }
}
