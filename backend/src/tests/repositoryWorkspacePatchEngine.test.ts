import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  DEFAULT_WORKSPACE_QUOTAS, MemoryRepositoryWorkspaceStore,
  RepositoryWorkspaceError, RepositoryWorkspacePatchEngine,
  type CreateWorkspaceInput, type GeneratePatchInput,
  type RepositoryWorkspace, type WorkspaceClaim, type WorkspaceQuotas,
} from "../services/repositoryWorkspace/index.js";

const now = new Date("2099-08-12T00:00:00.000Z");
const revision = "a".repeat(40);
const quotas: WorkspaceQuotas = {
  ...DEFAULT_WORKSPACE_QUOTAS,
  activePerOwner: 4, patchesPerWorkspace: 4,
  fileOperationsPerPatch: 8, symbolOperationsPerPatch: 8,
  diagnosticsPerPatch: 8, archivedWorkspaces: 1,
  patchHistory: 2, retainedDiagnostics: 2,
};

function creation(overrides: Partial<CreateWorkspaceInput> = {}): CreateWorkspaceInput {
  return {
    tenantId: "user-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, executionId: "execution-1",
    workUnitId: "work-unit-1", ownerId: "user-1",
    repositoryOwnerId: "user-1", executionOwnerId: "user-1",
    snapshot: {
      published: true, tenantId: "user-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, snapshotVersion: "snapshot-v1",
      revisionHash: revision, graphVersion: "graph-v1",
      intelligenceVersion: "intelligence-v1", retrievalVersion: "retrieval-v2",
      planningVersion: "planning-v1",
    },
    ...overrides,
  };
}

async function activeWorkspace(
  store = new MemoryRepositoryWorkspaceStore(),
): Promise<{ store: MemoryRepositoryWorkspaceStore; workspace: RepositoryWorkspace; claim: WorkspaceClaim }> {
  let workspace = await store.create(creation(), quotas, now);
  workspace = await store.prepare(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now,
  );
  workspace = await store.markReady(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now,
  );
  const claim = await store.claim(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId,
    60_000, now,
  );
  workspace = await store.activate(claim, now);
  return { store, workspace, claim };
}

function patchInput(
  claim: WorkspaceClaim,
  overrides: Partial<GeneratePatchInput> = {},
): GeneratePatchInput {
  return {
    claim, basePatchVersion: 0,
    fileOperations: [
      { operation: "update_file", path: "src/z.ts", content: "export const z = 2;\n",
        expectedContentHash: "z-before" },
      { operation: "create_file", path: "src/a.ts", content: "export const a = 1;\n" },
    ],
    symbolOperations: [
      { operation: "update_symbol", filePath: "src/z.ts", symbol: "z",
        declaration: "export const z = 2;", expectedSymbolHash: "z-symbol-before" },
      { operation: "add_symbol", filePath: "src/a.ts", symbol: "a",
        declaration: "export const a = 1;" },
    ],
    diagnostics: [{
      severity: "warning", code: "patch_review_recommended",
      message: "Review the public export.", affectedFiles: ["src/a.ts"],
      affectedSymbols: ["a"],
    }],
    confidence: 0.92,
    ...overrides,
  };
}

test("workspace creation is deterministic, idempotent, immutable, and snapshot-fenced", async () => {
  const left = new MemoryRepositoryWorkspaceStore();
  const right = new MemoryRepositoryWorkspaceStore();
  const first = await left.create(creation(), quotas, now);
  const second = await right.create(creation(), quotas, now);
  assert.equal(first.workspaceId, second.workspaceId);
  assert.equal(first.snapshot.snapshotHash, second.snapshot.snapshotHash);
  assert.deepEqual(await left.create(creation(), quotas, now), first);
  assert.match(first.workspaceId, /^repository_workspace_/);
  assert.throws(() => {
    (first.snapshot as { graphVersion: string }).graphVersion = "changed";
  });
  await assert.rejects(() => left.create(creation({
    workUnitId: "unpublished",
    snapshot: {
      ...creation().snapshot, published: false,
    } as unknown as CreateWorkspaceInput["snapshot"],
  }), quotas, now), (error: unknown) =>
    error instanceof RepositoryWorkspaceError &&
    error.code === "workspace_snapshot_unpublished");
  await assert.rejects(() => left.create(creation({
    workUnitId: "stale-revision",
    snapshot: { ...creation().snapshot, revisionHash: "b".repeat(40) },
  }), quotas, now), /unpublished or outside/);
});

test("ownership, execution scope, lifecycle, and tenant isolation fail closed", async () => {
  const store = new MemoryRepositoryWorkspaceStore();
  const workspace = await store.create(creation(), quotas, now);
  assert.equal(await store.get("user-2", workspace.workspaceId), null);
  await assert.rejects(() => store.prepare(
    workspace.tenantId, workspace.workspaceId, "user-2", now,
  ), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "repository_workspace_ownership_conflict");
  await assert.rejects(() => store.create(creation({
    workUnitId: "foreign-owner", repositoryOwnerId: "user-2",
  }), quotas, now), /ownership must match/);
  await assert.rejects(() => store.markReady(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now,
  ), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "repository_workspace_lifecycle_conflict");
});

test("patch generation is structured, ordered, deterministic, immutable, and never applied", async () => {
  const { store, workspace, claim } = await activeWorkspace();
  assert.equal((await store.beginValidation(claim, now)).lifecycle, "validating");
  const patch = await store.generatePatch(patchInput(claim), quotas, now);
  assert.match(patch.patchId, /^repository_patch_/);
  assert.equal(patch.patchVersion, 1);
  assert.deepEqual(patch.fileOperations.map((item) => item.path), ["src/a.ts", "src/z.ts"]);
  assert.deepEqual(patch.symbolOperations.map((item) => item.symbol), ["a", "z"]);
  assert.equal(patch.snapshotHash, workspace.snapshot.snapshotHash);
  assert.equal((await store.get(workspace.tenantId, workspace.workspaceId))?.patches.length, 1);
  assert.throws(() => {
    (patch.fileOperations as unknown as unknown[]).push({});
  });
  assert.ok(!("apply" in patch) && !("merged" in patch));
});

test("patch versions and snapshot claims are fenced and immutable", async () => {
  const { store, claim } = await activeWorkspace();
  const patch = await store.generatePatch(patchInput(claim), quotas, now);
  await assert.rejects(() => store.generatePatch(patchInput(claim), quotas, now),
    (error: unknown) => error instanceof RepositoryWorkspaceError &&
      error.code === "repository_patch_version_stale");
  await assert.rejects(() => store.generatePatch(patchInput(
    { ...claim, snapshotHash: "stale" },
    { basePatchVersion: patch.patchVersion },
  ), quotas, now), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "repository_workspace_version_conflict");
  const stored = await store.get(claim.tenantId, claim.workspaceId);
  assert.equal(stored?.patches[0]?.patchId, patch.patchId);
});

test("path, duplicate edit, symbol, schema, and quota conflicts are explicit diagnostics", async () => {
  const { store, claim } = await activeWorkspace();
  await assert.rejects(() => store.generatePatch(patchInput(claim, {
    fileOperations: [
      { operation: "create_file", path: "src/a.ts", content: "a" },
      { operation: "delete_file", path: "src/a.ts", expectedContentHash: "old" },
    ],
  }), quotas, now), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "workspace_patch_path_conflict");
  await assert.rejects(() => store.generatePatch(patchInput(claim, {
    fileOperations: [{
      operation: "delete_file", path: "src/a.ts", expectedContentHash: "old",
    }],
    symbolOperations: [{
      operation: "remove_symbol", filePath: "src/a.ts", symbol: "a",
      expectedSymbolHash: "symbol-old",
    }],
  }), quotas, now), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "workspace_patch_symbol_conflict");
  await assert.rejects(() => store.generatePatch(patchInput(claim, {
    fileOperations: [{ operation: "create_file", path: "../escape.ts", content: "" }],
  }), quotas, now), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "workspace_patch_path_invalid");
  const stored = await store.get(claim.tenantId, claim.workspaceId);
  assert.equal(stored?.conflictCount, 2);
  assert.equal(stored?.validationFailureCount, 1);
  assert.equal(stored?.patches.length, 0);
  assert.deepEqual(stored?.diagnostics.map((diagnostic) => diagnostic.severity),
    ["blocker", "blocker", "validation_failure"]);
  assert.deepEqual(stored?.diagnostics.at(-1)?.affectedFiles, ["../escape.ts"]);
});

test("validation failures and quotas never partially publish patches", async () => {
  const { store, claim } = await activeWorkspace();
  await assert.rejects(() => store.generatePatch(patchInput(claim, {
    confidence: 2,
  }), quotas, now), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "workspace_patch_schema_invalid");
  await assert.rejects(() => store.generatePatch(patchInput(claim, {
    fileOperations: Array.from({ length: 9 }, (_, index) => ({
      operation: "create_file" as const, path: `src/${index}.ts`, content: "",
    })),
  }), quotas, now), (error: unknown) => error instanceof RepositoryWorkspaceError &&
    error.code === "workspace_patch_quota_exceeded");
  const stored = await store.get(claim.tenantId, claim.workspaceId);
  assert.equal(stored?.validationFailureCount, 2);
  assert.equal(stored?.patches.length, 0);
});

test("recovery handles expired leases, incomplete patches, abandoned workspaces, and stale snapshots", async () => {
  const expired = await activeWorkspace();
  assert.equal(await expired.store.recover(new Date(now.getTime() + 60_001), quotas), 1);
  assert.equal((await expired.store.get(
    expired.claim.tenantId, expired.claim.workspaceId,
  ))?.lifecycle, "expired");

  const incomplete = await activeWorkspace();
  await incomplete.store.beginValidation(incomplete.claim, now);
  assert.equal(await incomplete.store.recover(now, quotas), 1);
  assert.equal((await incomplete.store.get(
    incomplete.claim.tenantId, incomplete.claim.workspaceId,
  ))?.lifecycle, "active");

  const abandoned = await activeWorkspace();
  abandoned.store.hydrate({ ...abandoned.workspace, lease: null });
  assert.equal(await abandoned.store.recover(now, quotas), 1);
  assert.equal((await abandoned.store.get(
    abandoned.claim.tenantId, abandoned.claim.workspaceId,
  ))?.recoveryHistory.at(-1)?.reason, "abandoned_workspace");

  const stale = await activeWorkspace();
  stale.store.hydrate({
    ...stale.workspace,
    snapshot: { ...stale.workspace.snapshot, graphVersion: "stale-graph" },
  });
  assert.equal(await stale.store.recover(now, quotas), 1);
  assert.equal((await stale.store.get(
    stale.claim.tenantId, stale.claim.workspaceId,
  ))?.recoveryHistory.at(-1)?.reason, "stale_snapshot");
});

test("archive retention, patch retention, diagnostics retention, and metrics are deterministic", async () => {
  const store = new MemoryRepositoryWorkspaceStore();
  const first = await activeWorkspace(store);
  await store.generatePatch(patchInput(first.claim), quotas, now);
  const archived = await store.transition(
    first.workspace.tenantId, first.workspace.workspaceId, first.workspace.ownerId,
    "archived", quotas, new Date(now.getTime() + 1_000),
  );
  assert.equal(archived.archiveMetadata?.patchCount, 1);
  const secondInput = creation({ executionId: "execution-2", workUnitId: "work-unit-2" });
  let second = await store.create(secondInput, quotas, now);
  second = await store.prepare(second.tenantId, second.workspaceId, second.ownerId, now);
  second = await store.markReady(second.tenantId, second.workspaceId, second.ownerId, now);
  await store.transition(
    second.tenantId, second.workspaceId, second.ownerId, "archived", quotas,
    new Date(now.getTime() + 2_000),
  );
  assert.equal(await store.collect("user-1", quotas), 1);
  assert.equal(await store.get("user-1", first.workspace.workspaceId), null);
  const metrics = await store.metrics("user-1");
  assert.equal(metrics.workspaceCreation, 1);
  assert.equal(metrics.archiveCount, 1);
});

test("service emits structured metrics and memory startup validation passes", async () => {
  const store = new MemoryRepositoryWorkspaceStore();
  const logs: Array<{ operation: string; fields: Record<string, unknown> }> = [];
  const engine = new RepositoryWorkspacePatchEngine(store, quotas, {
    info(operation, fields) { logs.push({ operation, fields: fields ?? {} }); },
    warn() {}, error() {}, debug() {}, async flush() {},
  });
  const workspace = await engine.create(creation());
  assert.ok(logs.some((entry) => entry.operation === "repository_workspace.created" &&
    entry.fields.workspaceId === workspace.workspaceId));
  await assert.doesNotReject(() => engine.verify());
  const metrics = await engine.metrics("user-1");
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0, uptimeSeconds: () => 1,
  });
  registry.recordRepositoryWorkspace(metrics);
  const rendered = registry.render();
  for (const metric of [
    "giro_repository_workspace_creation_total",
    "giro_repository_workspace_active",
    "giro_repository_patch_generation_total",
    "giro_repository_workspace_validation_failures_total",
    "giro_repository_workspace_conflicts_total",
    "giro_repository_workspace_archives_total",
    "giro_repository_workspace_recoveries_total",
    "giro_repository_workspace_duration_ms_total",
  ]) assert.match(rendered, new RegExp(metric));
});

test("migration defines workspace, snapshot, patch, diagnostic, archive, RLS, grant, and retention contracts", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260812000000_add_repository_workspace_patch_engine.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "repository_workspaces", "repository_workspace_snapshots", "repository_patches",
    "repository_patch_versions", "repository_workspace_diagnostics",
    "repository_workspace_archives", "repository_workspace_retention",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /save_repository_workspace/);
  assert.match(migration, /verify_repository_workspace_contract/);
  assert.match(migration, /repository_workspaces_owner_lifecycle_idx/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant execute on function public\.save_repository_workspace/);
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /collect_repository_workspaces/);
});
