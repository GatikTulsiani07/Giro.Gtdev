export const REPOSITORY_KNOWLEDGE_ENGINE_VERSION =
  "repository-knowledge-engine-v1";
export const REPOSITORY_KNOWLEDGE_SCHEMA_VERSION =
  "repository-knowledge-schema-v1";
export const REPOSITORY_MEMORY_SCHEMA_VERSION =
  "repository-agent-memory-v1";

export const KNOWLEDGE_NAMESPACES = [
  "architecture",
  "repository",
  "implementation",
  "patterns",
  "conventions",
  "dependencies",
  "testing",
  "documentation",
  "reviews",
  "diagnostics",
] as const;
export type KnowledgeNamespace = (typeof KNOWLEDGE_NAMESPACES)[number];

export const KNOWLEDGE_SOURCE_TYPES = [
  "repository_graph",
  "intelligence",
  "planning",
  "execution",
  "review",
  "proposal",
  "diagnostics",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export type KnowledgeLifecycle =
  | "created"
  | "validated"
  | "active"
  | "superseded"
  | "archived"
  | "expired";
export type MemoryScope = "repository" | "execution" | "agent";

export interface KnowledgeFact {
  readonly key: string;
  readonly value: string;
  readonly evidence: readonly string[];
}

export interface KnowledgeContent {
  readonly schemaVersion: string;
  readonly summary: string;
  readonly facts: readonly KnowledgeFact[];
  readonly tags: readonly string[];
}

export interface PublishedKnowledgeSource {
  readonly sourceId: string;
  readonly sourceType: KnowledgeSourceType;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly sourceVersion: string;
  readonly contentHash: string;
  readonly executionId: string | null;
  readonly published: boolean;
  readonly publishedAt: string | null;
}

export interface KnowledgeDiagnostic {
  readonly diagnosticId: string;
  readonly knowledgeId: string;
  readonly knowledgeVersion: number;
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface KnowledgeVersion {
  readonly knowledgeId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly content: KnowledgeContent;
  readonly sourceReferences: readonly PublishedKnowledgeSource[];
  readonly diagnostics: readonly KnowledgeDiagnostic[];
  readonly confidence: number;
  readonly executionId: string | null;
  readonly mergedFromVersions: readonly number[];
  readonly deterministicSeed: string;
  readonly createdAt: string;
  readonly validatedAt: string;
  readonly activatedAt: string;
}

export interface KnowledgeSupersession {
  readonly supersessionId: string;
  readonly knowledgeId: string;
  readonly supersededVersion: number;
  readonly activeVersion: number;
  readonly reason: "evolved" | "deterministic_merge";
  readonly createdAt: string;
}

export interface KnowledgeLifecycleEvent {
  readonly eventId: string;
  readonly from: KnowledgeLifecycle | null;
  readonly to: KnowledgeLifecycle;
  readonly version: number;
  readonly reason: string;
  readonly createdAt: string;
}

export interface KnowledgeRecoveryRecord {
  readonly recoveryId: string;
  readonly reason:
    | "abandoned_write"
    | "stale_version"
    | "orphan_metadata"
    | "expired_memory";
  readonly version: number;
  readonly createdAt: string;
}

export interface KnowledgeArchiveMetadata {
  readonly archivedAt: string;
  readonly reason: "manual" | "retention" | "expired";
  readonly finalVersion: number;
  readonly contentHash: string;
}

export interface RepositoryKnowledgeEntry {
  readonly knowledgeId: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly namespace: KnowledgeNamespace;
  readonly subject: string;
  readonly contentHash: string;
  readonly sourceType: KnowledgeSourceType;
  readonly confidence: number;
  readonly version: number;
  readonly lifecycle: KnowledgeLifecycle;
  readonly versions: readonly KnowledgeVersion[];
  readonly supersessions: readonly KnowledgeSupersession[];
  readonly lifecycleHistory: readonly KnowledgeLifecycleEvent[];
  readonly recoveryHistory: readonly KnowledgeRecoveryRecord[];
  readonly archiveMetadata: KnowledgeArchiveMetadata | null;
  readonly writeLeaseExpiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMemoryRetrievalMetadata {
  readonly queryHash: string;
  readonly namespace: KnowledgeNamespace;
  readonly rank: number;
  readonly score: number;
  readonly retrievedKnowledgeIds: readonly string[];
}

export interface AgentMemoryRecord {
  readonly memoryId: string;
  readonly schemaVersion: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly agentId: string;
  readonly runtimeVersion: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly knowledgeId: string;
  readonly knowledgeVersion: number;
  readonly memoryScope: MemoryScope;
  readonly confidence: number;
  readonly retrievalMetadata: AgentMemoryRetrievalMetadata;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface MemoryExpirationRecord {
  readonly expirationId: string;
  readonly memoryId: string;
  readonly reason: "expired";
  readonly createdAt: string;
}

export interface CreateKnowledgeInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly namespace: KnowledgeNamespace;
  readonly subject: string;
  readonly content: KnowledgeContent;
  readonly sources: readonly PublishedKnowledgeSource[];
  readonly confidence: number;
  readonly executionId?: string | null;
  readonly baseVersion: number;
  readonly merge?: boolean;
  readonly writeLeaseExpiresAt?: string | null;
}

export interface RememberKnowledgeInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly executionId: string;
  readonly agentId: string;
  readonly runtimeVersion: string;
  readonly knowledgeId: string;
  readonly knowledgeVersion: number;
  readonly memoryScope: MemoryScope;
  readonly confidence: number;
  readonly retrievalMetadata: AgentMemoryRetrievalMetadata;
  readonly expiresAt?: string | null;
}

export interface RetrieveKnowledgeQuery {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision?: string;
  readonly namespace?: KnowledgeNamespace;
  readonly subject?: string;
  readonly executionId?: string;
  readonly minimumConfidence?: number;
  readonly version?: number;
  readonly limit?: number;
}

export interface KnowledgeRetrievalResult {
  readonly knowledgeId: string;
  readonly namespace: KnowledgeNamespace;
  readonly subject: string;
  readonly repositoryRevision: string;
  readonly version: number;
  readonly confidence: number;
  readonly score: number;
  readonly rank: number;
  readonly contentHash: string;
  readonly content: KnowledgeContent;
  readonly executionId: string | null;
}

export interface KnowledgeMetrics {
  readonly knowledgeEntries: number;
  readonly retrievalLatencyMs: number;
  readonly supersessions: number;
  readonly namespaceUsage: Readonly<Record<KnowledgeNamespace, number>>;
  readonly memoryGrowth: number;
  readonly confidenceDistribution: Readonly<{
    low: number;
    medium: number;
    high: number;
  }>;
  readonly recoveryCount: number;
}

export interface KnowledgeQuotas {
  readonly entriesPerRepository: number;
  readonly versionsPerEntry: number;
  readonly factsPerVersion: number;
  readonly sourcesPerVersion: number;
  readonly diagnosticsPerVersion: number;
  readonly contentBytes: number;
  readonly memoriesPerRepository: number;
  readonly retainedEntries: number;
  readonly retainedVersions: number;
  readonly retainedMemories: number;
  readonly writeTimeoutMs: number;
}

export class RepositoryKnowledgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RepositoryKnowledgeError";
  }
}
