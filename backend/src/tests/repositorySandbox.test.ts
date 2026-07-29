import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MetricsRegistry } from "../observability/metrics.js";
import {
  MemoryRepositorySandboxStore,
  PostgresRepositorySandboxStore,
  type RepositorySandboxStore,
} from "../services/repositorySandbox/store.js";
import {
  DEFAULT_SANDBOX_QUOTAS,
  RepositorySandboxService,
} from "../services/repositorySandbox/service.js";
import type {
  CreateSandboxInput,
  RepositorySandbox,
  SandboxQuotas,
} from "../services/repositorySandbox/types.js";
import { RepositorySandboxError } from "../services/repositorySandbox/types.js";

const quotas: SandboxQuotas = {
  ...DEFAULT_SANDBOX_QUOTAS,
  activePerOwner: 4,
  activeLeasesPerOwner: 2,
  leaseMs: 1_000,
  preparationTimeoutMs: 500,
  retainedSandboxes: 2,
  retainedRecoveryRecords: 2,
};

function creation(overrides: Partial<CreateSandboxInput> = {}): CreateSandboxInput {
  const repositoryId = overrides.repositoryId ?? "owner/repository";
  const repositoryRevision = overrides.repositoryRevision ?? "revision-1";
  return {
    tenantId: "tenant-1",
    repositoryId,
    workflowId: "workflow-1",
    executionId: "execution-1",
    ownerId: "owner-1",
    repositoryOwnerId: "owner-1",
    workflowOwnerId: "owner-1",
    executionOwnerId: "owner-1",
    repositoryRevision,
    executionRevision: repositoryRevision,
    repositoryAccess: true,
    workspaceRootBase: "/durable/sandboxes",
    repositorySnapshot: {
      repositoryId,
      repositoryRevision,
      contentFingerprint: "snapshot-content-1",
    },
    manifest: { packageManager: "pnpm", scripts: ["build", "test"] },
    dependencyMetadata: { lockfile: "pnpm-lock.yaml", digest: "deps-1" },
    ...overrides,
  };
}

async function ready(
  store: RepositorySandboxStore,
  input = creation(),
  createdAt = new Date("2026-07-29T00:00:00.000Z"),
) {
  const sandbox = await store.create(input, quotas, createdAt);
  return store.prepare(
    input.tenantId, input.ownerId, input.repositoryId, sandbox.sandboxId,
    new Date(createdAt.getTime() + 25),
  );
}

test("sandbox IDs, workspace roots, snapshots, and fingerprints are deterministic", async () => {
  const left = new MemoryRepositorySandboxStore();
  const right = new MemoryRepositorySandboxStore();
  const now = new Date("2026-07-29T00:00:00.000Z");
  const first = await left.create(creation(), quotas, now);
  const replay = await left.create(creation(), quotas, now);
  const second = await right.create(creation(), quotas, now);
  assert.equal(first.sandboxId, replay.sandboxId);
  assert.equal(first.sandboxId, second.sandboxId);
  assert.equal(first.workspaceRoot, second.workspaceRoot);
  assert.equal(first.workspace.workspaceFingerprint, second.workspace.workspaceFingerprint);
  assert.equal(first.workspace.repositorySnapshot.snapshotId,
    second.workspace.repositorySnapshot.snapshotId);
  assert.match(first.workspaceRoot, /^\/durable\/sandboxes\/tenant_/);
});

test("concurrent workflows receive isolated immutable workspace metadata", async () => {
  const store = new MemoryRepositorySandboxStore();
  const [first, second] = await Promise.all([
    store.create(creation({ workflowId: "workflow-a", executionId: "execution-a" }), quotas),
    store.create(creation({ workflowId: "workflow-b", executionId: "execution-b" }), quotas),
  ]);
  assert.notEqual(first.sandboxId, second.sandboxId);
  assert.notEqual(first.workspaceRoot, second.workspaceRoot);
  assert.notEqual(first.workspace.workspaceFingerprint, second.workspace.workspaceFingerprint);
  assert.deepEqual(first.workspace.manifest, second.workspace.manifest);
});

test("tenant, repository, workflow, execution, and revision fences reject cross-boundary access", async () => {
  const store = new MemoryRepositorySandboxStore();
  const sandbox = await ready(store);
  assert.equal(await store.get(
    "tenant-2", "owner-1", sandbox.repositoryId, sandbox.sandboxId,
  ), null);
  assert.equal(await store.get(
    sandbox.tenantId, "owner-2", sandbox.repositoryId, sandbox.sandboxId,
  ), null);
  assert.equal(await store.get(
    sandbox.tenantId, sandbox.ownerId, "other/repository", sandbox.sandboxId,
  ), null);
  await assert.rejects(
    () => store.create(creation({ executionRevision: "stale-revision" }), quotas),
    (error: unknown) => error instanceof RepositorySandboxError &&
      error.code === "repository_sandbox_revision_fence_rejected",
  );
  await assert.rejects(
    () => store.create(creation({ repositoryAccess: false }), quotas),
    (error: unknown) => error instanceof RepositorySandboxError &&
      error.code === "repository_sandbox_access_denied",
  );
});

test("lease acquire, renewal, release, ownership, quota, and stale fencing are deterministic", async () => {
  const store = new MemoryRepositorySandboxStore();
  const started = new Date("2026-07-29T00:00:00.000Z");
  const sandbox = await ready(store, creation(), started);
  const claim = await store.acquire(
    sandbox.tenantId, sandbox.ownerId, sandbox.repositoryId, sandbox.sandboxId,
    "worker-1", 1_000, quotas, new Date(started.getTime() + 50),
  );
  const identicalStore = new MemoryRepositorySandboxStore();
  const identicalSandbox = await ready(identicalStore, creation(), started);
  const identical = await identicalStore.acquire(
    identicalSandbox.tenantId, identicalSandbox.ownerId,
    identicalSandbox.repositoryId, identicalSandbox.sandboxId,
    "worker-1", 1_000, quotas, new Date(started.getTime() + 50),
  );
  assert.equal(claim.claimToken, identical.claimToken);
  const renewed = await store.renew(claim, 1_000, new Date(started.getTime() + 100));
  assert.equal(renewed.claimToken, claim.claimToken);
  const released = await store.release(renewed, new Date(started.getTime() + 150));
  assert.equal(released.lifecycle, "released");
  assert.equal(released.leases[0]?.renewals, 1);
  await assert.rejects(
    () => store.renew(claim, 1_000, new Date(started.getTime() + 200)),
    (error: unknown) => error instanceof RepositorySandboxError &&
      error.code === "repository_sandbox_stale_lease",
  );

  const quotaStore = new MemoryRepositorySandboxStore();
  const oneLeaseQuota = { ...quotas, activeLeasesPerOwner: 1 };
  const first = await ready(quotaStore, creation({
    workflowId: "workflow-a", executionId: "execution-a",
  }), started);
  const second = await ready(quotaStore, creation({
    workflowId: "workflow-b", executionId: "execution-b",
  }), started);
  await quotaStore.acquire(
    first.tenantId, first.ownerId, first.repositoryId, first.sandboxId,
    "worker-a", 1_000, oneLeaseQuota, new Date(started.getTime() + 50),
  );
  await assert.rejects(() => quotaStore.acquire(
    second.tenantId, second.ownerId, second.repositoryId, second.sandboxId,
    "worker-b", 1_000, oneLeaseQuota, new Date(started.getTime() + 50),
  ), (error: unknown) => error instanceof RepositorySandboxError &&
    error.code === "repository_sandbox_lease_quota_exceeded");
});

test("sandbox quota validation counts only active isolated sandboxes", async () => {
  const store = new MemoryRepositorySandboxStore();
  const limited = { ...quotas, activePerOwner: 1 };
  await store.create(creation(), limited);
  await assert.rejects(
    () => store.create(creation({
      workflowId: "workflow-2", executionId: "execution-2",
    }), limited),
    (error: unknown) => error instanceof RepositorySandboxError &&
      error.code === "repository_sandbox_quota_exceeded",
  );
  await assert.doesNotReject(() => store.create(creation({
    tenantId: "tenant-2", workflowId: "workflow-2", executionId: "execution-2",
  }), limited));
});

test("recovery handles expired leases, abandoned creation, and failed preparation", async () => {
  const store = new MemoryRepositorySandboxStore();
  const started = new Date("2026-07-29T00:00:00.000Z");
  const leased = await ready(store, creation(), started);
  await store.acquire(
    leased.tenantId, leased.ownerId, leased.repositoryId, leased.sandboxId,
    "worker-1", 100, quotas, new Date(started.getTime() + 50),
  );
  const abandoned = await store.create(creation({
    workflowId: "workflow-abandoned", executionId: "execution-abandoned",
  }), quotas, started);
  const failed = await store.create(creation({
    workflowId: "workflow-failed", executionId: "execution-failed",
  }), quotas, new Date(started.getTime() + 400));
  await store.failPreparation(
    failed.tenantId, failed.ownerId, failed.repositoryId, failed.sandboxId,
    "manifest invalid", new Date(started.getTime() + 450),
  );
  assert.equal(await store.recover(new Date(started.getTime() + 600), quotas), 3);
  assert.equal((await store.get(
    leased.tenantId, leased.ownerId, leased.repositoryId, leased.sandboxId,
  ))?.lifecycle, "released");
  assert.equal((await store.get(
    abandoned.tenantId, abandoned.ownerId, abandoned.repositoryId, abandoned.sandboxId,
  ))?.lifecycle, "failed");
  assert.equal((await store.get(
    failed.tenantId, failed.ownerId, failed.repositoryId, failed.sandboxId,
  ))?.lifecycle, "creating");
});

test("metrics track creation, active leases, renewals, recovery, latency, and archives", async () => {
  const store = new MemoryRepositorySandboxStore();
  const started = new Date("2026-07-29T00:00:00.000Z");
  const sandbox = await ready(store, creation(), started);
  const claim = await store.acquire(
    sandbox.tenantId, sandbox.ownerId, sandbox.repositoryId, sandbox.sandboxId,
    "worker-1", 1_000, quotas, new Date(started.getTime() + 50),
  );
  const renewed = await store.renew(claim, 1_000, new Date(started.getTime() + 100));
  await store.release(renewed, new Date(started.getTime() + 150));
  await store.archive(
    sandbox.tenantId, sandbox.ownerId, sandbox.repositoryId, sandbox.sandboxId,
    new Date(started.getTime() + 200),
  );
  const metrics = await store.metrics("tenant-1", new Date(started.getTime() + 250));
  assert.deepEqual(metrics, {
    sandboxCreation: 1,
    activeLeases: 0,
    leaseRenewals: 1,
    recoveryCount: 0,
    preparationLatencyMs: 25,
    archiveCount: 1,
  });
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0,
    uptimeSeconds: () => 1,
  });
  registry.recordRepositorySandbox(metrics);
  const rendered = registry.render();
  for (const metric of [
    "giro_repository_sandbox_creation_total",
    "giro_repository_sandbox_active_leases",
    "giro_repository_sandbox_lease_renewals_total",
    "giro_repository_sandbox_recoveries_total",
    "giro_repository_sandbox_preparation_latency_ms_total",
    "giro_repository_sandbox_archives_total",
  ]) assert.match(rendered, new RegExp(metric));
});

class FakeSandboxDatabase {
  readonly states = new Map<string, RepositorySandbox>();
  readonly calls: string[] = [];

  rpc(name: string, parameters: Record<string, unknown> = {}) {
    this.calls.push(name);
    let data: unknown;
    if (name === "list_repository_sandboxes_for_owner") {
      data = [...this.states.values()].filter((sandbox) =>
        sandbox.tenantId === parameters.input_tenant_id &&
        sandbox.ownerId === parameters.input_owner_id);
    } else if (name === "get_repository_sandbox") {
      const sandbox = this.states.get(
        `${parameters.input_tenant_id}\0${parameters.input_sandbox_id}`,
      );
      data = sandbox && sandbox.ownerId === parameters.input_owner_id &&
        sandbox.repositoryId === parameters.input_repository_id ? sandbox : [];
    } else if (name === "save_repository_sandbox") {
      const sandbox = structuredClone(parameters.input_sandbox as RepositorySandbox);
      this.states.set(`${sandbox.tenantId}\0${sandbox.sandboxId}`, sandbox);
      data = sandbox;
    } else if (name === "verify_repository_sandbox_contract") {
      data = [{ valid: true, problems: [] }];
    } else {
      data = 0;
    }
    return Promise.resolve({ data, error: null });
  }
}

test("memory and PostgreSQL adapters produce equivalent deterministic lifecycle state", async () => {
  const memory = new MemoryRepositorySandboxStore();
  const database = new FakeSandboxDatabase();
  const postgres = new PostgresRepositorySandboxStore(database);
  const now = new Date("2026-07-29T00:00:00.000Z");
  const memoryReady = await ready(memory, creation(), now);
  const postgresReady = await ready(postgres, creation(), now);
  assert.deepEqual(postgresReady, memoryReady);
  const memoryClaim = await memory.acquire(
    memoryReady.tenantId, memoryReady.ownerId, memoryReady.repositoryId,
    memoryReady.sandboxId, "worker-1", 1_000, quotas,
    new Date(now.getTime() + 50),
  );
  const postgresClaim = await postgres.acquire(
    postgresReady.tenantId, postgresReady.ownerId, postgresReady.repositoryId,
    postgresReady.sandboxId, "worker-1", 1_000, quotas,
    new Date(now.getTime() + 50),
  );
  assert.deepEqual(postgresClaim, memoryClaim);
  const memoryReleased = await memory.release(memoryClaim, new Date(now.getTime() + 100));
  const postgresReleased = await postgres.release(
    postgresClaim, new Date(now.getTime() + 100),
  );
  assert.deepEqual(postgresReleased, memoryReleased);
  await assert.doesNotReject(() => postgres.verify());
  assert.ok(database.calls.includes("verify_repository_sandbox_contract"));
});

test("service startup validation delegates to storage without repository execution", async () => {
  const store = new MemoryRepositorySandboxStore();
  const service = new RepositorySandboxService(store, quotas);
  await assert.doesNotReject(() => service.verify());
  const source = await readFile(new URL(
    "../services/repositorySandbox/store.ts", import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /simple-git|child_process|execFile|spawn\(/);
});

test("migration defines durable schema, indexes, constraints, RLS, grants, and retention", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260820000000_add_repository_sandbox_execution_environment.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "repository_sandboxes",
    "repository_sandbox_leases",
    "repository_sandbox_recoveries",
    "repository_sandbox_archives",
    "repository_sandbox_retention",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  for (const contract of [
    "repository_sandbox_one_active_lease_idx",
    "repository_sandbox_lease_sandbox_fk",
    "repository_sandbox_recovery_sandbox_fk",
    "repository_sandbox_archive_sandbox_fk",
    "verify_repository_sandbox_contract",
    "recover_orphan_repository_sandbox_metadata",
    "collect_repository_sandboxes",
    "enable row level security",
    "grant execute on function public.save_repository_sandbox",
    "on delete cascade",
  ]) assert.match(migration, new RegExp(contract));
});
