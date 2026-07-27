import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase.js";
import { rankRetrievalCandidates } from "../retrieval/candidateRanking.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  AgentMemoryRecord,
  CreateKnowledgeInput,
  KnowledgeLifecycle,
  KnowledgeLifecycleEvent,
  KnowledgeMetrics,
  KnowledgeNamespace,
  KnowledgeQuotas,
  KnowledgeRecoveryRecord,
  KnowledgeRetrievalResult,
  MemoryExpirationRecord,
  RememberKnowledgeInput,
  RepositoryKnowledgeEntry,
  RetrieveKnowledgeQuery,
} from "./types.js";
import {
  KNOWLEDGE_NAMESPACES,
  REPOSITORY_KNOWLEDGE_ENGINE_VERSION,
  REPOSITORY_KNOWLEDGE_SCHEMA_VERSION,
  REPOSITORY_MEMORY_SCHEMA_VERSION,
  RepositoryKnowledgeError,
} from "./types.js";
import {
  knowledgeIdentity,
  mergeContent,
  validateCreateInput,
  validateKnowledgeIntegrity,
  validateRememberInput,
  validateRetrievalQuery,
} from "./validation.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
const clone = <T>(value: T): T => deepFreeze(structuredClone(value));
const sortedSources = <T extends {
  sourceType: string; sourceId: string; sourceVersion: string;
}>(sources: readonly T[]): T[] => [...sources].sort((left, right) =>
  left.sourceType.localeCompare(right.sourceType) ||
  left.sourceId.localeCompare(right.sourceId) ||
  left.sourceVersion.localeCompare(right.sourceVersion));

const emptyNamespaceUsage = (): Record<KnowledgeNamespace, number> =>
  Object.fromEntries(KNOWLEDGE_NAMESPACES.map((value) => [value, 0])) as
    Record<KnowledgeNamespace, number>;

export interface RepositoryKnowledgeStore {
  create(
    input: CreateKnowledgeInput,
    quotas: KnowledgeQuotas,
    now?: Date,
  ): Promise<RepositoryKnowledgeEntry>;
  get(
    tenantId: string,
    knowledgeId: string,
    ownerId: string,
  ): Promise<RepositoryKnowledgeEntry | null>;
  retrieve(query: RetrieveKnowledgeQuery): Promise<KnowledgeRetrievalResult[]>;
  remember(
    input: RememberKnowledgeInput,
    quotas: KnowledgeQuotas,
    now?: Date,
  ): Promise<AgentMemoryRecord>;
  listMemories(
    tenantId: string,
    repositoryId: string,
    ownerId: string,
  ): Promise<AgentMemoryRecord[]>;
  archive(
    tenantId: string,
    knowledgeId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ): Promise<RepositoryKnowledgeEntry>;
  recover(now?: Date, quotas?: KnowledgeQuotas): Promise<number>;
  collect(tenantId: string, quotas: KnowledgeQuotas): Promise<number>;
  metrics(tenantId?: string): Promise<KnowledgeMetrics>;
  verify(quotas?: KnowledgeQuotas): Promise<void>;
}

function lifecycleEvent(
  knowledgeId: string,
  from: KnowledgeLifecycle | null,
  to: KnowledgeLifecycle,
  version: number,
  reason: string,
  createdAt: string,
  sequence: number,
): KnowledgeLifecycleEvent {
  return {
    eventId: stableId("knowledge_lifecycle", {
      knowledgeId, from, to, version, reason, sequence,
    }),
    from, to, version, reason, createdAt,
  };
}

export class MemoryRepositoryKnowledgeStore implements RepositoryKnowledgeStore {
  private readonly entries = new Map<string, RepositoryKnowledgeEntry>();
  private readonly memories = new Map<string, AgentMemoryRecord>();
  private readonly memoryExpirations =
    new Map<string, MemoryExpirationRecord>();
  private retrievalLatencyMs = 0;

  private entryKey(tenantId: string, knowledgeId: string): string {
    return `${tenantId}\0${knowledgeId}`;
  }

  hydrate(entry: RepositoryKnowledgeEntry): void {
    this.entries.set(this.entryKey(entry.tenantId, entry.knowledgeId),
      clone(entry));
  }

  hydrateMemory(memory: AgentMemoryRecord): void {
    this.memories.set(memory.memoryId, clone(memory));
  }

  private save(entry: RepositoryKnowledgeEntry): RepositoryKnowledgeEntry {
    const key = this.entryKey(entry.tenantId, entry.knowledgeId);
    const current = this.entries.get(key);
    const saved = clone({
      ...entry,
      persistenceVersion: (current?.persistenceVersion ?? 0) + 1,
    });
    this.entries.set(key, saved);
    return clone(saved);
  }

  private require(
    tenantId: string,
    knowledgeId: string,
    ownerId: string,
  ): RepositoryKnowledgeEntry {
    const entry = this.entries.get(this.entryKey(tenantId, knowledgeId));
    if (!entry) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_not_found", "Knowledge entry was not found.");
    }
    if (entry.ownerId !== ownerId) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_ownership_conflict",
        "Knowledge entry belongs to another owner.");
    }
    return entry;
  }

  async create(
    input: CreateKnowledgeInput,
    quotas: KnowledgeQuotas,
    now = new Date(),
  ): Promise<RepositoryKnowledgeEntry> {
    const knowledgeId = knowledgeIdentity(input);
    const existing = this.entries.get(this.entryKey(input.tenantId, knowledgeId))
      ?? null;
    const repositoryEntryCount = [...this.entries.values()].filter((entry) =>
      entry.tenantId === input.tenantId &&
      entry.repositoryId === input.repositoryId &&
      entry.lifecycle !== "archived").length;
    let content = validateCreateInput(
      input, existing, quotas, repositoryEntryCount);
    if (existing &&
        (existing.repositoryRevision !== input.repositoryRevision ||
         existing.ownerId !== input.ownerId)) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_ownership_or_revision_conflict",
        "Knowledge identity cannot cross owners or repository revisions.");
    }
    if (input.merge && existing) {
      content = mergeContent(existing.versions.at(-1)!.content, content);
      if (content.facts.length > quotas.factsPerVersion ||
          Buffer.byteLength(JSON.stringify(content)) > quotas.contentBytes) {
        throw new RepositoryKnowledgeError(
          "repository_knowledge_quota_exceeded",
          "Merged knowledge exceeds content quotas.");
      }
    }
    const timestamp = now.toISOString();
    const version = (existing?.version ?? 0) + 1;
    const contentHash = stableHash(content);
    const sources = sortedSources(input.sources);
    const sourceType = sources[0]!.sourceType;
    const diagnostic = {
      diagnosticId: stableId("knowledge_diagnostic", {
        knowledgeId, version, code: "knowledge_schema_validated",
      }),
      knowledgeId,
      knowledgeVersion: version,
      severity: "info" as const,
      code: "knowledge_schema_validated",
      message: "Knowledge content and publication sources were validated.",
      createdAt: timestamp,
    };
    const deterministicSeed = stableHash({
      knowledgeId, version, contentHash,
      sources: sources.map((source) => ({
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        contentHash: source.contentHash,
      })),
      confidence: input.confidence,
      executionId: input.executionId ?? null,
    });
    const knowledgeVersion = {
      knowledgeId,
      version,
      contentHash,
      content,
      sourceReferences: sources,
      diagnostics: [diagnostic],
      confidence: input.confidence,
      executionId: input.executionId ?? null,
      mergedFromVersions: existing ? [existing.version] : [],
      deterministicSeed,
      createdAt: timestamp,
      validatedAt: timestamp,
      activatedAt: timestamp,
    };
    const supersessions = existing ? [
      ...existing.supersessions,
      {
        supersessionId: stableId("knowledge_supersession", {
          knowledgeId, supersededVersion: existing.version,
          activeVersion: version,
        }),
        knowledgeId,
        supersededVersion: existing.version,
        activeVersion: version,
        reason: input.merge
          ? "deterministic_merge" as const : "evolved" as const,
        createdAt: timestamp,
      },
    ] : [];
    const history = [
      ...(existing?.lifecycleHistory ?? []),
      ...(existing ? [lifecycleEvent(
        knowledgeId, "active", "superseded", existing.version,
        "new_version_activated", timestamp,
        existing.lifecycleHistory.length,
      )] : [
        lifecycleEvent(knowledgeId, null, "created", version,
          "knowledge_created", timestamp, 0),
        lifecycleEvent(knowledgeId, "created", "validated", version,
          "knowledge_validated", timestamp, 1),
      ]),
      lifecycleEvent(
        knowledgeId, existing ? "superseded" : "validated", "active",
        version, "knowledge_activated", timestamp,
        (existing?.lifecycleHistory.length ?? 2) + (existing ? 1 : 0)),
    ];
    const entry: RepositoryKnowledgeEntry = {
      knowledgeId,
      schemaVersion: REPOSITORY_KNOWLEDGE_SCHEMA_VERSION,
      persistenceVersion: existing?.persistenceVersion ?? 0,
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      namespace: input.namespace,
      subject: input.subject.trim(),
      contentHash,
      sourceType,
      confidence: input.confidence,
      version,
      lifecycle: "active",
      versions: [...(existing?.versions ?? []), knowledgeVersion],
      supersessions,
      lifecycleHistory: history,
      recoveryHistory: existing?.recoveryHistory ?? [],
      archiveMetadata: null,
      writeLeaseExpiresAt: input.writeLeaseExpiresAt ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    validateKnowledgeIntegrity(entry);
    return this.save(entry);
  }

  async get(tenantId: string, knowledgeId: string, ownerId: string) {
    const entry = this.entries.get(this.entryKey(tenantId, knowledgeId));
    if (entry && entry.ownerId !== ownerId) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_ownership_conflict",
        "Knowledge entry belongs to another owner.");
    }
    return entry ? clone(entry) : null;
  }

  async retrieve(query: RetrieveKnowledgeQuery) {
    validateRetrievalQuery(query);
    const started = performance.now();
    const candidates = [...this.entries.values()]
      .filter((entry) =>
        entry.tenantId === query.tenantId &&
        entry.ownerId === query.ownerId &&
        entry.repositoryId === query.repositoryId &&
        entry.lifecycle === "active" &&
        (!query.repositoryRevision ||
          entry.repositoryRevision === query.repositoryRevision) &&
        (!query.namespace || entry.namespace === query.namespace) &&
        (!query.subject ||
          entry.subject.toLowerCase().includes(query.subject.toLowerCase())) &&
        entry.confidence >= (query.minimumConfidence ?? 0) &&
        (!query.version || entry.version === query.version) &&
        (!query.executionId ||
          entry.versions.at(-1)!.executionId === query.executionId))
      .map((entry) => {
        const current = entry.versions.at(-1)!;
        const exactSubject = query.subject &&
          entry.subject.toLowerCase() === query.subject.toLowerCase();
        const score = Math.min(1,
          entry.confidence * 0.55 +
          (query.namespace === entry.namespace ? 0.15 : 0) +
          (exactSubject ? 0.2 : query.subject ? 0.1 : 0) +
          (query.executionId === current.executionId ? 0.1 : 0));
        return {
          entry,
          candidate: {
            filePath:
              `${entry.namespace}/${entry.subject}/${entry.knowledgeId}`,
            content: JSON.stringify(current.content),
            score,
            symbol: entry.subject,
            repositoryVersion: entry.repositoryRevision,
          },
        };
      });
    const byPath = new Map(candidates.map((value) =>
      [value.candidate.filePath, value.entry]));
    const ranked = rankRetrievalCandidates(
      candidates.map((value) => value.candidate))
      .slice(0, Math.min(query.limit ?? 20, 100));
    this.retrievalLatencyMs += Math.max(0, performance.now() - started);
    return ranked.map((candidate, index): KnowledgeRetrievalResult => {
      const entry = byPath.get(candidate.filePath)!;
      const current = entry.versions.at(-1)!;
      return clone({
        knowledgeId: entry.knowledgeId,
        namespace: entry.namespace,
        subject: entry.subject,
        repositoryRevision: entry.repositoryRevision,
        version: entry.version,
        confidence: entry.confidence,
        score: candidate.score,
        rank: index + 1,
        contentHash: entry.contentHash,
        content: current.content,
        executionId: current.executionId,
      });
    });
  }

  async remember(
    input: RememberKnowledgeInput,
    quotas: KnowledgeQuotas,
    now = new Date(),
  ): Promise<AgentMemoryRecord> {
    const entry = this.entries.get(
      this.entryKey(input.tenantId, input.knowledgeId)) ?? null;
    const memoryCount = [...this.memories.values()].filter((memory) =>
      memory.tenantId === input.tenantId &&
      memory.repositoryId === input.repositoryId).length;
    validateRememberInput(input, entry, quotas, memoryCount);
    const memoryId = stableId("agent_memory", {
      tenantId: input.tenantId,
      agentId: input.agentId,
      runtimeVersion: input.runtimeVersion,
      repositoryId: input.repositoryId,
      executionId: input.executionId,
      knowledgeId: input.knowledgeId,
      knowledgeVersion: input.knowledgeVersion,
      memoryScope: input.memoryScope,
      retrievalMetadata: input.retrievalMetadata,
    });
    const record: AgentMemoryRecord = {
      memoryId,
      schemaVersion: REPOSITORY_MEMORY_SCHEMA_VERSION,
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      agentId: input.agentId,
      runtimeVersion: input.runtimeVersion,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      executionId: input.executionId,
      knowledgeId: input.knowledgeId,
      knowledgeVersion: input.knowledgeVersion,
      memoryScope: input.memoryScope,
      confidence: input.confidence,
      retrievalMetadata: {
        ...input.retrievalMetadata,
        retrievedKnowledgeIds: [...new Set(
          input.retrievalMetadata.retrievedKnowledgeIds)].sort(),
      },
      contentHash: entry!.contentHash,
      createdAt: now.toISOString(),
      expiresAt: input.expiresAt ?? null,
    };
    const existing = this.memories.get(memoryId);
    if (existing) {
      const comparable = (value: AgentMemoryRecord) => ({
        ...value, createdAt: null,
      });
      if (stableHash(comparable(existing)) !== stableHash(comparable(record))) {
        throw new RepositoryKnowledgeError(
          "repository_memory_immutable_conflict",
          "An immutable memory identity already has different content.");
      }
      return clone(existing);
    }
    this.memories.set(memoryId, clone(record));
    return clone(record);
  }

  async listMemories(
    tenantId: string,
    repositoryId: string,
    ownerId: string,
  ): Promise<AgentMemoryRecord[]> {
    const expired = new Set([...this.memoryExpirations.values()]
      .map((record) => record.memoryId));
    return [...this.memories.values()]
      .filter((memory) =>
        memory.tenantId === tenantId &&
        memory.repositoryId === repositoryId &&
        memory.ownerId === ownerId &&
        !expired.has(memory.memoryId))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.memoryId.localeCompare(right.memoryId))
      .map(clone);
  }

  async archive(
    tenantId: string,
    knowledgeId: string,
    ownerId: string,
    expectedVersion: number,
    now = new Date(),
  ): Promise<RepositoryKnowledgeEntry> {
    const entry = this.require(tenantId, knowledgeId, ownerId);
    if (entry.version !== expectedVersion || entry.lifecycle !== "active") {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_stale_version",
        "Archive version fence or lifecycle is stale.");
    }
    const timestamp = now.toISOString();
    return this.save({
      ...entry,
      lifecycle: "archived",
      archiveMetadata: {
        archivedAt: timestamp,
        reason: "manual",
        finalVersion: entry.version,
        contentHash: entry.contentHash,
      },
      lifecycleHistory: [...entry.lifecycleHistory, lifecycleEvent(
        knowledgeId, "active", "archived", entry.version, "manual_archive",
        timestamp, entry.lifecycleHistory.length)],
      writeLeaseExpiresAt: null,
      updatedAt: timestamp,
    });
  }

  async recover(
    now = new Date(),
    quotas?: KnowledgeQuotas,
  ): Promise<number> {
    let recovered = 0;
    const timestamp = now.toISOString();
    for (const entry of [...this.entries.values()]) {
      let reason: KnowledgeRecoveryRecord["reason"] | null = null;
      if ((entry.lifecycle === "created" || entry.lifecycle === "validated") &&
          (entry.writeLeaseExpiresAt
            ? Date.parse(entry.writeLeaseExpiresAt) <= now.getTime()
            : now.getTime() - Date.parse(entry.updatedAt) >=
              (quotas?.writeTimeoutMs ?? 300_000))) {
        reason = "abandoned_write";
      } else if (entry.version !== entry.versions.length ||
          entry.versions.some((version, index) =>
            version.version !== index + 1)) {
        reason = "stale_version";
      } else if (entry.versions.some((version) =>
        version.diagnostics.some((diagnostic) =>
          diagnostic.knowledgeId !== entry.knowledgeId ||
          diagnostic.knowledgeVersion !== version.version))) {
        reason = "orphan_metadata";
      }
      if (reason) {
        const recovery: KnowledgeRecoveryRecord = {
          recoveryId: stableId("knowledge_recovery", {
            knowledgeId: entry.knowledgeId, version: entry.version, reason,
          }),
          reason,
          version: entry.version,
          createdAt: timestamp,
        };
        this.save({
          ...entry,
          lifecycle: "expired",
          recoveryHistory: [...entry.recoveryHistory, recovery],
          lifecycleHistory: [...entry.lifecycleHistory, lifecycleEvent(
            entry.knowledgeId, entry.lifecycle, "expired", entry.version,
            reason, timestamp, entry.lifecycleHistory.length)],
          archiveMetadata: {
            archivedAt: timestamp,
            reason: "expired",
            finalVersion: entry.version,
            contentHash: entry.contentHash,
          },
          writeLeaseExpiresAt: null,
          updatedAt: timestamp,
        });
        recovered += 1;
      }
    }
    for (const memory of this.memories.values()) {
      if (memory.expiresAt && Date.parse(memory.expiresAt) <= now.getTime() &&
          !this.memoryExpirations.has(memory.memoryId)) {
        this.memoryExpirations.set(memory.memoryId, clone({
          expirationId: stableId("memory_expiration", {
            memoryId: memory.memoryId, reason: "expired",
          }),
          memoryId: memory.memoryId,
          reason: "expired",
          createdAt: timestamp,
        }));
        recovered += 1;
      }
    }
    return recovered;
  }

  async collect(tenantId: string, quotas: KnowledgeQuotas): Promise<number> {
    let removed = 0;
    const terminal = [...this.entries.values()]
      .filter((entry) => entry.tenantId === tenantId &&
        ["archived", "expired"].includes(entry.lifecycle))
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.knowledgeId.localeCompare(right.knowledgeId));
    for (const entry of terminal.slice(quotas.retainedEntries)) {
      this.entries.delete(this.entryKey(tenantId, entry.knowledgeId));
      removed += 1;
    }
    const memories = [...this.memories.values()]
      .filter((memory) => memory.tenantId === tenantId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.memoryId.localeCompare(right.memoryId));
    for (const memory of memories.slice(quotas.retainedMemories)) {
      this.memories.delete(memory.memoryId);
      removed += 1;
    }
    return removed;
  }

  async metrics(tenantId?: string): Promise<KnowledgeMetrics> {
    const entries = [...this.entries.values()].filter((entry) =>
      !tenantId || entry.tenantId === tenantId);
    const memories = [...this.memories.values()].filter((memory) =>
      !tenantId || memory.tenantId === tenantId);
    const namespaceUsage = emptyNamespaceUsage();
    for (const entry of entries) namespaceUsage[entry.namespace] += 1;
    return clone({
      knowledgeEntries: entries.length,
      retrievalLatencyMs: this.retrievalLatencyMs,
      supersessions: entries.reduce(
        (count, entry) => count + entry.supersessions.length, 0),
      namespaceUsage,
      memoryGrowth: memories.length,
      confidenceDistribution: {
        low: entries.filter((entry) => entry.confidence < 0.4).length,
        medium: entries.filter((entry) =>
          entry.confidence >= 0.4 && entry.confidence < 0.75).length,
        high: entries.filter((entry) => entry.confidence >= 0.75).length,
      },
      recoveryCount: entries.reduce(
        (count, entry) => count + entry.recoveryHistory.length, 0) +
        this.memoryExpirations.size,
    });
  }

  async verify(quotas?: KnowledgeQuotas): Promise<void> {
    if (quotas && Object.values(quotas).some((value) =>
      !Number.isSafeInteger(value) || value < 1)) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_startup_validation_failed",
        "Knowledge retention and quota policy is invalid.");
    }
    for (const entry of this.entries.values()) {
      if (!["expired", "archived"].includes(entry.lifecycle)) {
        validateKnowledgeIntegrity(entry);
      }
    }
  }
}

interface RpcQuery extends PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> {}
interface DatabaseClient {
  rpc(name: string, parameters?: Record<string, unknown>): RpcQuery;
}
const first = (value: unknown): Record<string, unknown> | undefined =>
  Array.isArray(value)
    ? value[0] as Record<string, unknown> | undefined : undefined;

export class PostgresRepositoryKnowledgeStore
implements RepositoryKnowledgeStore {
  private retrievalLatencyMs = 0;

  constructor(private readonly client: DatabaseClient) {}

  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) {
      const code =
        error.message?.match(/repository_(?:knowledge|memory)_[a-z_]+/u)?.[0]
        ?? "repository_knowledge_persistence_failed";
      throw new RepositoryKnowledgeError(
        code, error.message ?? "Repository knowledge persistence failed.");
    }
    return data;
  }

  private async load(tenantId: string, knowledgeId: string) {
    const data = await this.call("get_repository_knowledge_entry", {
      input_tenant_id: tenantId, input_knowledge_id: knowledgeId,
    });
    if (Array.isArray(data) && data.length === 0) return null;
    return clone((first(data)?.entry ?? data) as RepositoryKnowledgeEntry);
  }

  private async persist(
    entry: RepositoryKnowledgeEntry,
    expectedPersistenceVersion: number | null,
  ) {
    const data = await this.call("save_repository_knowledge_entry", {
      input_entry: entry,
      input_expected_version: expectedPersistenceVersion === null
        ? null : String(expectedPersistenceVersion),
    });
    return clone((first(data)?.entry ?? data) as RepositoryKnowledgeEntry);
  }

  private async list(input: {
    tenantId?: string; repositoryId?: string;
  } = {}): Promise<RepositoryKnowledgeEntry[]> {
    const data = await this.call("list_repository_knowledge_entries", {
      input_tenant_id: input.tenantId ?? null,
      input_repository_id: input.repositoryId ?? null,
    });
    return clone((first(data)?.entries ?? data ?? []) as
      RepositoryKnowledgeEntry[]);
  }

  async create(input: CreateKnowledgeInput, quotas: KnowledgeQuotas, now?: Date) {
    const id = knowledgeIdentity(input);
    const existing = await this.load(input.tenantId, id);
    const memory = new MemoryRepositoryKnowledgeStore();
    if (existing) memory.hydrate(existing);
    if (!existing) {
      const count = (await this.list({
        tenantId: input.tenantId, repositoryId: input.repositoryId,
      })).filter((entry) => entry.lifecycle !== "archived").length;
      if (count >= quotas.entriesPerRepository) {
        throw new RepositoryKnowledgeError(
          "repository_knowledge_quota_exceeded",
          "Repository knowledge quota was exceeded.");
      }
    }
    const entry = await memory.create(input, quotas, now);
    return this.persist(entry, existing?.persistenceVersion ?? null);
  }

  async get(tenantId: string, knowledgeId: string, ownerId: string) {
    const entry = await this.load(tenantId, knowledgeId);
    if (entry && entry.ownerId !== ownerId) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_ownership_conflict",
        "Knowledge entry belongs to another owner.");
    }
    return entry;
  }

  async retrieve(query: RetrieveKnowledgeQuery) {
    const started = performance.now();
    const memory = new MemoryRepositoryKnowledgeStore();
    for (const entry of await this.list({
      tenantId: query.tenantId, repositoryId: query.repositoryId,
    })) memory.hydrate(entry);
    const results = await memory.retrieve(query);
    this.retrievalLatencyMs += Math.max(0, performance.now() - started);
    return results;
  }

  async remember(
    input: RememberKnowledgeInput,
    quotas: KnowledgeQuotas,
    now?: Date,
  ) {
    const memory = new MemoryRepositoryKnowledgeStore();
    const entry = await this.load(input.tenantId, input.knowledgeId);
    if (entry) memory.hydrate(entry);
    const existingData = await this.call("list_repository_agent_memories", {
      input_tenant_id: input.tenantId,
      input_repository_id: input.repositoryId,
    });
    const existing = (first(existingData)?.memories ?? existingData ?? []) as
      AgentMemoryRecord[];
    for (const record of existing) memory.hydrateMemory(record);
    const record = await memory.remember(input, quotas, now);
    const data = await this.call("save_repository_agent_memory", {
      input_memory: record,
    });
    return clone((first(data)?.memory ?? data) as AgentMemoryRecord);
  }

  async listMemories(
    tenantId: string,
    repositoryId: string,
    ownerId: string,
  ) {
    const data = await this.call("list_repository_agent_memories", {
      input_tenant_id: tenantId, input_repository_id: repositoryId,
    });
    return clone(((first(data)?.memories ?? data ?? []) as AgentMemoryRecord[])
      .filter((memory) => memory.ownerId === ownerId));
  }

  async archive(
    tenantId: string,
    knowledgeId: string,
    ownerId: string,
    expectedVersion: number,
    now?: Date,
  ) {
    const existing = await this.load(tenantId, knowledgeId);
    if (!existing) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_not_found", "Knowledge entry was not found.");
    }
    const memory = new MemoryRepositoryKnowledgeStore();
    memory.hydrate(existing);
    const entry = await memory.archive(
      tenantId, knowledgeId, ownerId, expectedVersion, now);
    return this.persist(entry, existing.persistenceVersion);
  }

  async recover(now = new Date(), quotas?: KnowledgeQuotas) {
    const data = await this.call("list_recoverable_repository_knowledge", {
      input_now: now.toISOString(),
    });
    const entries = (first(data)?.entries ?? data ?? []) as
      RepositoryKnowledgeEntry[];
    let count = 0;
    for (const entry of entries) {
      const memory = new MemoryRepositoryKnowledgeStore();
      memory.hydrate(entry);
      const recovered = await memory.recover(now, quotas);
      if (recovered) {
        const updated = await memory.get(
          entry.tenantId, entry.knowledgeId, entry.ownerId);
        if (updated) await this.persist(updated, entry.persistenceVersion);
      }
      count += recovered;
    }
    const expired = await this.call("expire_repository_agent_memories", {
      input_now: now.toISOString(),
    });
    return count + Number(first(expired)?.expired_count ?? expired ?? 0);
  }

  async collect(tenantId: string, quotas: KnowledgeQuotas) {
    const data = await this.call("collect_repository_knowledge", {
      input_tenant_id: tenantId,
      input_entry_retention: quotas.retainedEntries,
      input_version_retention: quotas.retainedVersions,
      input_memory_retention: quotas.retainedMemories,
    });
    return Number(first(data)?.deleted_count ?? data ?? 0);
  }

  async metrics(tenantId?: string) {
    const data = await this.call("repository_knowledge_metrics", {
      input_tenant_id: tenantId ?? null,
    });
    return clone({
      ...((first(data)?.metrics ?? data) as KnowledgeMetrics),
      retrievalLatencyMs: this.retrievalLatencyMs,
    });
  }

  async verify() {
    const data = await this.call("verify_repository_knowledge_contract", {
      input_engine_version: REPOSITORY_KNOWLEDGE_ENGINE_VERSION,
      input_schema_version: REPOSITORY_KNOWLEDGE_SCHEMA_VERSION,
    });
    const row = first(data) ?? data as Record<string, unknown>;
    if (row.valid !== true && data !== true) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_startup_validation_failed",
        "Repository knowledge database contract is invalid.",
        { problems: row.problems ?? [] });
    }
  }
}

export const runtimeRepositoryKnowledgeStore: RepositoryKnowledgeStore =
  new PostgresRepositoryKnowledgeStore(
    supabase as unknown as SupabaseClient);
