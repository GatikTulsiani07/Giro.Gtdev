import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  DEFAULT_APPLY_QUOTAS,
  MemoryRepositoryApplyStore,
  PostgresRepositoryApplyStore,
  RepositoryApplyEngine,
  RepositoryApplyError,
  applyTransactionIdentity,
  type ApplyQuotas,
  type PrepareApplyTransactionInput,
} from "../services/repositoryApply/index.js";
import {
  DEFAULT_ARTIFACT_QUOTAS,
  MemoryRepositoryArtifactStore,
  artifactContentHash,
  type GenerateArtifactInput,
  type RepositoryArtifact,
} from "../services/repositoryArtifact/index.js";
import {
  DEFAULT_PROPOSAL_QUOTAS,
  MemoryRepositoryProposalStore,
  proposalOutputHash,
  type RepositoryProposal,
} from "../services/repositoryProposal/index.js";
import {
  DEFAULT_REVIEW_QUOTAS,
  MemoryRepositoryReviewStore,
  type CreateReviewInput,
  type RepositoryReview,
} from "../services/repositoryReview/index.js";
import {
  DEFAULT_WORKSPACE_QUOTAS,
  MemoryRepositoryWorkspaceStore,
  type RepositoryWorkspace,
} from "../services/repositoryWorkspace/index.js";

const now = new Date("2099-08-16T00:00:00.000Z");
const revision = "c".repeat(40);
const quotas: ApplyQuotas = {
  ...DEFAULT_APPLY_QUOTAS,
  transactionsPerProposal: 3,
  versionsPerTransaction: 3,
  operationsPerPlan: 16,
  filesPerPlan: 16,
  symbolsPerPlan: 16,
  dependenciesPerPlan: 16,
  diagnosticsPerTransaction: 16,
  retainedTransactions: 1,
  retainedVersions: 2,
  retainedDiagnostics: 16,
  preparationTimeoutMs: 1_000,
  confirmationTtlMs: 10_000,
};

async function workspaceFixture(
  executionId = "execution-apply-1",
  workUnitId = "work-unit-apply-1",
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
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now);
  workspace = await store.markReady(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, now);
  const claim = await store.claim(
    workspace.tenantId, workspace.workspaceId, workspace.ownerId, 60_000, now);
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
      severity: "warning", code: "public_export",
      message: "Confirm public export.", affectedFiles: ["src/a.ts"],
      affectedSymbols: ["a"],
    }],
    confidence: 0.94,
  }, DEFAULT_WORKSPACE_QUOTAS, now);
  return (await store.get(workspace.tenantId, workspace.workspaceId))!;
}

function reviewInput(
  workspace: RepositoryWorkspace,
  artifact: RepositoryArtifact,
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
  };
}

async function approvedFixture(
  executionId = "execution-apply-1",
  workUnitId = "work-unit-apply-1",
): Promise<{
  workspace: RepositoryWorkspace;
  artifact: RepositoryArtifact;
  review: RepositoryReview;
  proposal: RepositoryProposal;
}> {
  const workspace = await workspaceFixture(executionId, workUnitId);
  const artifactStore = new MemoryRepositoryArtifactStore();
  const generation: GenerateArtifactInput = {
    tenantId: workspace.tenantId, ownerId: workspace.ownerId,
    repositoryOwnerId: workspace.ownerId, executionOwnerId: workspace.ownerId,
    artifactType: "source_code", baseArtifactVersion: 0,
    workspace, snapshot: workspace.snapshot, patch: workspace.patches.at(-1)!,
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
      patchVersion: workspace.patches.at(-1)!.patchVersion,
    },
  };
  const pendingArtifact = await artifactStore.generate(
    generation, DEFAULT_ARTIFACT_QUOTAS, now);
  const reviewStore = new MemoryRepositoryReviewStore();
  const pendingReview = await reviewStore.create(
    reviewInput(workspace, pendingArtifact), DEFAULT_REVIEW_QUOTAS, now);
  const review = await reviewStore.decide({
    tenantId: pendingReview.tenantId, reviewId: pendingReview.reviewId,
    ownerId: pendingReview.ownerId, reviewerId: "reviewer",
    reviewVersion: 1, verdict: "approved",
    rationaleCodes: ["all_gates_passed"], idempotencyKey: "review-approved",
  }, new Date(now.getTime() + 1));
  const artifact = await artifactStore.review({
    tenantId: pendingArtifact.tenantId, artifactId: pendingArtifact.artifactId,
    ownerId: pendingArtifact.ownerId, reviewerId: "reviewer",
    artifactVersion: 1, decision: "approved", findings: [],
    idempotencyKey: "artifact-approved",
  }, new Date(now.getTime() + 2));
  const proposalStore = new MemoryRepositoryProposalStore();
  const pendingProposal = await proposalStore.assemble({
    tenantId: workspace.tenantId, ownerId: workspace.ownerId,
    repositoryOwnerId: workspace.ownerId,
    executionOwnerId: workspace.ownerId, baseProposalVersion: 0,
    workspace, artifacts: [artifact], patches: [workspace.patches.at(-1)!],
    reviews: [review],
    executionMetadata: {
      executionId: workspace.executionId, workUnitId: workspace.workUnitId,
      ownerId: workspace.ownerId, executionVersion: "execution-v1",
    },
  }, DEFAULT_PROPOSAL_QUOTAS, new Date(now.getTime() + 3));
  const proposal = await proposalStore.decide({
    tenantId: pendingProposal.tenantId, proposalId: pendingProposal.proposalId,
    ownerId: pendingProposal.ownerId, reviewerId: "reviewer",
    proposalVersion: 1, verdict: "approved",
    rationaleCodes: ["ready"], idempotencyKey: "proposal-approved",
  }, new Date(now.getTime() + 4));
  return { workspace, artifact, review, proposal };
}

function applyInput(
  fixture: Awaited<ReturnType<typeof approvedFixture>>,
  overrides: Partial<PrepareApplyTransactionInput> = {},
): PrepareApplyTransactionInput {
  return {
    tenantId: fixture.workspace.tenantId, ownerId: fixture.workspace.ownerId,
    repositoryOwnerId: fixture.workspace.ownerId,
    executionOwnerId: fixture.workspace.ownerId,
    baseTransactionVersion: 0,
    proposal: fixture.proposal, workspace: fixture.workspace,
    artifacts: [fixture.artifact],
    patches: [fixture.workspace.patches.at(-1)!],
    executionMetadata: {
      executionId: fixture.workspace.executionId,
      workUnitId: fixture.workspace.workUnitId,
      ownerId: fixture.workspace.ownerId,
      executionVersion: "execution-v1",
    },
    ...overrides,
  };
}

test("transactions, apply plans, and rollback plans are deterministic and immutable", async () => {
  const fixture = await approvedFixture();
  const first = await new MemoryRepositoryApplyStore().prepare(
    applyInput(fixture), quotas, now);
  const second = await new MemoryRepositoryApplyStore().prepare(
    applyInput(fixture), quotas, now);
  assert.equal(first.transactionId, second.transactionId);
  assert.deepEqual(first.versions, second.versions);
  assert.equal(first.lifecycle, "awaiting_confirmation");
  const plan = first.versions[0]!.applyPlan;
  assert.equal(plan.validationSummary.gateCount, 9);
  assert.equal(plan.orderedOperations.length, 3);
  assert.deepEqual(plan.affectedFiles, ["src/a.ts", "src/z.ts"]);
  assert.equal(plan.rollbackPlan.inverseOperations.length,
    plan.orderedOperations.length);
  assert.deepEqual(plan.rollbackPlan.inverseOperations.map((operation) =>
    operation.sourceOperationId),
  [...plan.orderedOperations].reverse().map((operation) =>
    operation.operationId));
  assert.throws(() => {
    (plan.orderedOperations as unknown as unknown[]).push({});
  });
});

test("ownership, proposal, workspace, revision, artifact, patch, and version fences reject stale inputs", async () => {
  const fixture = await approvedFixture();
  const cases: Array<[Partial<PrepareApplyTransactionInput>, string]> = [
    [{ repositoryOwnerId: "user-2" }, "repository_apply_ownership_conflict"],
    [{ proposal: { ...fixture.proposal, lifecycle: "rejected" } },
      "repository_apply_proposal_unapproved"],
    [{ workspace: { ...fixture.workspace, lifecycle: "archived" } },
      "repository_apply_workspace_invalid"],
    [{ executionMetadata: {
      ...applyInput(fixture).executionMetadata, workUnitId: "stale",
    } }, "repository_apply_revision_stale"],
    [{ artifacts: [{ ...fixture.artifact, lifecycle: "awaiting_review" }] },
      "repository_apply_artifact_incompatible"],
    [{ patches: [{
      ...fixture.workspace.patches[0]!, contentHash: "stale",
    }] }, "repository_apply_patch_incompatible"],
    [{ artifacts: [] }, "repository_apply_incomplete"],
    [{ baseTransactionVersion: 1 }, "repository_apply_version_stale"],
  ];
  const store = new MemoryRepositoryApplyStore();
  for (const [overrides, code] of cases) {
    await assert.rejects(
      () => store.prepare(applyInput(fixture, overrides), quotas, now),
      (error: unknown) =>
        error instanceof RepositoryApplyError && error.code === code,
    );
  }
  assert.equal((await store.metrics()).validationFailures, cases.length);
});

test("conflicts, unsafe paths, and quotas fail before a plan is persisted", async () => {
  const fixture = await approvedFixture();
  const version = fixture.artifact.versions[0]!;
  const rewriteFixture = (
    operations: typeof version.structuredContent.operations,
  ) => {
    const artifactVersionBody = {
      ...version,
      structuredContent: {
        ...version.structuredContent,
        operations,
      },
    };
    const artifactVersion = {
      ...artifactVersionBody,
      contentHash: artifactContentHash(artifactVersionBody),
    };
    const artifact = { ...fixture.artifact, versions: [artifactVersion] };
    const currentProposalVersion = fixture.proposal.versions[0]!;
    const { outputHash: _outputHash, ...proposalVersionBase } =
      currentProposalVersion;
    const proposalVersionBody = {
      ...proposalVersionBase,
      assemblyMetadata: {
        ...currentProposalVersion.assemblyMetadata,
        artifactVersions: [{
          ...currentProposalVersion.assemblyMetadata.artifactVersions[0]!,
          contentHash: artifactVersion.contentHash,
        }],
      },
    };
    const proposal = {
      ...fixture.proposal,
      versions: [{
        ...proposalVersionBody,
        outputHash: proposalOutputHash(proposalVersionBody),
      }],
    };
    return { ...fixture, artifact, proposal };
  };
  const conflictFixture = rewriteFixture([
    version.structuredContent.operations[0]!,
    { ...version.structuredContent.operations[0]!, content: "different" },
  ]);
  const store = new MemoryRepositoryApplyStore();
  await assert.rejects(
    () => store.prepare(applyInput(conflictFixture), quotas, now),
    (error: unknown) => error instanceof RepositoryApplyError &&
      error.code === "repository_apply_conflict");
  assert.equal((await store.metrics()).conflicts, 1);

  const unsafeFixture = rewriteFixture([{
    ...version.structuredContent.operations[0]!, path: "../escape.ts",
  }]);
  await assert.rejects(() => new MemoryRepositoryApplyStore().prepare(
    applyInput(unsafeFixture), quotas, now,
  ), (error: unknown) => error instanceof RepositoryApplyError &&
    error.code === "repository_apply_plan_invalid");
  await assert.rejects(() => new MemoryRepositoryApplyStore().prepare(
    applyInput(fixture), { ...quotas, operationsPerPlan: 1 }, now,
  ), (error: unknown) => error instanceof RepositoryApplyError &&
    error.code === "repository_apply_quota_exceeded");
});

test("confirmation is version fenced, CAS-safe, and replay idempotent", async () => {
  const fixture = await approvedFixture();
  const store = new MemoryRepositoryApplyStore();
  const transaction = await store.prepare(applyInput(fixture), quotas, now);
  await assert.rejects(() => store.confirm({
    tenantId: transaction.tenantId, transactionId: transaction.transactionId,
    ownerId: transaction.ownerId, confirmerId: "owner",
    transactionVersion: 2, decision: "ready", rationaleCodes: [],
    idempotencyKey: "stale",
  }, now), (error: unknown) => error instanceof RepositoryApplyError &&
    error.code === "repository_apply_version_stale");
  const confirmation = {
    tenantId: transaction.tenantId, transactionId: transaction.transactionId,
    ownerId: transaction.ownerId, confirmerId: "owner",
    transactionVersion: 1, decision: "ready" as const,
    rationaleCodes: ["confirmed"], idempotencyKey: "confirm",
  };
  const ready = await store.confirm(confirmation, now);
  const replay = await store.confirm(confirmation, now);
  assert.deepEqual(replay, ready);
  assert.equal(ready.lifecycle, "ready");
  assert.equal(ready.confirmations.length, 1);
});

test("diagnostics, recovery modes, retention, and metrics preserve audit history", async () => {
  const fixture = await approvedFixture();
  const recoverStore = new MemoryRepositoryApplyStore();
  const recoverable = await recoverStore.prepare(applyInput(fixture, {
    applyLeaseExpiresAt: new Date(now.getTime() + 500).toISOString(),
  }), quotas, now);
  assert.ok(recoverable.diagnostics.some((diagnostic) =>
    diagnostic.code === "public_export"));
  assert.equal(await recoverStore.recover(
    new Date(now.getTime() + 501), quotas), 1);
  assert.equal((await recoverStore.get(
    recoverable.tenantId, recoverable.transactionId, recoverable.ownerId
  ))?.recoveryHistory[0]?.reason, "expired_lease");

  for (const [lifecycle, reason, age] of [
    ["created", "abandoned_transaction", 2_000],
    ["validating", "incomplete_apply_plan", 2_000],
    ["awaiting_confirmation", "stale_confirmation", 20_000],
  ] as const) {
    const candidateStore = new MemoryRepositoryApplyStore();
    candidateStore.hydrate({
      ...recoverable, lifecycle,
      updatedAt: new Date(now.getTime() - age).toISOString(),
      applyLeaseExpiresAt: null,
    });
    assert.equal(await candidateStore.recover(now, quotas), 1);
    assert.equal((await candidateStore.get(
      recoverable.tenantId, recoverable.transactionId, recoverable.ownerId
    ))?.recoveryHistory.at(-1)?.reason, reason);
  }

  const store = new MemoryRepositoryApplyStore();
  const first = await store.prepare(applyInput(fixture), quotas, now);
  await store.confirm({
    tenantId: first.tenantId, transactionId: first.transactionId,
    ownerId: first.ownerId, confirmerId: "owner", transactionVersion: 1,
    decision: "ready", rationaleCodes: [], idempotencyKey: "first",
  }, now);
  const secondFixture = await approvedFixture(
    "execution-apply-2", "work-unit-apply-2");
  const second = await store.prepare(applyInput(secondFixture), quotas, now);
  await store.confirm({
    tenantId: second.tenantId, transactionId: second.transactionId,
    ownerId: second.ownerId, confirmerId: "owner", transactionVersion: 1,
    decision: "cancelled", rationaleCodes: [], idempotencyKey: "second",
  }, now);
  assert.equal((await store.metrics()).transactionsCreated, 2);
  assert.equal((await store.metrics()).rollbackPlans, 2);
  assert.equal(await store.collect("user-1", quotas), 1);
  await assert.doesNotReject(() => store.verify(quotas));
});

test("PostgreSQL adapter matches memory preparation and startup verification", async () => {
  const fixture = await approvedFixture();
  let state: unknown = null;
  const client = {
    rpc(name: string, parameters: Record<string, unknown> = {}) {
      let data: unknown;
      if (name === "get_repository_apply_transaction") {
        data = state ? [{ transaction: structuredClone(state) }] : [];
      } else if (name === "count_repository_proposal_apply_transactions") {
        data = [{ transaction_count: state ? 1 : 0 }];
      } else if (name === "save_repository_apply_transaction") {
        state = structuredClone(parameters.input_transaction);
        data = [{ transaction: structuredClone(state) }];
      } else if (name === "verify_repository_apply_contract") {
        data = [{ valid: true, problems: [] }];
      } else if (name === "repository_apply_transaction_metrics") {
        data = [{ metrics: {
          transactionsCreated: 1, validationFailures: 0, rollbackPlans: 1,
          conflicts: 0, preparationLatencyMs: 0, recoveryCount: 0,
        } }];
      } else data = [];
      return Promise.resolve({ data, error: null });
    },
  };
  const expected = await new MemoryRepositoryApplyStore().prepare(
    applyInput(fixture), quotas, now);
  const postgres = new PostgresRepositoryApplyStore(client);
  const actual = await postgres.prepare(applyInput(fixture), quotas, now);
  assert.deepEqual(actual, expected);
  assert.deepEqual(await postgres.get(
    actual.tenantId, actual.transactionId, actual.ownerId), expected);
  await assert.doesNotReject(() => postgres.verify());
});

test("service metrics, migration, startup, and safety boundaries are complete", async () => {
  const fixture = await approvedFixture();
  const logs: Array<{ operation: string; fields: Record<string, unknown> }> = [];
  const engine = new RepositoryApplyEngine(
    new MemoryRepositoryApplyStore(), quotas, {
      info(operation, fields) {
        logs.push({ operation, fields: fields ?? {} });
      },
      warn() {}, error() {}, debug() {}, async flush() {},
    });
  const transaction = await engine.prepare(applyInput(fixture));
  assert.equal(transaction.transactionId,
    applyTransactionIdentity(applyInput(fixture)));
  assert.ok(logs.some((entry) =>
    entry.operation === "repository_apply.prepared" &&
    entry.fields.transactionId === transaction.transactionId));
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0, uptimeSeconds: () => 1,
  });
  registry.recordRepositoryApply(await engine.metrics());
  for (const metric of [
    "giro_repository_apply_transactions_created_total",
    "giro_repository_apply_validation_failures_total",
    "giro_repository_apply_rollback_plans_total",
    "giro_repository_apply_conflicts_total",
    "giro_repository_apply_preparation_latency_ms_total",
    "giro_repository_apply_recoveries_total",
  ]) assert.match(registry.render(), new RegExp(metric));

  const [migration, startup, sources] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260816000000_add_repository_apply_transaction_coordinator.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    Promise.all([
      readFile(new URL(
        "../services/repositoryApply/store.ts", import.meta.url), "utf8"),
      readFile(new URL(
        "../services/repositoryApply/validation.ts", import.meta.url), "utf8"),
    ]).then((items) => items.join("\n")),
  ]);
  for (const table of [
    "repository_apply_transactions", "repository_apply_transaction_versions",
    "repository_apply_plans", "repository_apply_rollbacks",
    "repository_apply_diagnostics", "repository_apply_archives",
    "repository_apply_retention",
  ]) assert.match(migration,
    new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "foreign key", "create index", "check\\(", "enable row level security",
    "grant execute", "collect_repository_apply_transactions",
    "verify_repository_apply_contract",
  ]) assert.match(migration.toLowerCase(), new RegExp(contract));
  assert.ok(startup.indexOf("runtimeRepositoryApplyEngine.verify") <
    startup.indexOf("server = serve"));
  for (const forbidden of [
    "node:fs", "child_process", "simple-git", "exec(", "spawn(",
    "writeFile", "fetch(", "axios", "createBranch", "createCommit",
    "git.push", "git.merge", "git.commit",
  ]) assert.doesNotMatch(sources,
    new RegExp(forbidden.replace("(", "\\(")));
});
