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
const timestamp = "2099-08-12T00:00:00.000Z";

function state(overrides = {}) {
  const snapshot = {
    published: true, tenantId: "user-1", repositoryId: "acme/widgets",
    repositoryRevision: revision, snapshotVersion: "snapshot-v1",
    revisionHash: revision, graphVersion: "graph-v1",
    intelligenceVersion: "intelligence-v1", retrievalVersion: "retrieval-v2",
    planningVersion: "planning-v1",
    snapshotId: `repository_workspace_snapshot_${"c".repeat(24)}`,
    snapshotHash: "d".repeat(64), createdAt: timestamp,
  };
  return {
    workspaceId, schemaVersion: "repository-workspace-schema-v1",
    persistenceVersion: 1, tenantId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    executionId: "execution-1", workUnitId: "work-unit-1", ownerId: "user-1",
    snapshotVersion: "snapshot-v1", lifecycle: "active", snapshot,
    lease: {
      leaseId: `repository_workspace_lease_${"e".repeat(24)}`,
      ownerId: "user-1", claimToken: "f".repeat(64),
      acquiredAt: timestamp, heartbeatAt: timestamp,
      expiresAt: "2099-08-12T01:00:00.000Z",
    },
    patches: [], diagnostics: [], recoveryHistory: [],
    archiveMetadata: null, conflictCount: 0, validationFailureCount: 0,
    recoveryCount: 0, createdAt: timestamp, updatedAt: timestamp,
    completedAt: null, ...overrides,
  };
}

test("PostgreSQL workspace matches CAS, normalized patch, isolation, metrics, and retention contracts",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      const initial = state();
      const saved = JSON.parse(scalar(url, `
        select workspace from public.save_repository_workspace(${json(initial)},null)
      `));
      assert.equal(saved.workspaceId, workspaceId);
      assert.equal(scalar(url, `
        select count(*) from public.repository_workspace_snapshots
      `), "1");
      assert.equal(scalar(url, `
        select workspace is null from public.get_repository_workspace('user-2','${workspaceId}')
      `), "");

      const patch = {
        patchId: `repository_patch_${"1".repeat(24)}`,
        workspaceId, executionId: "execution-1", workUnitId: "work-unit-1",
        patchVersion: 1, snapshotHash: initial.snapshot.snapshotHash,
        fileOperations: [{ operation: "create_file", path: "src/a.ts", content: "a" }],
        symbolOperations: [{ operation: "add_symbol", filePath: "src/a.ts",
          symbol: "a", declaration: "export const a = 1;" }],
        diagnostics: [{ severity: "warning", code: "review", message: "Review.",
          affectedFiles: ["src/a.ts"], affectedSymbols: ["a"] }],
        confidence: 0.9, contentHash: "2".repeat(64),
        createdAt: "2099-08-12T00:00:01.000Z",
        validatedAt: "2099-08-12T00:00:01.000Z",
      };
      const diagnostic = {
        ...patch.diagnostics[0],
        diagnosticId: `repository_workspace_diagnostic_${"3".repeat(24)}`,
        patchId: patch.patchId, createdAt: patch.createdAt,
      };
      const updated = state({
        persistenceVersion: 2, patches: [patch], diagnostics: [diagnostic],
        updatedAt: patch.createdAt,
      });
      scalar(url, `
        select workspace from public.save_repository_workspace(${json(updated)},'1')
      `);
      assert.equal(scalar(url, `select count(*) from public.repository_patches`), "1");
      assert.equal(scalar(url, `select count(*) from public.repository_patch_versions`), "1");
      assert.equal(scalar(url, `
        select count(*) from public.repository_workspace_diagnostics
      `), "1");

      const stale = psql(url, `
        select workspace from public.save_repository_workspace(
          ${json({ ...updated, persistenceVersion: 3 })},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_workspace_version_conflict/);

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_workspace_metrics('user-1')
      `));
      assert.equal(metrics.workspaceCreation, 1);
      assert.equal(metrics.activeWorkspaces, 1);
      assert.equal(metrics.patchGeneration, 1);
      assert.equal(scalar(url, `
        select jsonb_array_length(workspaces)
        from public.list_recoverable_repository_workspaces()
      `), "1");
      assert.equal(scalar(url, `
        select valid from public.verify_repository_workspace_contract(
          'repository-workspace-patch-v1','repository-patch-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_workspaces'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege('anon','public.repository_workspaces','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role','public.save_repository_workspace(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count from public.collect_repository_workspaces('user-1',1,2,2)
      `), "0");
    });
  });
