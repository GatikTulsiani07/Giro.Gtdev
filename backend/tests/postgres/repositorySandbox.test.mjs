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
const sandboxId = `sandbox_${"b".repeat(24)}`;
const timestamp = "2099-08-20T00:00:00.000Z";

function state(overrides = {}) {
  const lease = {
    leaseId: `sandbox_lease_${"c".repeat(24)}`,
    sandboxId,
    ownerId: "user-1",
    leaseOwner: "worker-1",
    fencingToken: 1,
    claimToken: "d".repeat(64),
    startedAt: timestamp,
    renewedAt: timestamp,
    expiresAt: "2099-08-20T01:00:00.000Z",
    renewals: 0,
    releasedAt: null,
  };
  return {
    sandboxId,
    schemaVersion: "repository-sandbox-schema-v1",
    persistenceVersion: 1,
    tenantId: "tenant-1",
    repositoryId: "acme/widgets",
    workflowId: "workflow-1",
    executionId: "execution-1",
    ownerId: "user-1",
    repositoryRevision: revision,
    workspaceRoot: `/durable/sandboxes/tenant_1/${sandboxId}`,
    lifecycle: "leased",
    workspace: {
      repositorySnapshot: {
        snapshotId: `sandbox_snapshot_${"e".repeat(24)}`,
        repositoryId: "acme/widgets",
        repositoryRevision: revision,
        contentFingerprint: "f".repeat(64),
        capturedAt: timestamp,
      },
      repositoryRevision: revision,
      manifest: { packageManager: "pnpm" },
      dependencyMetadata: { lockfile: "pnpm-lock.yaml" },
      workspaceFingerprint: "1".repeat(64),
      preparedAt: timestamp,
      preparationLatencyMs: 10,
    },
    leases: [lease],
    recoveryHistory: [],
    archiveMetadata: null,
    failureReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    readyAt: timestamp,
    releasedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

test("PostgreSQL sandbox enforces durable leases, CAS, isolation, metrics, recovery, grants, RLS, and retention",
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
        select sandbox from public.save_repository_sandbox(${json(initial)},null)
      `));
      assert.equal(saved.sandboxId, sandboxId);
      assert.equal(scalar(url,
        "select count(*) from public.repository_sandbox_leases"), "1");
      assert.equal(scalar(url, `
        select sandbox is null from public.get_repository_sandbox(
          'tenant-2','user-1','acme/widgets','${sandboxId}'
        )
      `), "");
      assert.equal(scalar(url, `
        select sandbox is null from public.get_repository_sandbox(
          'tenant-1','user-2','acme/widgets','${sandboxId}'
        )
      `), "");

      const releasedAt = "2099-08-20T00:10:00.000Z";
      const releasedLease = {
        ...initial.leases[0],
        renewedAt: "2099-08-20T00:05:00.000Z",
        expiresAt: "2099-08-20T01:05:00.000Z",
        renewals: 1,
        releasedAt,
      };
      const released = state({
        persistenceVersion: 2,
        lifecycle: "released",
        leases: [releasedLease],
        updatedAt: releasedAt,
        releasedAt,
      });
      scalar(url, `
        select sandbox from public.save_repository_sandbox(${json(released)},'1')
      `);
      assert.equal(scalar(url, `
        select renewals||':'||(released_at is not null)::text
        from public.repository_sandbox_leases
      `), "1:true");

      const stale = psql(url, `
        select sandbox from public.save_repository_sandbox(
          ${json({ ...released, persistenceVersion: 3 })},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_sandbox_version_conflict/);

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_sandbox_metrics('tenant-1')
      `));
      assert.equal(metrics.sandboxCreation, 1);
      assert.equal(metrics.activeLeases, 0);
      assert.equal(metrics.leaseRenewals, 1);
      assert.equal(metrics.preparationLatencyMs, 10);
      assert.equal(scalar(url, `
        select valid from public.verify_repository_sandbox_contract(
          'repository-sandbox-v1','repository-sandbox-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_sandboxes'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_sandboxes','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role','public.save_repository_sandbox(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select public.recover_orphan_repository_sandbox_metadata()
      `), "0");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_repository_sandboxes('tenant-1',1,2)
      `), "0");
    });
  });
