import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import {
  KNOWLEDGE_NAMESPACES,
  KNOWLEDGE_SOURCE_TYPES,
  REPOSITORY_KNOWLEDGE_SCHEMA_VERSION,
  RepositoryKnowledgeError,
  type CreateKnowledgeInput,
  type KnowledgeContent,
  type KnowledgeQuotas,
  type RepositoryKnowledgeEntry,
  type RememberKnowledgeInput,
  type RetrieveKnowledgeQuery,
} from "./types.js";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const assertId = (name: string, value: string): void => {
  if (!idPattern.test(value)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_schema_invalid", `${name} is malformed.`);
  }
};
const assertConfidence = (value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_confidence_invalid",
      "Confidence must be between zero and one.");
  }
};

export function knowledgeIdentity(input: Pick<CreateKnowledgeInput,
  "tenantId" | "repositoryId" | "namespace" | "subject">): string {
  return stableId("knowledge", {
    tenantId: input.tenantId,
    repositoryId: input.repositoryId,
    namespace: input.namespace,
    subject: input.subject.trim(),
  });
}

export function normalizeContent(content: KnowledgeContent): KnowledgeContent {
  return {
    schemaVersion: content.schemaVersion,
    summary: content.summary.trim(),
    facts: [...content.facts]
      .map((fact) => ({
        key: fact.key.trim(),
        value: fact.value.trim(),
        evidence: [...new Set(fact.evidence.map((item) => item.trim()))]
          .filter(Boolean).sort(),
      }))
      .sort((left, right) =>
        left.key.localeCompare(right.key) ||
        left.value.localeCompare(right.value)),
    tags: [...new Set(content.tags.map((tag) => tag.trim().toLowerCase()))]
      .filter(Boolean).sort(),
  };
}

export function mergeContent(
  previous: KnowledgeContent,
  incoming: KnowledgeContent,
): KnowledgeContent {
  const normalized = [normalizeContent(previous), normalizeContent(incoming)];
  const facts = new Map<string, (typeof normalized)[number]["facts"][number]>();
  for (const content of normalized) {
    for (const fact of content.facts) {
      const key = `${fact.key}\0${fact.value}`;
      const existing = facts.get(key);
      facts.set(key, {
        ...fact,
        evidence: [...new Set([
          ...(existing?.evidence ?? []), ...fact.evidence,
        ])].sort(),
      });
    }
  }
  return normalizeContent({
    schemaVersion: incoming.schemaVersion,
    summary: incoming.summary.trim() || previous.summary,
    facts: [...facts.values()],
    tags: [...previous.tags, ...incoming.tags],
  });
}

export function validateCreateInput(
  input: CreateKnowledgeInput,
  existing: RepositoryKnowledgeEntry | null,
  quotas: KnowledgeQuotas,
  repositoryEntryCount: number,
): KnowledgeContent {
  for (const [name, value] of [
    ["tenantId", input.tenantId], ["ownerId", input.ownerId],
    ["repositoryId", input.repositoryId],
    ["repositoryRevision", input.repositoryRevision],
  ] as const) assertId(name, value);
  if (input.ownerId !== input.repositoryOwnerId) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_ownership_conflict",
      "Repository knowledge belongs to another owner.");
  }
  if (!KNOWLEDGE_NAMESPACES.includes(input.namespace)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_namespace_invalid", "Namespace is unsupported.");
  }
  if (!input.subject.trim() || input.subject.length > 512) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_schema_invalid", "Subject is malformed.");
  }
  assertConfidence(input.confidence);
  if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0 ||
      input.baseVersion !== (existing?.version ?? 0)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_stale_version",
      "Knowledge version fence is stale.", {
        expectedVersion: existing?.version ?? 0,
        receivedVersion: input.baseVersion,
      });
  }
  if (existing && existing.lifecycle !== "active") {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_lifecycle_conflict",
      "Only active knowledge can evolve.");
  }
  if (!existing && repositoryEntryCount >= quotas.entriesPerRepository) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_quota_exceeded",
      "Repository knowledge quota was exceeded.");
  }
  if ((existing?.versions.length ?? 0) >= quotas.versionsPerEntry) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_quota_exceeded",
      "Knowledge version quota was exceeded.");
  }
  if (!input.sources.length || input.sources.length > quotas.sourcesPerVersion) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_source_invalid",
      "A bounded set of published sources is required.");
  }
  for (const source of input.sources) {
    if (!KNOWLEDGE_SOURCE_TYPES.includes(source.sourceType) ||
        !source.published || !source.publishedAt ||
        source.repositoryId !== input.repositoryId ||
        source.repositoryRevision !== input.repositoryRevision ||
        !hashPattern.test(source.contentHash)) {
      throw new RepositoryKnowledgeError(
        "repository_knowledge_source_unpublished",
        "Sources must be published for the selected repository revision.");
    }
    assertId("sourceId", source.sourceId);
  }
  const content = normalizeContent(input.content);
  if (content.schemaVersion !== REPOSITORY_KNOWLEDGE_SCHEMA_VERSION ||
      !content.summary || content.facts.length > quotas.factsPerVersion ||
      Buffer.byteLength(JSON.stringify(content)) > quotas.contentBytes ||
      content.facts.some((fact) => !fact.key || !fact.value)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_schema_invalid",
      "Knowledge content does not satisfy the durable schema.");
  }
  return content;
}

export function validateRememberInput(
  input: RememberKnowledgeInput,
  entry: RepositoryKnowledgeEntry | null,
  quotas: KnowledgeQuotas,
  memoryCount: number,
): void {
  [
    input.tenantId, input.ownerId, input.repositoryId, input.executionId,
    input.agentId, input.runtimeVersion, input.knowledgeId,
  ].forEach((value) => assertId("memory identity", value));
  assertConfidence(input.confidence);
  if (!entry || entry.ownerId !== input.ownerId ||
      entry.repositoryId !== input.repositoryId ||
      entry.repositoryRevision !== input.repositoryRevision ||
      entry.lifecycle !== "active" ||
      entry.version !== input.knowledgeVersion) {
    throw new RepositoryKnowledgeError(
      "repository_memory_stale_knowledge",
      "Agent memory must reference the current owned knowledge version.");
  }
  if (memoryCount >= quotas.memoriesPerRepository) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_quota_exceeded",
      "Agent memory quota was exceeded.");
  }
  if (!Number.isSafeInteger(input.retrievalMetadata.rank) ||
      input.retrievalMetadata.rank < 1 ||
      !Number.isFinite(input.retrievalMetadata.score)) {
    throw new RepositoryKnowledgeError(
      "repository_memory_schema_invalid",
      "Retrieval metadata is malformed.");
  }
}

export function validateRetrievalQuery(query: RetrieveKnowledgeQuery): void {
  assertId("tenantId", query.tenantId);
  assertId("ownerId", query.ownerId);
  assertId("repositoryId", query.repositoryId);
  if (query.namespace && !KNOWLEDGE_NAMESPACES.includes(query.namespace)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_namespace_invalid", "Namespace is unsupported.");
  }
  if (query.minimumConfidence !== undefined) {
    assertConfidence(query.minimumConfidence);
  }
  if (query.version !== undefined &&
      (!Number.isSafeInteger(query.version) || query.version < 1)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_schema_invalid", "Version is malformed.");
  }
}

export function validateKnowledgeIntegrity(entry: RepositoryKnowledgeEntry): void {
  const current = entry.versions.at(-1);
  if (entry.schemaVersion !== REPOSITORY_KNOWLEDGE_SCHEMA_VERSION ||
      !current || current.version !== entry.version ||
      current.contentHash !== entry.contentHash ||
      current.contentHash !== stableHash(current.content) ||
      entry.versions.some((version, index) => version.version !== index + 1)) {
    throw new RepositoryKnowledgeError(
      "repository_knowledge_integrity_invalid",
      "Knowledge history failed integrity validation.");
  }
}
