import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  DEFAULT_ARTIFACT_QUOTAS,
  MemoryRepositoryArtifactStore,
  PostgresRepositoryArtifactStore,
  RepositoryArtifactEngine,
  RepositoryArtifactError,
  artifactIdentity,
  type ArtifactQuotas,
  type ArtifactType,
  type GenerateArtifactInput,
} from "../services/repositoryArtifact/index.js";
import {
  DEFAULT_WORKSPACE_QUOTAS,
  MemoryRepositoryWorkspaceStore,
  type RepositoryWorkspace,
} from "../services/repositoryWorkspace/index.js";

const now = new Date("2099-08-13T00:00:00.000Z");
const revision = "a".repeat(40);
const quotas: ArtifactQuotas = {
  ...DEFAULT_ARTIFACT_QUOTAS,
  artifactsPerWorkspace: 16,
  versionsPerArtifact: 3,
  operationsPerArtifact: 16,
  diagnosticsPerArtifact: 16,
  retainedArtifacts: 1,
  retainedVersions: 1,
  retainedDiagnostics: 1,
  generationTimeoutMs: 1_000,
  artifactTtlMs: 10_000,
};

async function workspaceFixture(
  executionId = "execution-1",
  workUnitId = "work-unit-1",
): Promise<RepositoryWorkspace> {
  const store = new MemoryRepositoryWorkspaceStore();
  let workspace = await store.create({
    tenantId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    executionId,
    workUnitId,
    ownerId: "user-1",
    repositoryOwnerId: "user-1",
    executionOwnerId: "user-1",
    snapshot: {
      published: true,
      tenantId: "user-1",
      repositoryId: "acme/widgets",
      repositoryRevision: revision,
      snapshotVersion: "snapshot-v1",
      revisionHash: revision,
      graphVersion: "graph-v1",
      intelligenceVersion: "intelligence-v1",
      retrievalVersion: "retrieval-v2",
      planningVersion: "planning-v1",
    },
  }, DEFAULT_WORKSPACE_QUOTAS, now);
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
  await store.generatePatch({
    claim,
    basePatchVersion: 0,
    fileOperations: [
      {
        operation: "update_file",
        path: "src/z.ts",
        content: "export const z = 2;\n",
        expectedContentHash: "before-z",
      },
      {
        operation: "create_file",
        path: "src/a.ts",
        content: "export const a = 1;\n",
      },
    ],
    symbolOperations: [{
      operation: "add_symbol",
      filePath: "src/a.ts",
      symbol: "a",
      declaration: "export const a = 1;",
    }],
    diagnostics: [{
      severity: "warning",
      code: "review_export",
      message: "Review the public export.",
      affectedFiles: ["src/a.ts"],
      affectedSymbols: ["a"],
    }, {
      severity: "blocker",
      code: "contract_review",
      message: "Contract review is required.",
      affectedFiles: ["src/z.ts"],
      affectedSymbols: ["z"],
    }],
    confidence: 0.92,
  }, DEFAULT_WORKSPACE_QUOTAS, now);
  return (await store.get(workspace.tenantId, workspace.workspaceId))!;
}

function generation(
  workspace: RepositoryWorkspace,
  artifactType: ArtifactType = "source_code",
  overrides: Partial<GenerateArtifactInput> = {},
): GenerateArtifactInput {
  const patch = workspace.patches.at(-1)!;
  return {
    tenantId: workspace.tenantId,
    ownerId: workspace.ownerId,
    repositoryOwnerId: workspace.ownerId,
    executionOwnerId: workspace.ownerId,
    artifactType,
    baseArtifactVersion: 0,
    workspace,
    snapshot: workspace.snapshot,
    patch,
    repositoryGraph: {
      version: workspace.snapshot.graphVersion,
      contentHash: "graph-hash",
      published: true,
    },
    intelligence: {
      version: workspace.snapshot.intelligenceVersion,
      contentHash: "intelligence-hash",
      published: true,
    },
    planning: {
      version: workspace.snapshot.planningVersion,
      contentHash: "planning-hash",
      published: true,
    },
    executionMetadata: {
      executionId: workspace.executionId,
      workUnitId: workspace.workUnitId,
      ownerId: workspace.ownerId,
      executionVersion: "execution-v1",
    },
    workspaceMetadata: {
      workspaceId: workspace.workspaceId,
      ownerId: workspace.ownerId,
      lifecycle: workspace.lifecycle,
      snapshotVersion: workspace.snapshotVersion,
      patchVersion: patch.patchVersion,
    },
    ...overrides,
  };
}

test("all proposal types generate deterministic structured immutable artifacts", async () => {
  const workspace = await workspaceFixture();
  const types: ArtifactType[] = [
    "source_code", "unit_tests", "integration_tests", "documentation",
    "configuration", "migration_proposal", "api_contract_update",
    "refactoring_proposal",
  ];
  for (const artifactType of types) {
    const left = new MemoryRepositoryArtifactStore();
    const right = new MemoryRepositoryArtifactStore();
    const first = await left.generate(
      generation(workspace, artifactType), quotas, now,
    );
    const second = await right.generate(
      generation(workspace, artifactType), quotas, now,
    );
    assert.equal(first.artifactId, second.artifactId);
    assert.deepEqual(first.versions, second.versions);
    assert.equal(first.lifecycle, "awaiting_review");
    assert.equal(first.versions[0]?.structuredContent.proposalOnly, true);
    assert.deepEqual(first.versions[0]?.affectedFiles, ["src/a.ts", "src/z.ts"]);
    assert.deepEqual(first.versions[0]?.affectedSymbols, ["a"]);
    assert.deepEqual(
      first.lifecycleHistory.map((event) => event.to),
      ["created", "generating", "generated", "validated", "awaiting_review"],
    );
    assert.throws(() => {
      (first.versions as unknown as unknown[]).push({});
    });
    assert.ok(!("apply" in first) && !("repositoryPath" in first));
  }
});

test("ownership, workspace lifecycle, snapshot, patch, and publication validation fail closed", async () => {
  const workspace = await workspaceFixture();
  const store = new MemoryRepositoryArtifactStore();
  await assert.rejects(() => store.generate(generation(workspace, "source_code", {
    repositoryOwnerId: "user-2",
  }), quotas, now), (error: unknown) =>
    error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_ownership_conflict");
  await assert.rejects(() => store.generate(generation({
    ...workspace, lifecycle: "archived",
  }), quotas, now), (error: unknown) =>
    error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_workspace_lifecycle_conflict");
  await assert.rejects(() => store.generate(generation(workspace, "source_code", {
    snapshot: { ...workspace.snapshot, snapshotHash: "stale" },
  }), quotas, now), (error: unknown) =>
    error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_snapshot_stale");
  await assert.rejects(() => store.generate(generation(workspace, "source_code", {
    patch: { ...workspace.patches[0]!, patchVersion: 2 },
  }), quotas, now), (error: unknown) =>
    error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_patch_stale");
  await assert.rejects(() => store.generate(generation(workspace, "source_code", {
    repositoryGraph: {
      version: "graph-v1", contentHash: "graph-hash", published: false,
    } as unknown as GenerateArtifactInput["repositoryGraph"],
  }), quotas, now), (error: unknown) =>
    error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_revision_unpublished");
  assert.equal((await store.metrics()).validationFailures, 5);
});

test("version fencing rejects stale writes and stale reviews while preserving immutable history", async () => {
  const workspace = await workspaceFixture();
  const store = new MemoryRepositoryArtifactStore();
  const first = await store.generate(generation(workspace), quotas, now);
  await assert.rejects(() => store.generate(
    generation(workspace), quotas, now,
  ), (error: unknown) => error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_version_stale");
  const second = await store.generate(generation(workspace, "source_code", {
    baseArtifactVersion: 1,
  }), quotas, new Date(now.getTime() + 1));
  assert.equal(second.artifactVersion, 2);
  assert.equal(second.versions[0]?.contentHash, first.versions[0]?.contentHash);
  await assert.rejects(() => store.review({
    tenantId: second.tenantId,
    artifactId: second.artifactId,
    ownerId: second.ownerId,
    reviewerId: "reviewer-1",
    artifactVersion: 1,
    decision: "approved",
    findings: [],
    idempotencyKey: "review-1",
  }, now), (error: unknown) => error instanceof RepositoryArtifactError &&
    error.code === "repository_artifact_version_stale");
});

test("diagnostics, approvals, confidence, warnings, and approval metrics are durable", async () => {
  const workspace = await workspaceFixture();
  const store = new MemoryRepositoryArtifactStore();
  const generated = await store.generate(generation(workspace), quotas, now);
  assert.deepEqual(generated.diagnostics.map((item) => item.severity),
    ["blocker", "warning"]);
  assert.equal(generated.versions[0]?.confidence, 0.92);
  assert.deepEqual(generated.versions[0]?.warnings, ["Review the public export."]);
  const approved = await store.review({
    tenantId: generated.tenantId,
    artifactId: generated.artifactId,
    ownerId: generated.ownerId,
    reviewerId: "reviewer-1",
    artifactVersion: generated.artifactVersion,
    decision: "approved",
    findings: ["validated"],
    idempotencyKey: "review-approved",
  }, new Date(now.getTime() + 500));
  assert.equal(approved.lifecycle, "approved");
  assert.equal(approved.approvals.length, 1);
  assert.equal((await store.metrics()).approvalWaitTimeMs, 500);
});

test("recovery handles abandoned generation, incomplete artifacts, stale workspaces, and expired leases", async () => {
  const workspace = await workspaceFixture();
  for (const [lifecycle, reason, lease] of [
    ["generating", "abandoned_generation", null],
    ["generated", "incomplete_artifact", null],
    ["awaiting_review", "stale_workspace", null],
    ["generating", "expired_lease", now.toISOString()],
  ] as const) {
    const store = new MemoryRepositoryArtifactStore();
    const artifact = await store.generate(generation(workspace), quotas, now);
    store.hydrate({
      ...artifact,
      lifecycle,
      updatedAt: now.toISOString(),
      generationLeaseExpiresAt: lease,
    });
    const recoveryTime = new Date(now.getTime() +
      (lifecycle === "awaiting_review" ? 10_001 : 1_001));
    assert.equal(await store.recover(recoveryTime, quotas), 1);
    const recovered = await store.get(
      artifact.tenantId, artifact.artifactId, artifact.ownerId,
    );
    assert.equal(recovered?.lifecycle, "expired");
    assert.equal(recovered?.recoveryHistory.at(-1)?.reason, reason);
  }
});

test("retention and startup integrity validation preserve audit metadata", async () => {
  const store = new MemoryRepositoryArtifactStore();
  const firstWorkspace = await workspaceFixture("execution-1", "work-unit-1");
  const first = await store.generate(generation(firstWorkspace), quotas, now);
  await store.review({
    tenantId: first.tenantId, artifactId: first.artifactId,
    ownerId: first.ownerId, reviewerId: "reviewer",
    artifactVersion: 1, decision: "rejected", findings: [],
    idempotencyKey: "reject-1",
  }, now);
  const secondWorkspace = await workspaceFixture("execution-2", "work-unit-2");
  const second = await store.generate(generation(secondWorkspace), quotas,
    new Date(now.getTime() + 1));
  await store.review({
    tenantId: second.tenantId, artifactId: second.artifactId,
    ownerId: second.ownerId, reviewerId: "reviewer",
    artifactVersion: 1, decision: "approved", findings: [],
    idempotencyKey: "approve-2",
  }, new Date(now.getTime() + 1));
  assert.equal(await store.collect("user-1", quotas), 1);
  assert.equal(await store.get(first.tenantId, first.artifactId, first.ownerId), null);
  assert.ok(await store.get(second.tenantId, second.artifactId, second.ownerId));
  await assert.doesNotReject(() => store.verify(quotas));
});

test("PostgreSQL adapter mirrors memory behavior and startup contract", async () => {
  const workspace = await workspaceFixture();
  let state: unknown = null;
  const client = {
    rpc(name: string, parameters: Record<string, unknown> = {}) {
      let data: unknown;
      if (name === "get_repository_artifact") {
        data = state ? [{ artifact: structuredClone(state) }] : [];
      } else if (name === "count_repository_workspace_artifacts") {
        data = [{ artifact_count: state ? 1 : 0 }];
      } else if (name === "save_repository_artifact") {
        state = structuredClone(parameters.input_artifact);
        data = [{ artifact: structuredClone(state) }];
      } else if (name === "verify_repository_artifact_contract") {
        data = [{ valid: true, problems: [] }];
      } else if (name === "repository_artifact_metrics") {
        data = [{ metrics: {
          artifactsGenerated: 1, generationLatencyMs: 0,
          validationFailures: 0, recoveryCount: 0,
          retentionCount: 0, approvalWaitTimeMs: 0,
        } }];
      } else {
        data = [];
      }
      return Promise.resolve({ data, error: null });
    },
  };
  const postgres = new PostgresRepositoryArtifactStore(client);
  const memory = new MemoryRepositoryArtifactStore();
  const expected = await memory.generate(generation(workspace), quotas, now);
  const actual = await postgres.generate(generation(workspace), quotas, now);
  assert.deepEqual(actual, expected);
  assert.deepEqual(await postgres.get(
    actual.tenantId, actual.artifactId, actual.ownerId,
  ), expected);
  await assert.doesNotReject(() => postgres.verify());
});

test("service metrics, startup wiring, and migration contracts are complete", async () => {
  const workspace = await workspaceFixture();
  const store = new MemoryRepositoryArtifactStore();
  const logs: Array<{ operation: string; fields: Record<string, unknown> }> = [];
  const engine = new RepositoryArtifactEngine(store, quotas, {
    info(operation, fields) { logs.push({ operation, fields: fields ?? {} }); },
    warn() {}, error() {}, debug() {}, async flush() {},
  });
  const artifact = await engine.generate(generation(workspace));
  assert.ok(logs.some((entry) =>
    entry.operation === "repository_artifact.generated" &&
    entry.fields.artifactId === artifact.artifactId));
  assert.equal(artifact.artifactId, artifactIdentity(generation(workspace)));
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0, uptimeSeconds: () => 1,
  });
  registry.recordRepositoryArtifact(await engine.metrics());
  for (const metric of [
    "giro_repository_artifacts_generated_total",
    "giro_repository_artifact_generation_latency_ms_total",
    "giro_repository_artifact_validation_failures_total",
    "giro_repository_artifact_recoveries_total",
    "giro_repository_artifact_retention_total",
    "giro_repository_artifact_approval_wait_time_ms_total",
  ]) assert.match(registry.render(), new RegExp(metric));

  const [migration, startup, storeSource] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260813000000_add_code_generation_artifact_engine.sql",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/repositoryArtifact/store.ts", import.meta.url), "utf8"),
  ]);
  for (const table of [
    "repository_proposed_artifacts", "repository_artifact_versions",
    "repository_artifact_diagnostics", "repository_artifact_approvals",
    "repository_artifact_archives", "repository_artifact_retention",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "foreign key", "create index", "check\\(", "enable row level security",
    "grant execute", "collect_repository_artifacts",
    "verify_repository_artifact_contract",
  ]) assert.match(migration.toLowerCase(), new RegExp(contract));
  assert.ok(startup.indexOf("runtimeRepositoryArtifactEngine.verify") <
    startup.indexOf("server = serve"));
  for (const forbidden of [
    "node:fs", "child_process", "simple-git", "exec(", "spawn(", "writeFile",
  ]) assert.doesNotMatch(storeSource, new RegExp(forbidden.replace("(", "\\(")));
});
