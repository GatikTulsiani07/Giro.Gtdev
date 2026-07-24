export const AGENT_RUNTIME_VERSION = "agent-runtime-v1";
export const AGENT_OUTPUT_SCHEMA_VERSION = "agent-output-v1";

export type AgentRuntimeStatus =
  | "idle"
  | "starting"
  | "ready"
  | "leased"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "unhealthy";

export type AgentKind =
  | "planner"
  | "backend-engineer"
  | "frontend-engineer"
  | "devops"
  | "reviewer"
  | "documentation"
  | "test-engineer"
  | "refactoring"
  | "security"
  | "architecture";

export type AllowedCapability =
  | "reasoning"
  | "retrieval"
  | "repository_graph"
  | "repository_intelligence"
  | "repository_planning";

export type ForbiddenCapability =
  | "shell"
  | "filesystem_mutation"
  | "git"
  | "network"
  | "secrets"
  | "process_execution";

export interface AgentLimits {
  runtimeDurationMs: number;
  retries: number;
  outputBytes: number;
  concurrentWorkUnits: number;
}

export interface AgentCapability {
  capabilityVersion: string;
  capabilityHash: string;
  deterministic: true;
  allowed: readonly AllowedCapability[];
  forbidden: readonly ForbiddenCapability[];
}

export interface RegisteredAgent {
  agentId: AgentKind;
  name: string;
  version: string;
  capability: AgentCapability;
  supportedWork: readonly string[];
  supportedRepositories: readonly string[];
  supportedLanguages: readonly string[];
  limits: Readonly<AgentLimits>;
}

export interface PublishedArtifact<T = unknown> {
  version: string;
  published: true;
  payload: T;
}

export interface AgentExecutionContext {
  tenantId: string;
  executionId: string;
  executionVersion: string;
  workUnitId: string;
  workUnitVersion: string;
  repositoryId: string;
  repositorySnapshot: PublishedArtifact;
  retrievalBundle: PublishedArtifact;
  graphExpansion: PublishedArtifact;
  intelligenceSnapshot: PublishedArtifact;
  executionMetadata: Readonly<Record<string, unknown>>;
  workUnitMetadata: Readonly<Record<string, unknown>>;
  policy: Readonly<{
    planningOnly: true;
    repositoryMutation: false;
    allowed: readonly AllowedCapability[];
    forbidden: readonly ForbiddenCapability[];
  }>;
  limits: Readonly<AgentLimits>;
}

export interface RuntimeLease {
  runtimeId: string;
  workerId: string;
  claimToken: string;
  attempt: number;
  leasedAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface RuntimeDiagnostic {
  code: string;
  message: string;
  retryable: boolean;
  details: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface RuntimeHeartbeat {
  runtimeId: string;
  workerId: string;
  claimToken: string;
  recordedAt: string;
  latencyMs: number;
}

export interface AgentStructuredOutput {
  summary: string;
  reasoning: readonly string[];
  findings: readonly string[];
  risks: readonly string[];
  assumptions: readonly string[];
  proposedFiles: readonly string[];
  proposedSymbols: readonly string[];
  validation: readonly string[];
  tests: readonly string[];
  confidence: number;
}

export interface VersionedAgentRuntimeOutput {
  outputId: string;
  runtimeId: string;
  executionVersion: string;
  workUnitVersion: string;
  agentVersion: string;
  capabilityVersion: string;
  outputVersion: number;
  payloadHash: string;
  output: AgentStructuredOutput;
  published: boolean;
  orphaned: boolean;
  createdAt: string;
}

export interface AgentRuntime {
  runtimeId: string;
  tenantId: string;
  agentId: AgentKind;
  agentVersion: string;
  capabilityVersion: string;
  capabilityHash: string;
  executionVersion: string;
  workUnitVersion: string;
  workerId: string | null;
  status: AgentRuntimeStatus;
  attempt: number;
  lease: RuntimeLease | null;
  heartbeat: RuntimeHeartbeat | null;
  diagnostics: readonly RuntimeDiagnostic[];
  context: AgentExecutionContext;
  outputVersion: number;
  supersededBy: string | null;
  recoveryCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentRuntimeQuotas {
  activeRuntimes: number;
  leasedWorkUnits: number;
  runtimeDurationMs: number;
  retries: number;
  outputBytes: number;
  concurrentAgents: number;
  retentionCount: number;
}

export type AgentRuntimeFailureCode =
  | "transient_runtime_failure"
  | "runtime_timeout"
  | "lease_expired"
  | "invalid_capability"
  | "output_validation_failed"
  | "authorization_failed";

export interface AgentRuntimeMetrics {
  activeAgents: number;
  runningAgents: number;
  leases: number;
  retries: number;
  failures: number;
  runtimeDurationMs: number;
  heartbeatLatencyMs: number;
  capabilityUsage: number;
  outputBytes: number;
  recoveryCount: number;
}

export class AgentRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}
