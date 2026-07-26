import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  DEFAULT_ARTIFACT_QUOTAS,
  MemoryRepositoryArtifactStore,
  type GenerateArtifactInput,
  type RepositoryArtifact,
} from "../services/repositoryArtifact/index.js";
import {
  DEFAULT_REVIEW_QUOTAS,
  MemoryRepositoryReviewStore,
  PostgresRepositoryReviewStore,
  RepositoryReviewEngine,
  RepositoryReviewError,
  reviewIdentity,
  type CreateReviewInput,
  type ReviewQuotas,
} from "../services/repositoryReview/index.js";
import {
  DEFAULT_WORKSPACE_QUOTAS,
  MemoryRepositoryWorkspaceStore,
  type RepositoryWorkspace,
} from "../services/repositoryWorkspace/index.js";

const now = new Date("2099-08-14T00:00:00.000Z");
const revision = "a".repeat(40);
const quotas: ReviewQuotas = {
  ...DEFAULT_REVIEW_QUOTAS,
  reviewsPerArtifact: 3,
  versionsPerReview: 3,
  operationsPerReview: 16,
  findingsPerReview: 32,
  diagnosticsPerReview: 16,
  retainedReviews: 1,
  retainedVersions: 2,
  retainedFindings: 16,
  validationTimeoutMs: 1_000,
  reviewTtlMs: 10_000,
};

async function workspaceFixture(
  executionId = "execution-1",
  workUnitId = "work-unit-1",
): Promise<RepositoryWorkspace> {
  const store = new MemoryRepositoryWorkspaceStore();
  let workspace = await store.create({
    tenantId: "user-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, executionId, workUnitId,
    ownerId: "user-1", repositoryOwnerId: "user-1",
    executionOwnerId: "user-1",
    snapshot: {
      published: true, tenantId: "user-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, snapshotVersion: "snapshot-v1",
      revisionHash: revision, graphVersion: "graph-v1",
      intelligenceVersion: "intelligence-v1",
      retrievalVersion: "retrieval-v2", planningVersion: "planning-v1",
    },
  }, DEFAULT_WORKSPACE_QUOTAS, now);
  workspace = await store.prepare(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now,
  );
  workspace = await store.markReady(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now,
  );
  const claim = await store.claim(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, 60_000, now,
  );
  workspace = await store.activate(claim, now);
  await store.generatePatch({
    claim, basePatchVersion: 0,
    fileOperations: [{
      operation: "update_file", path: "src/z.ts",
      content: "export const z = 2;\n", expectedContentHash: "before-z",
    }, {
      operation: "create_file", path: "src/a.ts",
      content: "export const a = 1;\n",
    }],
    symbolOperations: [{
      operation: "add_symbol", filePath: "src/a.ts", symbol: "a",
      declaration: "export const a = 1;",
    }],
    diagnostics: [{
      severity: "warning", code: "review_export",
      message: "Review public export.", affectedFiles: ["src/a.ts"],
      affectedSymbols: ["a"],
    }],
    confidence: 0.94,
  }, DEFAULT_WORKSPACE_QUOTAS, now);
  return (await store.get(workspace.tenantId, workspace.workspaceId))!;
}

async function artifactFixture(
  workspace: RepositoryWorkspace,
): Promise<RepositoryArtifact> {
  const patch = workspace.patches.at(-1)!;
  const input: GenerateArtifactInput = {
    tenantId: workspace.tenantId, ownerId: workspace.ownerId,
    repositoryOwnerId: workspace.ownerId, executionOwnerId: workspace.ownerId,
    artifactType: "source_code", baseArtifactVersion: 0,
    workspace, snapshot: workspace.snapshot, patch,
    repositoryGraph: {
      version: "graph-v1", contentHash: "graph-hash", published: true,
    },
    intelligence: {
      version: "intelligence-v1",
      contentHash: "intelligence-hash", published: true,
    },
    planning: {
      version: "planning-v1", contentHash: "planning-hash", published: true,
    },
    executionMetadata: {
      executionId: workspace.executionId, workUnitId: workspace.workUnitId,
      ownerId: workspace.ownerId, executionVersion: "execution-v1",
    },
    workspaceMetadata: {
      workspaceId: workspace.workspaceId, ownerId: workspace.ownerId,
      lifecycle: workspace.lifecycle, snapshotVersion: workspace.snapshotVersion,
      patchVersion: patch.patchVersion,
    },
  };
  return new MemoryRepositoryArtifactStore().generate(
    input, DEFAULT_ARTIFACT_QUOTAS, now,
  );
}

function reviewInput(
  workspace: RepositoryWorkspace,
  artifact: RepositoryArtifact,
  overrides: Partial<CreateReviewInput> = {},
): CreateReviewInput {
  return {
    tenantId: workspace.tenantId, ownerId: workspace.ownerId,
    repositoryOwnerId: workspace.ownerId, executionOwnerId: workspace.ownerId,
    reviewerType: "system", baseReviewVersion: 0,
    artifact, workspace, snapshot: workspace.snapshot,
    patch: workspace.patches.at(-1)!,
    repositoryGraph: {
      version: "graph-v1", contentHash: "graph-hash", published: true,
      dependencies: [{
        fromFile: "src/a.ts", toFile: "src/z.ts", blocking: true,
      }],
      symbols: [{ filePath: "src/a.ts", symbol: "a" }],
    },
    intelligence: {
      version: "intelligence-v1", contentHash: "intelligence-hash",
      published: true, knownFiles: ["src/a.ts", "src/z.ts"],
      knownSymbols: [{ filePath: "src/a.ts", symbol: "a" }],
    },
    planning: {
      version: "planning-v1", contentHash: "planning-hash", published: true,
      affectedFiles: ["src/a.ts", "src/z.ts"],
      affectedSymbols: [{ filePath: "src/a.ts", symbol: "a" }],
      dependencies: [{
        fromFile: "src/a.ts", toFile: "src/z.ts", blocking: true,
      }],
    },
    executionMetadata: {
      executionId: workspace.executionId, workUnitId: workspace.workUnitId,
      ownerId: workspace.ownerId, executionVersion: "execution-v1",
    },
    ...overrides,
  };
}

test("reviews and all quality gates are deterministic, structured, and immutable", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  const left = new MemoryRepositoryReviewStore();
  const right = new MemoryRepositoryReviewStore();
  const first = await left.create(reviewInput(workspace, artifact), quotas, now);
  const second = await right.create(reviewInput(workspace, artifact), quotas, now);
  assert.equal(first.reviewId, second.reviewId);
  assert.deepEqual(first.versions, second.versions);
  assert.equal(first.lifecycle, "awaiting_decision");
  assert.equal(first.versions[0]?.verdict, "approved");
  assert.equal(first.versions[0]?.metrics.gateCount, 10);
  assert.equal(first.versions[0]?.metrics.passedGateCount, 10);
  assert.deepEqual(
    [...new Set(first.findings.map((finding) => finding.category))].sort(),
    [
      "artifact_completeness", "dependency_consistency", "lifecycle",
      "ownership", "patch_consistency", "path_safety", "quota_validation",
      "schema_correctness", "symbol_consistency", "version_fencing",
    ],
  );
  assert.throws(() => {
    (first.findings as unknown as unknown[]).push({});
  });
});

test("quality gates produce ordered blocker, error, warning, and info findings", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  const version = artifact.versions[0]!;
  const malformed: RepositoryArtifact = {
    ...artifact,
    versions: [{
      ...version,
      structuredContent: {
        ...version.structuredContent,
        operations: [{
          operation: "create_file", path: "../escape.ts", symbol: "ghost",
        }],
      },
      affectedFiles: ["../escape.ts"],
      affectedSymbols: ["ghost"],
    }],
  };
  const store = new MemoryRepositoryReviewStore();
  const review = await store.create(reviewInput(workspace, malformed, {
    planning: {
      ...reviewInput(workspace, artifact).planning,
      affectedFiles: [],
      affectedSymbols: [],
    },
  }), quotas, now);
  const severities = new Set(review.findings.map((finding) => finding.severity));
  assert.ok(severities.has("blocker"));
  assert.ok(severities.has("error"));
  assert.ok(severities.has("info"));
  assert.equal(review.versions[0]?.verdict, "rejected");
  assert.deepEqual(review.findings.map((finding) => finding.severity),
    [...review.findings.map((finding) => finding.severity)].sort((left, right) =>
      ({ blocker: 0, error: 1, warning: 2, info: 3 })[left] -
      ({ blocker: 0, error: 1, warning: 2, info: 3 })[right]));

  const warningReview = await new MemoryRepositoryReviewStore().create(
    reviewInput(workspace, artifact, {
      planning: {
        ...reviewInput(workspace, artifact).planning,
        affectedFiles: ["src/a.ts"],
      },
    }), quotas, now,
  );
  assert.equal(warningReview.versions[0]?.verdict, "changes_requested");
  assert.ok(warningReview.findings.some((finding) =>
    finding.severity === "warning" &&
    finding.category === "dependency_consistency"));
});

test("ownership, publication, lifecycle, snapshot, patch, and artifact fences reject stale inputs", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  const cases: Array<[Partial<CreateReviewInput>, string]> = [
    [{ repositoryOwnerId: "user-2" }, "repository_review_ownership_conflict"],
    [{
      repositoryGraph: {
        ...reviewInput(workspace, artifact).repositoryGraph,
        published: false,
      } as unknown as CreateReviewInput["repositoryGraph"],
    }, "repository_review_revision_unpublished"],
    [{
      workspace: { ...workspace, lifecycle: "archived" },
    }, "repository_review_lifecycle_conflict"],
    [{
      snapshot: { ...workspace.snapshot, snapshotHash: "stale" },
    }, "repository_review_snapshot_stale"],
    [{
      patch: { ...workspace.patches[0]!, patchVersion: 2 },
    }, "repository_review_patch_stale"],
    [{
      executionMetadata: {
        ...reviewInput(workspace, artifact).executionMetadata,
        workUnitId: "stale",
      },
    }, "repository_review_version_fence_rejected"],
  ];
  const store = new MemoryRepositoryReviewStore();
  for (const [overrides, code] of cases) {
    await assert.rejects(
      () => store.create(reviewInput(workspace, artifact, overrides), quotas, now),
      (error: unknown) =>
        error instanceof RepositoryReviewError && error.code === code,
    );
  }
  assert.equal((await store.metrics()).validationFailures, cases.length);
});

test("review versions, decisions, CAS fences, and immutable history reject stale writes", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  const store = new MemoryRepositoryReviewStore();
  const review = await store.create(reviewInput(workspace, artifact), quotas, now);
  await assert.rejects(
    () => store.create(reviewInput(workspace, artifact), quotas, now),
    (error: unknown) => error instanceof RepositoryReviewError &&
      error.code === "repository_review_version_stale",
  );
  await assert.rejects(() => store.decide({
    tenantId: review.tenantId, reviewId: review.reviewId,
    ownerId: review.ownerId, reviewerId: "reviewer",
    reviewVersion: 2, verdict: "approved", rationaleCodes: [],
    idempotencyKey: "decision-stale",
  }, now), (error: unknown) => error instanceof RepositoryReviewError &&
    error.code === "repository_review_version_stale");
  const decided = await store.decide({
    tenantId: review.tenantId, reviewId: review.reviewId,
    ownerId: review.ownerId, reviewerId: "reviewer",
    reviewVersion: 1, verdict: "changes_requested",
    rationaleCodes: ["quality_warning"], idempotencyKey: "decision-1",
  }, new Date(now.getTime() + 500));
  const second = await store.create(reviewInput(workspace, artifact, {
    baseReviewVersion: 1,
  }), quotas, new Date(now.getTime() + 501));
  assert.equal(second.reviewVersion, 2);
  assert.equal(second.versions[0]?.outputHash, decided.versions[0]?.outputHash);
});

test("diagnostics, decisions, metrics, recovery, orphan findings, and retention are durable", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  const store = new MemoryRepositoryReviewStore();
  const first = await store.create(reviewInput(workspace, artifact), quotas, now);
  assert.equal(first.diagnostics.length, 1);
  const approved = await store.decide({
    tenantId: first.tenantId, reviewId: first.reviewId, ownerId: first.ownerId,
    reviewerId: "reviewer", reviewVersion: 1, verdict: "approved",
    rationaleCodes: ["all_gates_passed"], idempotencyKey: "approve",
  }, new Date(now.getTime() + 500));
  assert.equal((await store.metrics()).reviewLatencyMs, 500);
  assert.equal((await store.metrics()).approvals, 1);

  const recoverStore = new MemoryRepositoryReviewStore();
  const recoverable = await recoverStore.create(
    reviewInput(workspace, artifact, {
      reviewerType: "agent",
      reviewLeaseExpiresAt: new Date(now.getTime() + 500).toISOString(),
    }), quotas, now,
  );
  const orphan = {
    ...recoverable.findings[0]!,
    findingId: "orphan-finding",
    reviewVersion: 99,
  };
  recoverStore.hydrate({
    ...recoverable,
    lifecycle: "validating",
    findings: [...recoverable.findings, orphan],
  });
  assert.equal(await recoverStore.recover(
    new Date(now.getTime() + 1_001), quotas,
  ), 2);
  const recovered = await recoverStore.get(
    recoverable.tenantId, recoverable.reviewId, recoverable.ownerId,
  );
  assert.equal(recovered?.lifecycle, "expired");
  assert.deepEqual(recovered?.recoveryHistory.map((item) => item.reason),
    ["orphan_findings", "expired_review_lease"]);

  const second = await store.create(reviewInput(workspace, artifact, {
    reviewerType: "agent",
  }), quotas, new Date(now.getTime() + 1_000));
  await store.decide({
    tenantId: second.tenantId, reviewId: second.reviewId, ownerId: second.ownerId,
    reviewerId: "reviewer", reviewVersion: 1, verdict: "rejected",
    rationaleCodes: ["policy"], idempotencyKey: "reject",
  }, new Date(now.getTime() + 1_001));
  assert.equal(await store.collect("user-1", quotas), 1);
  assert.equal(await store.get(
    approved.tenantId, approved.reviewId, approved.ownerId,
  ), null);
  await assert.doesNotReject(() => store.verify(quotas));
});

test("PostgreSQL adapter is equivalent and startup verification is fenced", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  let state: unknown = null;
  const client = {
    rpc(name: string, parameters: Record<string, unknown> = {}) {
      let data: unknown;
      if (name === "get_repository_quality_review") {
        data = state ? [{ review: structuredClone(state) }] : [];
      } else if (name === "count_repository_artifact_reviews") {
        data = [{ review_count: state ? 1 : 0 }];
      } else if (name === "save_repository_quality_review") {
        state = structuredClone(parameters.input_review);
        data = [{ review: structuredClone(state) }];
      } else if (name === "verify_repository_quality_review_contract") {
        data = [{ valid: true, problems: [] }];
      } else if (name === "repository_quality_review_metrics") {
        data = [{ metrics: {
          reviewsCreated: 1, approvals: 0, rejections: 0,
          validationFailures: 0, blockerCount: 0, warningCount: 0,
          reviewLatencyMs: 0, recoveryCount: 0,
        } }];
      } else data = [];
      return Promise.resolve({ data, error: null });
    },
  };
  const memory = new MemoryRepositoryReviewStore();
  const postgres = new PostgresRepositoryReviewStore(client);
  const expected = await memory.create(
    reviewInput(workspace, artifact), quotas, now,
  );
  const actual = await postgres.create(
    reviewInput(workspace, artifact), quotas, now,
  );
  assert.deepEqual(actual, expected);
  assert.deepEqual(await postgres.get(
    actual.tenantId, actual.reviewId, actual.ownerId,
  ), expected);
  await assert.doesNotReject(() => postgres.verify());
});

test("service metrics, startup wiring, migration contracts, and safety boundaries are complete", async () => {
  const workspace = await workspaceFixture();
  const artifact = await artifactFixture(workspace);
  const store = new MemoryRepositoryReviewStore();
  const logs: Array<{ operation: string; fields: Record<string, unknown> }> = [];
  const engine = new RepositoryReviewEngine(store, quotas, {
    info(operation, fields) { logs.push({ operation, fields: fields ?? {} }); },
    warn() {}, error() {}, debug() {}, async flush() {},
  });
  const review = await engine.create(reviewInput(workspace, artifact));
  assert.equal(review.reviewId, reviewIdentity(reviewInput(workspace, artifact)));
  assert.ok(logs.some((entry) =>
    entry.operation === "repository_review.created" &&
    entry.fields.reviewId === review.reviewId));
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0, uptimeSeconds: () => 1,
  });
  registry.recordRepositoryReview(await engine.metrics());
  for (const metric of [
    "giro_repository_reviews_created_total",
    "giro_repository_review_approvals_total",
    "giro_repository_review_rejections_total",
    "giro_repository_review_validation_failures_total",
    "giro_repository_review_blockers_total",
    "giro_repository_review_warnings_total",
    "giro_repository_review_latency_ms_total",
    "giro_repository_review_recoveries_total",
  ]) assert.match(registry.render(), new RegExp(metric));

  const [migration, startup, sources] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260814000000_add_review_validation_quality_gate_engine.sql",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    Promise.all([
      readFile(new URL("../services/repositoryReview/store.ts", import.meta.url), "utf8"),
      readFile(new URL("../services/repositoryReview/validation.ts", import.meta.url), "utf8"),
    ]).then((items) => items.join("\n")),
  ]);
  for (const table of [
    "repository_quality_reviews", "repository_quality_review_versions",
    "repository_quality_review_findings", "repository_quality_review_diagnostics",
    "repository_quality_review_archives", "repository_quality_review_retention",
  ]) assert.match(migration,
    new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "foreign key", "create index", "check\\(", "enable row level security",
    "grant execute", "collect_repository_quality_reviews",
    "verify_repository_quality_review_contract",
  ]) assert.match(migration.toLowerCase(), new RegExp(contract));
  assert.ok(startup.indexOf("runtimeRepositoryReviewEngine.verify") <
    startup.indexOf("server = serve"));
  for (const forbidden of [
    "node:fs", "child_process", "simple-git", "exec(", "spawn(",
    "writeFile", "fetch(", "axios",
  ]) assert.doesNotMatch(sources,
    new RegExp(forbidden.replace("(", "\\(")));
});
