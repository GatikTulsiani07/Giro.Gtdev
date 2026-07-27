import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  DEFAULT_KNOWLEDGE_QUOTAS,
  MemoryRepositoryKnowledgeStore,
  PostgresRepositoryKnowledgeStore,
  RepositoryKnowledgeEngine,
  RepositoryKnowledgeError,
  knowledgeIdentity,
  type CreateKnowledgeInput,
  type KnowledgeQuotas,
  type RepositoryKnowledgeEntry,
} from "../services/repositoryKnowledge/index.js";

const now = new Date("2099-08-17T00:00:00.000Z");
const revision = "a".repeat(40);
const hash = (value: string) => value.repeat(64).slice(0, 64);
const quotas: KnowledgeQuotas = {
  ...DEFAULT_KNOWLEDGE_QUOTAS,
  entriesPerRepository: 10,
  versionsPerEntry: 3,
  factsPerVersion: 10,
  sourcesPerVersion: 10,
  diagnosticsPerVersion: 10,
  contentBytes: 10_000,
  memoriesPerRepository: 10,
  retainedEntries: 1,
  retainedVersions: 3,
  retainedMemories: 1,
  writeTimeoutMs: 1_000,
};

function input(
  overrides: Partial<CreateKnowledgeInput> = {},
): CreateKnowledgeInput {
  return {
    tenantId: "user-1",
    ownerId: "user-1",
    repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    namespace: "architecture",
    subject: "request routing",
    content: {
      schemaVersion: "repository-knowledge-schema-v1",
      summary: "Requests use a deterministic routing boundary.",
      facts: [{
        key: "router",
        value: "Hono",
        evidence: ["src/app.ts", "src/app.ts"],
      }],
      tags: ["Backend", "routing"],
    },
    sources: [{
      sourceId: "graph-1",
      sourceType: "repository_graph",
      repositoryId: "acme/widgets",
      repositoryRevision: revision,
      sourceVersion: "graph-v1",
      contentHash: hash("1"),
      executionId: null,
      published: true,
      publishedAt: now.toISOString(),
    }],
    confidence: 0.9,
    executionId: "execution-1",
    baseVersion: 0,
    ...overrides,
  };
}

test("knowledge identity, content, diagnostics, and ordering are deterministic",
  async () => {
    const left = await new MemoryRepositoryKnowledgeStore()
      .create(input(), quotas, now);
    const right = await new MemoryRepositoryKnowledgeStore().create(input({
      content: {
        ...input().content,
        facts: [{
          key: "router", value: "Hono",
          evidence: ["src/app.ts", "src/app.ts"],
        }],
        tags: ["routing", "Backend"],
      },
    }), quotas, now);
    assert.deepEqual(left, right);
    assert.equal(left.knowledgeId, knowledgeIdentity(input()));
    assert.equal(left.lifecycle, "active");
    assert.equal(left.versions[0]?.diagnostics.length, 1);
    assert.deepEqual(left.versions[0]?.content.tags, ["backend", "routing"]);
    assert.ok(Object.isFrozen(left));
  });

test("namespaces are isolated and retrieval filters revision, execution, confidence, and version",
  async () => {
    const store = new MemoryRepositoryKnowledgeStore();
    const architecture = await store.create(input(), quotas, now);
    const testing = await store.create(input({
      namespace: "testing",
      subject: "request tests",
      executionId: "execution-2",
      content: {
        schemaVersion: "repository-knowledge-schema-v1",
        summary: "Request tests use node test.",
        facts: [{ key: "runner", value: "node:test", evidence: ["tests"] }],
        tags: ["testing"],
      },
    }), quotas, now);
    assert.deepEqual((await store.retrieve({
      tenantId: "user-1", ownerId: "user-1",
      repositoryId: "acme/widgets", namespace: "architecture",
      repositoryRevision: revision, executionId: "execution-1",
      minimumConfidence: 0.8, version: 1,
    })).map((result) => result.knowledgeId), [architecture.knowledgeId]);
    assert.deepEqual((await store.retrieve({
      tenantId: "user-1", ownerId: "user-1",
      repositoryId: "acme/widgets", namespace: "testing",
    })).map((result) => result.knowledgeId), [testing.knowledgeId]);
    assert.deepEqual(await store.retrieve({
      tenantId: "user-1", ownerId: "user-1",
      repositoryId: "acme/widgets", executionId: "execution-missing",
    }), []);
  });

test("evolution appends immutable history, fences versions, and merges deterministically",
  async () => {
    const store = new MemoryRepositoryKnowledgeStore();
    const first = await store.create(input(), quotas, now);
    const evolved = await store.create(input({
      baseVersion: 1,
      merge: true,
      content: {
        schemaVersion: "repository-knowledge-schema-v1",
        summary: "Requests use Hono routing and ownership checks.",
        facts: [{
          key: "ownership", value: "repository scoped",
          evidence: ["src/routes.ts"],
        }],
        tags: ["routing", "security"],
      },
      sources: [...input().sources, {
        ...input().sources[0]!,
        sourceId: "review-1",
        sourceType: "review",
        sourceVersion: "review-v1",
        contentHash: hash("2"),
        executionId: "execution-1",
      }],
    }), quotas, new Date(now.getTime() + 1));
    assert.equal(evolved.version, 2);
    assert.equal(evolved.versions.length, 2);
    assert.equal(evolved.supersessions[0]?.supersededVersion, 1);
    assert.equal(evolved.supersessions[0]?.reason, "deterministic_merge");
    assert.deepEqual(evolved.versions[0], first.versions[0]);
    assert.deepEqual(
      evolved.versions[1]?.content.facts.map((fact) => fact.key),
      ["ownership", "router"]);
    await assert.rejects(() => store.create(input({
      baseVersion: 1,
    }), quotas, now), (error: unknown) =>
      error instanceof RepositoryKnowledgeError &&
      error.code === "repository_knowledge_stale_version");
  });

test("ownership, publication, namespace, schema, and quotas are enforced",
  async () => {
    const store = new MemoryRepositoryKnowledgeStore();
    await assert.rejects(() => store.create(input({
      repositoryOwnerId: "user-2",
    }), quotas, now), /another owner/);
    await assert.rejects(() => store.create(input({
      sources: [{ ...input().sources[0]!, published: false }],
    }), quotas, now), (error: unknown) =>
      error instanceof RepositoryKnowledgeError &&
      error.code === "repository_knowledge_source_unpublished");
    await assert.rejects(() => store.create(input({
      namespace: "invalid" as "architecture",
    }), quotas, now), /Namespace/);
    await assert.rejects(() => store.create(input({
      content: { ...input().content, schemaVersion: "unknown" },
    }), quotas, now), /durable schema/);
    await assert.rejects(() => store.create(input({
      content: {
        ...input().content,
        facts: Array.from({ length: 11 }, (_, index) => ({
          key: `key-${index}`, value: "value", evidence: [],
        })),
      },
    }), quotas, now), /durable schema/);
  });

test("agent memories are immutable, repository scoped, and expire through audit metadata",
  async () => {
    const store = new MemoryRepositoryKnowledgeStore();
    const entry = await store.create(input(), quotas, now);
    const remember = {
      tenantId: entry.tenantId,
      ownerId: entry.ownerId,
      repositoryId: entry.repositoryId,
      repositoryRevision: entry.repositoryRevision,
      executionId: "execution-1",
      agentId: "agent-1",
      runtimeVersion: "runtime-v1",
      knowledgeId: entry.knowledgeId,
      knowledgeVersion: entry.version,
      memoryScope: "execution" as const,
      confidence: 0.9,
      retrievalMetadata: {
        queryHash: hash("3"),
        namespace: entry.namespace,
        rank: 1,
        score: 0.9,
        retrievedKnowledgeIds: [entry.knowledgeId],
      },
      expiresAt: new Date(now.getTime() + 1_000).toISOString(),
    };
    const first = await store.remember(remember, quotas, now);
    const replay = await store.remember(
      remember, quotas, new Date(now.getTime() + 1));
    assert.deepEqual(replay, first);
    assert.equal((await store.listMemories(
      entry.tenantId, entry.repositoryId, entry.ownerId)).length, 1);
    assert.equal(await store.recover(
      new Date(now.getTime() + 2_000), quotas), 1);
    assert.deepEqual(await store.listMemories(
      entry.tenantId, entry.repositoryId, entry.ownerId), []);
    assert.equal((await store.metrics()).recoveryCount, 1);
  });

test("recovery preserves corrupt and abandoned entry audit history; retention is bounded",
  async () => {
    const store = new MemoryRepositoryKnowledgeStore();
    const first = await store.create(input(), quotas, now);
    const abandoned: RepositoryKnowledgeEntry = {
      ...first,
      knowledgeId: "knowledge_abandoned",
      subject: "abandoned",
      lifecycle: "created",
      writeLeaseExpiresAt: new Date(now.getTime() - 1).toISOString(),
    };
    store.hydrate(abandoned);
    assert.equal(await store.recover(now, quotas), 1);
    const recovered = await store.get(
      abandoned.tenantId, abandoned.knowledgeId, abandoned.ownerId);
    assert.equal(recovered?.lifecycle, "expired");
    assert.equal(recovered?.recoveryHistory.at(-1)?.reason, "abandoned_write");
    await store.archive(
      first.tenantId, first.knowledgeId, first.ownerId, 1, now);
    assert.equal(await store.collect("user-1", quotas), 1);
    await assert.doesNotReject(() => store.verify(quotas));
  });

test("PostgreSQL adapter is equivalent to memory and uses CAS persistence",
  async () => {
    let state: RepositoryKnowledgeEntry | null = null;
    const client = {
      rpc(name: string, parameters: Record<string, unknown> = {}) {
        let data: unknown;
        if (name === "get_repository_knowledge_entry") {
          data = state ? [{ entry: structuredClone(state) }] : [];
        } else if (name === "list_repository_knowledge_entries") {
          data = [{ entries: state ? [structuredClone(state)] : [] }];
        } else if (name === "save_repository_knowledge_entry") {
          state = structuredClone(
            parameters.input_entry as RepositoryKnowledgeEntry);
          data = [{ entry: structuredClone(state) }];
        } else if (name === "verify_repository_knowledge_contract") {
          data = [{ valid: true, problems: [] }];
        } else data = [];
        return Promise.resolve({ data, error: null });
      },
    };
    const expected = await new MemoryRepositoryKnowledgeStore()
      .create(input(), quotas, now);
    const postgres = new PostgresRepositoryKnowledgeStore(client);
    const actual = await postgres.create(input(), quotas, now);
    assert.deepEqual(actual, expected);
    assert.deepEqual(await postgres.retrieve({
      tenantId: "user-1", ownerId: "user-1",
      repositoryId: "acme/widgets", namespace: "architecture",
    }), await new Promise(async (resolve) => {
      const memory = new MemoryRepositoryKnowledgeStore();
      memory.hydrate(expected);
      resolve(await memory.retrieve({
        tenantId: "user-1", ownerId: "user-1",
        repositoryId: "acme/widgets", namespace: "architecture",
      }));
    }));
    await assert.doesNotReject(() => postgres.verify());
  });

test("metrics, startup, migration contracts, and safety boundaries are complete",
  async () => {
    const engine = new RepositoryKnowledgeEngine(
      new MemoryRepositoryKnowledgeStore(), quotas, {
        info() {}, warn() {}, error() {}, debug() {}, async flush() {},
      });
    await engine.create(input());
    await engine.retrieve({
      tenantId: "user-1", ownerId: "user-1",
      repositoryId: "acme/widgets",
    });
    const metrics = await engine.metrics();
    assert.equal(metrics.knowledgeEntries, 1);
    assert.equal(metrics.namespaceUsage.architecture, 1);
    assert.equal(metrics.confidenceDistribution.high, 1);
    const registry = new MetricsRegistry({
      processStartTimeSeconds: 0, uptimeSeconds: () => 1,
    });
    registry.recordRepositoryKnowledge(metrics);
    for (const metric of [
      "giro_repository_knowledge_entries",
      "giro_repository_knowledge_retrieval_latency_ms_total",
      "giro_repository_knowledge_supersessions_total",
      "giro_repository_knowledge_namespace_usage",
      "giro_repository_agent_memory_growth",
      "giro_repository_knowledge_confidence",
      "giro_repository_knowledge_recoveries_total",
    ]) assert.match(registry.render(), new RegExp(metric));

    const [migration, startup, sources] = await Promise.all([
      readFile(new URL(
        "../../supabase/migrations/20260817000000_add_repository_knowledge_agent_memory_engine.sql",
        import.meta.url), "utf8"),
      readFile(new URL("../index.ts", import.meta.url), "utf8"),
      Promise.all([
        readFile(new URL(
          "../services/repositoryKnowledge/store.ts", import.meta.url), "utf8"),
        readFile(new URL(
          "../services/repositoryKnowledge/validation.ts", import.meta.url),
        "utf8"),
      ]).then((values) => values.join("\n")),
    ]);
    for (const table of [
      "repository_knowledge_namespaces", "repository_knowledge",
      "repository_knowledge_versions", "repository_knowledge_sources",
      "repository_knowledge_diagnostics",
      "repository_knowledge_supersessions", "repository_agent_memory",
      "repository_knowledge_memory_expirations",
      "repository_knowledge_archives", "repository_knowledge_retention",
    ]) assert.match(migration,
      new RegExp(`create table if not exists public\\.${table}`));
    for (const contract of [
      "foreign key", "create index", "check\\(",
      "enable row level security", "grant execute",
      "verify_repository_knowledge_contract",
      "collect_repository_knowledge", "repository_knowledge_retrieval_idx",
    ]) assert.match(migration.toLowerCase(), new RegExp(contract));
    assert.ok(startup.indexOf("runtimeRepositoryKnowledgeEngine.verify") <
      startup.indexOf("server = serve"));
    for (const forbidden of [
      "node:fs", "child_process", "simple-git", "exec(", "spawn(",
      "writeFile", "fetch(", "axios", "git.", "createBranch",
    ]) assert.doesNotMatch(sources,
      new RegExp(forbidden.replace(".", "\\.").replace("(", "\\(")));
  });
