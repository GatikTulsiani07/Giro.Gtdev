import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigrations,
  postgresAvailability,
  psql,
  scalar,
  seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const revision = "a".repeat(40);
const timestamp = "2099-08-17T00:00:00.000Z";
const knowledgeId = `knowledge_${"1".repeat(24)}`;
const contentHash = "2".repeat(64);
const sourceHash = "3".repeat(64);

function knowledgeState(overrides = {}) {
  const source = {
    sourceId: "graph-1",
    sourceType: "repository_graph",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    sourceVersion: "graph-v1",
    contentHash: sourceHash,
    executionId: null,
    published: true,
    publishedAt: timestamp,
  };
  const diagnostic = {
    diagnosticId: `knowledge_diagnostic_${"4".repeat(24)}`,
    knowledgeId,
    knowledgeVersion: 1,
    severity: "info",
    code: "knowledge_schema_validated",
    message: "Knowledge content and publication sources were validated.",
    createdAt: timestamp,
  };
  const content = {
    schemaVersion: "repository-knowledge-schema-v1",
    summary: "Requests use a deterministic routing boundary.",
    facts: [{ key: "router", value: "Hono", evidence: ["src/app.ts"] }],
    tags: ["backend", "routing"],
  };
  const version = {
    knowledgeId,
    version: 1,
    contentHash,
    content,
    sourceReferences: [source],
    diagnostics: [diagnostic],
    confidence: 0.9,
    executionId: "execution-1",
    mergedFromVersions: [],
    deterministicSeed: "5".repeat(64),
    createdAt: timestamp,
    validatedAt: timestamp,
    activatedAt: timestamp,
  };
  return {
    knowledgeId,
    schemaVersion: "repository-knowledge-schema-v1",
    persistenceVersion: 1,
    tenantId: "user-1",
    ownerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    namespace: "architecture",
    subject: "request routing",
    contentHash,
    sourceType: "repository_graph",
    confidence: 0.9,
    version: 1,
    lifecycle: "active",
    versions: [version],
    supersessions: [],
    lifecycleHistory: [],
    recoveryHistory: [],
    archiveMetadata: null,
    writeLeaseExpiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test("PostgreSQL knowledge engine enforces history, sources, memory immutability, CAS, RLS, metrics, recovery, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set status='indexed',
          current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);

      const initial = knowledgeState();
      const saved = JSON.parse(scalar(url, `
        select entry from public.save_repository_knowledge_entry(
          ${json(initial)},null
        )
      `));
      assert.equal(saved.knowledgeId, knowledgeId);
      assert.equal(scalar(url,
        "select count(*) from public.repository_knowledge_versions"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_knowledge_sources"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_knowledge_diagnostics"), "1");
      assert.equal(scalar(url, `
        select jsonb_array_length(entries)
        from public.list_repository_knowledge_entries(
          'user-1','acme/widgets'
        )
      `), "1");
      assert.equal(scalar(url, `
        select entry is null from public.get_repository_knowledge_entry(
          'user-2','${knowledgeId}'
        )
      `), "");

      const stale = psql(url, `
        select entry from public.save_repository_knowledge_entry(
          ${json({ ...initial, persistenceVersion: 2 })},'0'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_knowledge_version_conflict/);

      const unpublished = knowledgeState({
        versions: [{
          ...initial.versions[0],
          sourceReferences: [{
            ...initial.versions[0].sourceReferences[0],
            published: false,
            publishedAt: null,
          }],
        }],
      });
      const rejected = psql(url, `
        select entry from public.save_repository_knowledge_entry(
          ${json(unpublished)},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /repository_knowledge_source_unpublished/);

      const memory = {
        memoryId: `agent_memory_${"6".repeat(24)}`,
        schemaVersion: "repository-agent-memory-v1",
        tenantId: "user-1",
        ownerId: "user-1",
        agentId: "agent-1",
        runtimeVersion: "runtime-v1",
        repositoryId: "acme/widgets",
        repositoryRevision: revision,
        executionId: "execution-1",
        knowledgeId,
        knowledgeVersion: 1,
        memoryScope: "execution",
        confidence: 0.9,
        retrievalMetadata: {
          queryHash: "7".repeat(64),
          namespace: "architecture",
          rank: 1,
          score: 0.9,
          retrievedKnowledgeIds: [knowledgeId],
        },
        contentHash,
        createdAt: timestamp,
        expiresAt: "2099-08-17T00:00:01.000Z",
      };
      const savedMemory = JSON.parse(scalar(url, `
        select memory from public.save_repository_agent_memory(${json(memory)})
      `));
      assert.equal(savedMemory.memoryId, memory.memoryId);
      assert.equal(scalar(url, `
        select jsonb_array_length(memories)
        from public.list_repository_agent_memories('user-1','acme/widgets')
      `), "1");
      const memoryConflict = psql(url, `
        select memory from public.save_repository_agent_memory(
          ${json({ ...memory, confidence: 0.8 })}
        )
      `, { allowFailure: true });
      assert.notEqual(memoryConflict.status, 0);
      assert.match(memoryConflict.stderr, /repository_memory_immutable_conflict/);
      assert.equal(scalar(url, `
        select expired_count from public.expire_repository_agent_memories(
          '2099-08-17T00:00:02.000Z'::timestamptz
        )
      `), "1");
      assert.equal(scalar(url, `
        select jsonb_array_length(memories)
        from public.list_repository_agent_memories('user-1','acme/widgets')
      `), "0");

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_knowledge_metrics('user-1')
      `));
      assert.equal(metrics.knowledgeEntries, 1);
      assert.equal(metrics.namespaceUsage.architecture, 1);
      assert.equal(metrics.memoryGrowth, 1);
      assert.equal(metrics.confidenceDistribution.high, 1);
      assert.equal(metrics.recoveryCount, 1);
      assert.equal(scalar(url, `
        select valid from public.verify_repository_knowledge_contract(
          'repository-knowledge-engine-v1',
          'repository-knowledge-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_knowledge'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_knowledge','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_repository_knowledge_entry(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count from public.collect_repository_knowledge(
          'user-1',1,3,1
        )
      `), "0");
    });
  });
