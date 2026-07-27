import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigrations, postgresAvailability, psql, scalar,
  seedRepositorySql, withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const revision = "c".repeat(40);
const workspaceId = `repository_workspace_${"1".repeat(24)}`;
const patchId = `repository_patch_${"2".repeat(24)}`;
const artifactId = `repository_artifact_${"3".repeat(24)}`;
const proposalId = `repository_proposal_${"4".repeat(24)}`;
const transactionId = `repository_apply_transaction_${"5".repeat(24)}`;
const timestamp = "2099-08-16T00:00:00.000Z";
const patchHash = "6".repeat(64);
const artifactHash = "7".repeat(64);
const proposalHash = "8".repeat(64);

function transactionState(overrides = {}) {
  const operation = {
    operationId: `repository_apply_operation_${"9".repeat(24)}`,
    sequence: 1, operation: "create_file", path: "src/a.ts",
    destinationPath: null, symbol: null,
    content: "export const a = 1;\n", expectedHash: null,
    artifactId, artifactVersion: 1,
  };
  const rollback = {
    rollbackOperationId: `repository_rollback_operation_${"a".repeat(24)}`,
    sequence: 1, sourceOperationId: operation.operationId,
    operation: "delete_created_file", path: "src/a.ts",
    destinationPath: null, symbol: null, sourceExpectedHash: null,
  };
  const diagnostic = {
    diagnosticId: `repository_apply_diagnostic_${"b".repeat(24)}`,
    transactionId, transactionVersion: 1, severity: "warning",
    code: "public_export", message: "Confirm public export.",
    affectedFiles: ["src/a.ts"], affectedSymbols: [], createdAt: timestamp,
  };
  const applyPlan = {
    schemaVersion: "repository-apply-plan-v1",
    orderedOperations: [operation], affectedFiles: ["src/a.ts"],
    affectedSymbols: [],
    dependencyGraph: { operationIds: [operation.operationId], edges: [] },
    rollbackPlan: {
      affectedFiles: ["src/a.ts"], affectedSymbols: [],
      inverseOperations: [rollback], dependencyRollback: [],
      validationCheckpoints: [
        "proposal_hash_matches", "repository_revision_matches",
      ],
    },
    diagnostics: [diagnostic],
    validationSummary: {
      valid: true, gateCount: 9, passedGateCount: 9,
      findings: [
        "ownership", "proposal_approval", "workspace_state",
        "repository_revision", "version_fencing", "quota_validation",
        "lifecycle", "patch_compatibility", "artifact_compatibility",
      ].map((category) => ({ category, passed: true, codes: [] })),
    },
  };
  const version = {
    transactionId, transactionVersion: 1, planHash: "d".repeat(64),
    applyPlan,
    preparationMetadata: {
      engineVersion: "repository-apply-engine-v1",
      schemaVersion: "repository-apply-plan-v1",
      deterministicSeed: "e".repeat(64),
      proposalVersion: 1, proposalOutputHash: proposalHash,
      workspacePersistenceVersion: 1, snapshotHash: "f".repeat(64),
      executionVersion: "execution-v1",
      artifactVersions: [{
        artifactId, artifactVersion: 1, contentHash: artifactHash,
      }],
      patchVersions: [{
        patchId, patchVersion: 1, contentHash: patchHash,
      }],
      preparedAt: timestamp, preparationLatencyMs: 0,
    },
    createdAt: timestamp, preparedAt: timestamp, validatedAt: timestamp,
  };
  return {
    transactionId, schemaVersion: "repository-apply-schema-v1",
    persistenceVersion: 1, tenantId: "user-1", proposalId,
    repositoryId: "acme/widgets", repositoryRevision: revision,
    executionId: "execution-1", workspaceId, ownerId: "user-1",
    transactionVersion: 1, lifecycle: "awaiting_confirmation",
    versions: [version], diagnostics: [diagnostic], confirmations: [],
    lifecycleHistory: [], recoveryHistory: [], archiveMetadata: null,
    validationFailureCount: 0, conflictCount: 0, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    confirmationRequestedAt: timestamp, applyLeaseExpiresAt: null,
    ...overrides,
  };
}

test("PostgreSQL apply coordinator enforces normalized plans, rollback metadata, CAS, isolation, metrics, RLS, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set status='indexed',
          current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      const patch = {
        patchId, workspaceId, executionId: "execution-1",
        workUnitId: "work-unit-1", patchVersion: 1,
        snapshotHash: "f".repeat(64), fileOperations: [{
          operation: "create_file", path: "src/a.ts",
          content: "export const a = 1;\n",
        }], symbolOperations: [], diagnostics: [], confidence: 1,
        contentHash: patchHash, createdAt: timestamp, validatedAt: timestamp,
      };
      psql(url, `
        insert into public.repository_workspaces(
          tenant_id,workspace_id,schema_version,repository_id,
          repository_revision,execution_id,work_unit_id,owner_id,
          snapshot_version,snapshot_hash,lifecycle,lease,state,
          conflict_count,validation_failure_count,recovery_count,
          created_at,updated_at
        ) values(
          'user-1','${workspaceId}','repository-workspace-schema-v1',
          'acme/widgets','${revision}','execution-1','work-unit-1','user-1',
          'snapshot-v1','${"f".repeat(64)}','active',
          ${json({
            leaseId: "lease-1", ownerId: "user-1", claimToken: "claim",
            acquiredAt: timestamp, heartbeatAt: timestamp,
            expiresAt: "2099-08-16T01:00:00.000Z",
          })},${json({ persistenceVersion: 1, patches: [patch] })},
          0,0,0,'${timestamp}'::timestamptz,'${timestamp}'::timestamptz
        )
      `);
      psql(url, `
        insert into public.repository_proposed_artifacts(
          tenant_id,artifact_id,schema_version,repository_id,
          repository_revision,workspace_id,execution_id,work_unit_id,
          owner_id,artifact_type,artifact_version,lifecycle,state,
          validation_failure_count,recovery_count,created_at,updated_at,
          completed_at
        ) values(
          'user-1','${artifactId}','repository-artifact-schema-v1',
          'acme/widgets','${revision}','${workspaceId}','execution-1',
          'work-unit-1','user-1','source_code',1,'approved',
          ${json({
            persistenceVersion: 2,
            versions: [{ artifactVersion: 1, contentHash: artifactHash }],
          })},0,0,'${timestamp}'::timestamptz,
          '${timestamp}'::timestamptz,'${timestamp}'::timestamptz
        )
      `);
      psql(url, `
        insert into public.repository_change_proposals(
          tenant_id,proposal_id,schema_version,repository_id,
          repository_revision,execution_id,workspace_id,owner_id,
          proposal_version,lifecycle,state,validation_failure_count,
          recovery_count,created_at,updated_at,completed_at
        ) values(
          'user-1','${proposalId}','repository-proposal-schema-v1',
          'acme/widgets','${revision}','execution-1','${workspaceId}',
          'user-1',1,'approved',
          ${json({
            persistenceVersion: 2,
            versions: [{ proposalVersion: 1, outputHash: proposalHash }],
          })},0,0,'${timestamp}'::timestamptz,
          '${timestamp}'::timestamptz,'${timestamp}'::timestamptz
        )
      `);

      const initial = transactionState();
      const saved = JSON.parse(scalar(url, `
        select transaction from public.save_repository_apply_transaction(
          ${json(initial)},null
        )
      `));
      assert.equal(saved.transactionId, transactionId);
      assert.equal(scalar(url,
        "select count(*) from public.repository_apply_transaction_versions"),
      "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_apply_plans"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_apply_rollbacks"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_apply_diagnostics"), "1");
      assert.equal(scalar(url, `
        select transaction is null from public.get_repository_apply_transaction(
          'user-2','${transactionId}'
        )
      `), "");

      const confirmation = {
        confirmationId: `repository_apply_confirmation_${"c".repeat(24)}`,
        transactionId, transactionVersion: 1, ownerId: "user-1",
        confirmerId: "owner", decision: "ready",
        rationaleCodes: ["confirmed"], idempotencyKey: "confirm-1",
        createdAt: "2099-08-16T00:00:01.000Z",
      };
      const ready = transactionState({
        persistenceVersion: 2, lifecycle: "ready",
        confirmations: [confirmation], updatedAt: confirmation.createdAt,
        completedAt: confirmation.createdAt,
      });
      scalar(url, `
        select transaction from public.save_repository_apply_transaction(
          ${json(ready)},'1'
        )
      `);
      assert.equal(scalar(url,
        "select count(*) from public.repository_apply_confirmations"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_apply_transaction_versions"),
      "1");

      const stale = psql(url, `
        select transaction from public.save_repository_apply_transaction(
          ${json({ ...ready, persistenceVersion: 3 })},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_apply_version_conflict/);
      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_apply_transaction_metrics(
          'user-1'
        )
      `));
      assert.equal(metrics.transactionsCreated, 1);
      assert.equal(metrics.rollbackPlans, 1);
      assert.equal(scalar(url, `
        select valid from public.verify_repository_apply_contract(
          'repository-apply-engine-v1','repository-apply-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_apply_transactions'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_apply_transactions','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_repository_apply_transaction(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_repository_apply_transactions('user-1',1,2,10)
      `), "0");
    });
  });
