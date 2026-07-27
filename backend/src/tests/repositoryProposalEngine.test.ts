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
  DEFAULT_PROPOSAL_QUOTAS,
  MemoryRepositoryProposalStore,
  PostgresRepositoryProposalStore,
  RepositoryProposalEngine,
  RepositoryProposalError,
  proposalIdentity,
  type AssembleProposalInput,
  type ProposalQuotas,
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

const now = new Date("2099-08-15T00:00:00.000Z");
const revision = "b".repeat(40);
const quotas: ProposalQuotas = {
  ...DEFAULT_PROPOSAL_QUOTAS,
  proposalsPerWorkspace: 3,
  versionsPerProposal: 3,
  artifactsPerProposal: 4,
  reviewsPerProposal: 4,
  patchesPerProposal: 4,
  filesPerManifest: 16,
  symbolsPerManifest: 16,
  diagnosticsPerProposal: 16,
  retainedProposals: 1,
  retainedVersions: 2,
  retainedDiagnostics: 16,
  assemblyTimeoutMs: 1_000,
  proposalTtlMs: 10_000,
};

async function workspaceFixture(
  executionId = "execution-proposal-1",
  workUnitId = "work-unit-proposal-1",
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

async function approvedInputs(
  executionId = "execution-proposal-1",
  workUnitId = "work-unit-proposal-1",
): Promise<{
  workspace: RepositoryWorkspace;
  artifact: RepositoryArtifact;
  review: RepositoryReview;
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
    reviewVersion: pendingReview.reviewVersion, verdict: "approved",
    rationaleCodes: ["all_gates_passed"], idempotencyKey: "review-approved",
  }, new Date(now.getTime() + 100));
  const artifact = await artifactStore.review({
    tenantId: pendingArtifact.tenantId, artifactId: pendingArtifact.artifactId,
    ownerId: pendingArtifact.ownerId, reviewerId: "reviewer",
    artifactVersion: pendingArtifact.artifactVersion, decision: "approved",
    findings: [], idempotencyKey: "artifact-approved",
  }, new Date(now.getTime() + 101));
  return { workspace, artifact, review };
}

function proposalInput(
  fixture: Awaited<ReturnType<typeof approvedInputs>>,
  overrides: Partial<AssembleProposalInput> = {},
): AssembleProposalInput {
  return {
    tenantId: fixture.workspace.tenantId, ownerId: fixture.workspace.ownerId,
    repositoryOwnerId: fixture.workspace.ownerId,
    executionOwnerId: fixture.workspace.ownerId,
    baseProposalVersion: 0,
    workspace: fixture.workspace,
    artifacts: [fixture.artifact],
    patches: [fixture.workspace.patches.at(-1)!],
    reviews: [fixture.review],
    executionMetadata: {
      executionId: fixture.workspace.executionId,
      workUnitId: fixture.workspace.workUnitId,
      ownerId: fixture.workspace.ownerId,
      executionVersion: "execution-v1",
    },
    ...overrides,
  };
}

test("proposal creation and change manifests are deterministic and immutable", async () => {
  const fixture = await approvedInputs();
  const left = await new MemoryRepositoryProposalStore().assemble(
    proposalInput(fixture), quotas, now);
  const right = await new MemoryRepositoryProposalStore().assemble(
    proposalInput(fixture), quotas, now);
  assert.equal(left.proposalId, right.proposalId);
  assert.deepEqual(left.versions, right.versions);
  assert.equal(left.lifecycle, "awaiting_review");
  assert.equal(left.versions[0]?.manifest.validationSummary.gateCount, 8);
  assert.equal(left.versions[0]?.manifest.changedFiles.length, 2);
  assert.deepEqual(left.versions[0]?.manifest.changedFiles.map(({ path }) =>
    path), ["src/a.ts", "src/z.ts"]);
  assert.deepEqual(left.versions[0]?.manifest.affectedComponents, ["src"]);
  assert.equal(left.versions[0]?.reviewReferences[0], fixture.review.reviewId);
  assert.throws(() => {
    (left.versions as unknown as unknown[]).push({});
  });
});

test("ownership, lifecycle, approval, publication, completeness, and stale fences reject", async () => {
  const fixture = await approvedInputs();
  const pendingArtifact = {
    ...fixture.artifact, lifecycle: "awaiting_review" as const,
  };
  const cases: Array<[Partial<AssembleProposalInput>, string]> = [
    [{ repositoryOwnerId: "user-2" },
      "repository_proposal_ownership_conflict"],
    [{ workspace: { ...fixture.workspace, lifecycle: "archived" } },
      "repository_proposal_lifecycle_conflict"],
    [{ workspace: {
      ...fixture.workspace,
      snapshot: { ...fixture.workspace.snapshot, published: false },
    } as unknown as RepositoryWorkspace },
    "repository_proposal_revision_unpublished"],
    [{ artifacts: [pendingArtifact] },
      "repository_proposal_artifact_unapproved"],
    [{ reviews: [{ ...fixture.review, lifecycle: "rejected" }] },
      "repository_proposal_review_unapproved"],
    [{ patches: [] }, "repository_proposal_incomplete"],
    [{ patches: [{
      ...fixture.workspace.patches[0]!, contentHash: "stale",
    }] }, "repository_proposal_patch_unpublished"],
    [{ executionMetadata: {
      ...proposalInput(fixture).executionMetadata, workUnitId: "stale",
    } }, "repository_proposal_revision_stale"],
  ];
  const store = new MemoryRepositoryProposalStore();
  for (const [overrides, code] of cases) {
    await assert.rejects(
      () => store.assemble(proposalInput(fixture, overrides), quotas, now),
      (error: unknown) =>
        error instanceof RepositoryProposalError && error.code === code,
    );
  }
  assert.equal((await store.metrics()).validationFailures, cases.length);
});

test("manifest consistency and quota validation fence unsafe or oversized outputs", async () => {
  const fixture = await approvedInputs();
  const artifact = fixture.artifact;
  const version = artifact.versions[0]!;
  const unsafeArtifact = {
    ...artifact,
    versions: [{
      ...version,
      structuredContent: {
        ...version.structuredContent,
        operations: [{
          ...version.structuredContent.operations[0]!, path: "../escape.ts",
        }],
      },
    }],
  };
  await assert.rejects(() => new MemoryRepositoryProposalStore().assemble(
    proposalInput({ ...fixture, artifact: unsafeArtifact }), quotas, now,
  ), (error: unknown) => error instanceof RepositoryProposalError &&
    error.code === "repository_proposal_manifest_invalid");
  await assert.rejects(() => new MemoryRepositoryProposalStore().assemble(
    proposalInput(fixture), { ...quotas, filesPerManifest: 1 }, now,
  ), (error: unknown) => error instanceof RepositoryProposalError &&
    error.code === "repository_proposal_quota_exceeded");
});

test("version fencing, decisions, diagnostics, metrics, and immutable history persist", async () => {
  const fixture = await approvedInputs();
  const store = new MemoryRepositoryProposalStore();
  const proposal = await store.assemble(proposalInput(fixture), quotas, now);
  assert.ok(proposal.diagnostics.some((item) =>
    item.sourceType === "patch" && item.code === "public_export"));
  await assert.rejects(() => store.decide({
    tenantId: proposal.tenantId, proposalId: proposal.proposalId,
    ownerId: proposal.ownerId, reviewerId: "reviewer",
    proposalVersion: 2, verdict: "approved", rationaleCodes: [],
    idempotencyKey: "stale",
  }, now), (error: unknown) => error instanceof RepositoryProposalError &&
    error.code === "repository_proposal_version_stale");
  const rejected = await store.decide({
    tenantId: proposal.tenantId, proposalId: proposal.proposalId,
    ownerId: proposal.ownerId, reviewerId: "reviewer",
    proposalVersion: 1, verdict: "rejected", rationaleCodes: ["scope"],
    idempotencyKey: "reject",
  }, new Date(now.getTime() + 1));
  const next = await store.assemble(proposalInput(fixture, {
    baseProposalVersion: 1,
  }), quotas, new Date(now.getTime() + 2));
  assert.equal(next.proposalVersion, 2);
  assert.equal(next.versions[0]?.outputHash, rejected.versions[0]?.outputHash);
  const metrics = await store.metrics();
  assert.equal(metrics.proposalsAssembled, 2);
  assert.equal(metrics.rejectedProposals, 1);
  assert.ok(metrics.manifestSize > 0);
  assert.ok(metrics.diagnosticsCount > 0);
  await assert.doesNotReject(() => store.verify(quotas));
});

test("recovery and retention preserve audit records and collect terminal proposals", async () => {
  const firstFixture = await approvedInputs();
  const recoverStore = new MemoryRepositoryProposalStore();
  const recoverable = await recoverStore.assemble(
    proposalInput(firstFixture, {
      assemblyLeaseExpiresAt: new Date(now.getTime() + 500).toISOString(),
    }), quotas, now);
  recoverStore.hydrate({ ...recoverable, lifecycle: "assembling" });
  assert.equal(await recoverStore.recover(
    new Date(now.getTime() + 1_001), quotas), 1);
  const recovered = await recoverStore.get(
    recoverable.tenantId, recoverable.proposalId, recoverable.ownerId);
  assert.equal(recovered?.lifecycle, "expired");
  assert.equal(recovered?.recoveryHistory[0]?.reason, "incomplete_assembly");

  const staleStore = new MemoryRepositoryProposalStore();
  staleStore.hydrate({
    ...recoverable, lifecycle: "validating", versions: [],
  });
  assert.equal(await staleStore.recover(now, quotas), 1);
  assert.equal((await staleStore.get(
    recoverable.tenantId, recoverable.proposalId, recoverable.ownerId,
  ))?.recoveryHistory.at(-1)?.reason, "stale_proposal_version");

  const abandonedStore = new MemoryRepositoryProposalStore();
  abandonedStore.hydrate({
    ...recoverable, lifecycle: "created",
    updatedAt: new Date(now.getTime() - 2_000).toISOString(),
    assemblyLeaseExpiresAt: null,
  });
  assert.equal(await abandonedStore.recover(now, quotas), 1);
  assert.equal((await abandonedStore.get(
    recoverable.tenantId, recoverable.proposalId, recoverable.ownerId,
  ))?.recoveryHistory.at(-1)?.reason, "abandoned_proposal_creation");

  const store = new MemoryRepositoryProposalStore();
  const first = await store.assemble(proposalInput(firstFixture), quotas, now);
  await store.decide({
    tenantId: first.tenantId, proposalId: first.proposalId,
    ownerId: first.ownerId, reviewerId: "reviewer", proposalVersion: 1,
    verdict: "approved", rationaleCodes: [], idempotencyKey: "approve-first",
  }, now);
  const secondFixture = await approvedInputs(
    "execution-proposal-2", "work-unit-proposal-2");
  const secondInput = proposalInput(secondFixture);
  const second = await store.assemble(secondInput, quotas, now);
  await store.decide({
    tenantId: second.tenantId, proposalId: second.proposalId,
    ownerId: second.ownerId, reviewerId: "reviewer", proposalVersion: 1,
    verdict: "rejected", rationaleCodes: [], idempotencyKey: "reject-second",
  }, now);
  assert.equal(await store.collect("user-1", quotas), 1);
});

test("PostgreSQL adapter matches memory assembly and startup verification", async () => {
  const fixture = await approvedInputs();
  let state: unknown = null;
  const client = {
    rpc(name: string, parameters: Record<string, unknown> = {}) {
      let data: unknown;
      if (name === "get_repository_change_proposal") {
        data = state ? [{ proposal: structuredClone(state) }] : [];
      } else if (name === "count_repository_workspace_proposals") {
        data = [{ proposal_count: state ? 1 : 0 }];
      } else if (name === "save_repository_change_proposal") {
        state = structuredClone(parameters.input_proposal);
        data = [{ proposal: structuredClone(state) }];
      } else if (name === "verify_repository_change_proposal_contract") {
        data = [{ valid: true, problems: [] }];
      } else if (name === "repository_change_proposal_metrics") {
        data = [{ metrics: {
          proposalsAssembled: 1, validationFailures: 0,
          rejectedProposals: 0, manifestSize: 1, diagnosticsCount: 1,
          assemblyLatencyMs: 0, recoveryCount: 0,
        } }];
      } else data = [];
      return Promise.resolve({ data, error: null });
    },
  };
  const expected = await new MemoryRepositoryProposalStore().assemble(
    proposalInput(fixture), quotas, now);
  const postgres = new PostgresRepositoryProposalStore(client);
  const actual = await postgres.assemble(proposalInput(fixture), quotas, now);
  assert.deepEqual(actual, expected);
  assert.deepEqual(await postgres.get(
    actual.tenantId, actual.proposalId, actual.ownerId), expected);
  await assert.doesNotReject(() => postgres.verify());
});

test("service metrics, migration contracts, startup, and safety boundaries are complete", async () => {
  const fixture = await approvedInputs();
  const store = new MemoryRepositoryProposalStore();
  const logs: Array<{ operation: string; fields: Record<string, unknown> }> = [];
  const engine = new RepositoryProposalEngine(store, quotas, {
    info(operation, fields) { logs.push({ operation, fields: fields ?? {} }); },
    warn() {}, error() {}, debug() {}, async flush() {},
  });
  const proposal = await engine.assemble(proposalInput(fixture));
  assert.equal(proposal.proposalId, proposalIdentity(proposalInput(fixture)));
  assert.ok(logs.some((entry) =>
    entry.operation === "repository_proposal.assembled" &&
    entry.fields.proposalId === proposal.proposalId));
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0, uptimeSeconds: () => 1,
  });
  registry.recordRepositoryProposal(await engine.metrics());
  for (const metric of [
    "giro_repository_proposals_assembled_total",
    "giro_repository_proposal_validation_failures_total",
    "giro_repository_proposal_rejections_total",
    "giro_repository_proposal_manifest_bytes_total",
    "giro_repository_proposal_diagnostics_total",
    "giro_repository_proposal_assembly_latency_ms_total",
    "giro_repository_proposal_recoveries_total",
  ]) assert.match(registry.render(), new RegExp(metric));

  const [migration, startup, sources] = await Promise.all([
    readFile(new URL(
      "../../supabase/migrations/20260815000000_add_pull_request_assembly_change_manifest_engine.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8"),
    Promise.all([
      readFile(new URL(
        "../services/repositoryProposal/store.ts", import.meta.url), "utf8"),
      readFile(new URL(
        "../services/repositoryProposal/validation.ts", import.meta.url),
      "utf8"),
    ]).then((items) => items.join("\n")),
  ]);
  for (const table of [
    "repository_change_proposals", "repository_change_proposal_versions",
    "repository_change_manifests", "repository_change_proposal_diagnostics",
    "repository_change_proposal_archives",
    "repository_change_proposal_retention",
  ]) assert.match(migration,
    new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "foreign key", "create index", "check\\(", "enable row level security",
    "grant execute", "collect_repository_change_proposals",
    "verify_repository_change_proposal_contract",
  ]) assert.match(migration.toLowerCase(), new RegExp(contract));
  assert.ok(startup.indexOf("runtimeRepositoryProposalEngine.verify") <
    startup.indexOf("server = serve"));
  for (const forbidden of [
    "node:fs", "child_process", "simple-git", "exec(", "spawn(",
    "writeFile", "fetch(", "axios", "createPullRequest", "createBranch",
  ]) assert.doesNotMatch(sources,
    new RegExp(forbidden.replace("(", "\\(")));
  assert.equal((proposal as RepositoryProposal).lifecycle, "awaiting_review");
});
