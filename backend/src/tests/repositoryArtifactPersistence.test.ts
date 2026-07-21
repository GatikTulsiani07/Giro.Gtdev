import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MemoryRepositoryArtifactStore,
  SupabaseRepositoryArtifactStore,
  type RepositoryArtifacts,
} from "../services/repository/artifacts/repositoryArtifactStore.js";
import type { RepositorySnapshotIdentity } from "../services/indexing/snapshots/repositorySnapshotStore.js";

const REVISION_A = "a".repeat(40);
const REVISION_B = "b".repeat(40);
const REVISION_C = "c".repeat(40);

function identity(revision: string, jobId = `job-${revision[0]}`): RepositorySnapshotIdentity {
  return {
    repositoryId: "acme/api",
    revision,
    branch: "main",
    jobId,
    workerId: "worker-1",
    claimToken: `claim-${revision[0]}`,
  };
}

function artifacts(revision: string): RepositoryArtifacts {
  return {
    graph: {
      repositoryId: "acme/api",
      repositoryVersion: revision,
      nodes: [{ symbolId: `symbol-${revision[0]}`, name: "main", kind: "function", file: "src/main.ts", line: 1, language: "typescript", repositoryVersion: revision }],
      edges: [],
    } as never,
    summary: { repositoryId: "acme/api", repositoryVersion: revision, generatedAt: "2026-07-21T00:00:00.000Z" } as never,
    fileSnapshot: {
      updatedAt: "2026-07-21T00:00:00.000Z",
      files: [{ filePath: "src/main.ts", size: revision.charCodeAt(0), language: "typescript", lastSeenAt: "2026-07-21T00:00:00.000Z" }],
    },
    symbolIndex: [{ filePath: "src/main.ts", symbolName: `main${revision[0]}`, kind: "function", startLine: 1, endLine: 1 }],
    graphSource: [{ filePath: "src/main.ts", language: "typescript", symbols: [], imports: [] }] as never,
  };
}

async function publish(store: MemoryRepositoryArtifactStore, revision: string): Promise<void> {
  const key = identity(revision);
  store.begin(key);
  await store.stage(key, artifacts(revision));
  store.publish(key);
}

test("memory artifacts persist every artifact with revision isolation", async () => {
  const store = new MemoryRepositoryArtifactStore();
  await publish(store, REVISION_A);
  await publish(store, REVISION_B);

  const first = await store.load("acme/api", REVISION_A);
  const current = await store.loadCurrent("acme/api");
  assert.equal(first?.graph.repositoryVersion, REVISION_A);
  assert.equal(first?.summary.repositoryVersion, REVISION_A);
  assert.equal(first?.fileSnapshot.files[0]?.size, REVISION_A.charCodeAt(0));
  assert.equal(first?.symbolIndex[0]?.symbolName, "maina");
  assert.equal(current?.repositoryRevision, REVISION_B);
  assert.equal(current?.graphSource[0]?.filePath, "src/main.ts");

  current!.symbolIndex[0]!.symbolName = "mutated";
  assert.equal((await store.loadCurrent("acme/api"))?.symbolIndex[0]?.symbolName, "mainb");
});

test("failed publication preserves the previous current revision", async () => {
  const store = new MemoryRepositoryArtifactStore();
  await publish(store, REVISION_A);
  const next = identity(REVISION_B);
  store.begin(next);
  await store.stage(next, artifacts(REVISION_B));
  store.discard(next);
  assert.equal((await store.loadCurrent("acme/api"))?.repositoryRevision, REVISION_A);
  assert.equal(await store.load("acme/api", REVISION_B), null);
});

test("publication requires a complete staged bundle and a matching fence", async () => {
  const store = new MemoryRepositoryArtifactStore();
  const key = identity(REVISION_A);
  store.begin(key);
  assert.throws(() => store.publish(key), /not ready/);
  await assert.rejects(
    store.stage({ ...key, claimToken: "stale" }, artifacts(REVISION_A)),
    /lease_conflict/,
  );
});

test("garbage collection retains current and building revisions under concurrent cleanup", async () => {
  const store = new MemoryRepositoryArtifactStore();
  await publish(store, REVISION_A);
  await publish(store, REVISION_B);
  await publish(store, REVISION_C);
  const building = identity("d".repeat(40));
  store.begin(building);
  await Promise.all([store.collect("acme/api", 2), store.collect("acme/api", 2)]);
  assert.equal(await store.load("acme/api", REVISION_A), null);
  assert.equal((await store.loadCurrent("acme/api"))?.repositoryRevision, REVISION_C);
  await store.stage(building, artifacts(building.revision));
  store.publish(building);
  assert.equal((await store.loadCurrent("acme/api"))?.repositoryRevision, building.revision);
});

test("Supabase adapter uses the same revision-keyed artifact contract", async () => {
  const calls: Array<{ name: string; values: Record<string, unknown> }> = [];
  const bundle = artifacts(REVISION_A);
  const client = {
    rpc: async (name: string, values: Record<string, unknown>) => {
      calls.push({ name, values });
      if (name.startsWith("get_")) return { data: [{
        repository_id: "acme/api", repository_revision: REVISION_A,
        graph: bundle.graph, summary: bundle.summary, file_snapshot: bundle.fileSnapshot,
        symbol_index: bundle.symbolIndex, graph_source: bundle.graphSource,
      }], error: null };
      return { data: name === "collect_repository_artifacts" ? 2 : null, error: null };
    },
  };
  const store = new SupabaseRepositoryArtifactStore(client);
  await store.stage(identity(REVISION_A), bundle);
  assert.equal((await store.load("acme/api", REVISION_A))?.repositoryRevision, REVISION_A);
  assert.equal((await store.loadCurrent("acme/api"))?.summary.repositoryVersion, REVISION_A);
  assert.equal(await store.collect("acme/api", 2), 2);
  assert.deepEqual(calls.map((call) => call.name), [
    "stage_repository_artifacts", "get_repository_artifacts",
    "get_current_repository_artifacts", "collect_repository_artifacts",
  ]);
  assert.equal(calls[0]?.values.input_repository_revision, REVISION_A);
});

test("artifact migration is idempotent, fenced, atomic, indexed, and retention-safe", async () => {
  const sql = (await readFile(new URL(
    "../../supabase/migrations/20260725000000_create_durable_repository_artifacts.sql",
    import.meta.url,
  ), "utf8")).toLowerCase();
  for (const contract of [
    "create table if not exists public.repository_artifacts",
    "primary key (repository_id, repository_revision)",
    "repository_artifacts_snapshot_fk",
    "create index if not exists repository_artifacts_revision_idx",
    "stage_repository_artifacts",
    "get_current_repository_artifacts",
    "indexed_revision = input_revision",
    "repository artifacts are not ready to publish",
    "status <> 'building'",
    "for update",
    "service_role",
  ]) assert.ok(sql.includes(contract), `missing artifact contract: ${contract}`);
  assert.doesNotMatch(sql, /delete from public\.repository_artifacts[\s\S]*status = 'building'/);
});
