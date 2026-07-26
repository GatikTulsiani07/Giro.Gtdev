import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigrations, postgresAvailability, psql, scalar,
  seedRepositorySql, withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const revision = "a".repeat(40);
const workspaceId = `repository_workspace_${"b".repeat(24)}`;
const artifactId = `repository_artifact_${"c".repeat(24)}`;
const timestamp = "2099-08-13T00:00:00.000Z";

function workspaceState() {
  const patch = {
    patchId: `repository_patch_${"d".repeat(24)}`,
    workspaceId, executionId: "execution-1", workUnitId: "work-unit-1",
    patchVersion: 1, snapshotHash: "e".repeat(64),
    fileOperations: [{
      operation: "create_file", path: "src/a.ts", content: "export const a = 1;",
    }],
    symbolOperations: [], diagnostics: [], confidence: 0.9,
    contentHash: "f".repeat(64), createdAt: timestamp, validatedAt: timestamp,
  };
  return {
    workspaceId, schemaVersion: "repository-workspace-schema-v1",
    persistenceVersion: 1, tenantId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    executionId: "execution-1", workUnitId: "work-unit-1", ownerId: "user-1",
    snapshotVersion: "snapshot-v1", lifecycle: "active",
    snapshot: {
      published: true, tenantId: "user-1", repositoryId: "acme/widgets",
      repositoryRevision: revision, snapshotVersion: "snapshot-v1",
      revisionHash: revision, graphVersion: "graph-v1",
      intelligenceVersion: "intelligence-v1", retrievalVersion: "retrieval-v2",
      planningVersion: "planning-v1",
      snapshotId: `repository_workspace_snapshot_${"1".repeat(24)}`,
      snapshotHash: "e".repeat(64), createdAt: timestamp,
    },
    lease: {
      leaseId: `repository_workspace_lease_${"6".repeat(24)}`,
      ownerId: "user-1", claimToken: "7".repeat(64),
      acquiredAt: timestamp, heartbeatAt: timestamp,
      expiresAt: "2099-08-13T01:00:00.000Z",
    },
    patches: [patch], diagnostics: [], recoveryHistory: [],
    archiveMetadata: null, conflictCount: 0, validationFailureCount: 0,
    recoveryCount: 0, createdAt: timestamp, updatedAt: timestamp,
    completedAt: null,
  };
}

function artifactState(overrides = {}) {
  const version = {
    artifactId, artifactVersion: 1, contentHash: "2".repeat(64),
    structuredContent: {
      schemaVersion: "repository-artifact-content-v1",
      proposalOnly: true, artifactType: "source_code",
      operations: [{
        operation: "create_file", path: "src/a.ts",
        content: "export const a = 1;",
      }],
      sourceHashes: {
        snapshot: "e".repeat(64), patch: "f".repeat(64),
        graph: "graph-hash", intelligence: "intelligence-hash",
        planning: "planning-hash",
      },
    },
    affectedFiles: ["src/a.ts"], affectedSymbols: ["a"],
    diagnostics: [], confidence: 0.9, warnings: [],
    generationMetadata: {
      engineVersion: "repository-artifact-engine-v1",
      schemaVersion: "repository-artifact-schema-v1",
      deterministicSeed: "3".repeat(64), snapshotVersion: "snapshot-v1",
      snapshotHash: "e".repeat(64), patchVersion: 1,
      patchHash: "f".repeat(64), graphVersion: "graph-v1",
      intelligenceVersion: "intelligence-v1", planningVersion: "planning-v1",
      executionVersion: "execution-v1", generatedAt: timestamp,
      generationLatencyMs: 0,
    },
    createdAt: timestamp, generatedAt: timestamp, validatedAt: timestamp,
  };
  const diagnostic = {
    diagnosticId: `repository_artifact_diagnostic_${"4".repeat(24)}`,
    severity: "warning", code: "review", message: "Review proposal.",
    affectedFiles: ["src/a.ts"], affectedSymbols: ["a"], createdAt: timestamp,
  };
  return {
    artifactId, schemaVersion: "repository-artifact-schema-v1",
    persistenceVersion: 1, tenantId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    workspaceId, executionId: "execution-1", workUnitId: "work-unit-1",
    ownerId: "user-1", artifactType: "source_code", artifactVersion: 1,
    lifecycle: "awaiting_review", versions: [version],
    diagnostics: [diagnostic], approvals: [],
    lifecycleHistory: [], recoveryHistory: [], archiveMetadata: null,
    validationFailureCount: 0, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    reviewRequestedAt: timestamp, generationLeaseExpiresAt: null,
    ...overrides,
  };
}

test("PostgreSQL artifact engine enforces durable history, CAS, isolation, startup, metrics, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      scalar(url, `
        select workspace from public.save_repository_workspace(
          ${json(workspaceState())},null
        )
      `);
      const initial = artifactState();
      const saved = JSON.parse(scalar(url, `
        select artifact from public.save_repository_artifact(${json(initial)},null)
      `));
      assert.equal(saved.artifactId, artifactId);
      assert.equal(scalar(url,
        "select count(*) from public.repository_artifact_versions"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_artifact_diagnostics"), "1");
      assert.equal(scalar(url, `
        select artifact is null
        from public.get_repository_artifact('user-2','${artifactId}')
      `), "");

      const approval = {
        approvalId: `repository_artifact_approval_${"5".repeat(24)}`,
        artifactId, artifactVersion: 1, ownerId: "user-1",
        reviewerId: "reviewer-1", decision: "approved", findings: [],
        idempotencyKey: "approve-1",
        createdAt: "2099-08-13T00:00:01.000Z",
      };
      const approved = artifactState({
        persistenceVersion: 2, lifecycle: "approved", approvals: [approval],
        updatedAt: approval.createdAt, completedAt: approval.createdAt,
      });
      scalar(url, `
        select artifact from public.save_repository_artifact(
          ${json(approved)},'1'
        )
      `);
      assert.equal(scalar(url,
        "select count(*) from public.repository_artifact_approvals"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_artifact_versions"), "1");

      const stale = psql(url, `
        select artifact from public.save_repository_artifact(
          ${json({ ...approved, persistenceVersion: 3 })},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_artifact_version_conflict/);

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_artifact_metrics('user-1')
      `));
      assert.equal(metrics.artifactsGenerated, 1);
      assert.equal(metrics.approvalWaitTimeMs, 1000);
      assert.equal(scalar(url, `
        select valid from public.verify_repository_artifact_contract(
          'repository-artifact-engine-v1','repository-artifact-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_proposed_artifacts'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_proposed_artifacts','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role','public.save_repository_artifact(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_repository_artifacts('user-1',1,1,1)
      `), "0");
    });
  });
