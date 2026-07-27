import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigrations, postgresAvailability, psql, scalar,
  seedRepositorySql, withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const revision = "b".repeat(40);
const workspaceId = `repository_workspace_${"e".repeat(24)}`;
const patchId = `repository_patch_${"f".repeat(24)}`;
const artifactId = `repository_artifact_${"a".repeat(24)}`;
const reviewId = `repository_quality_review_${"b".repeat(24)}`;
const proposalId = `repository_proposal_${"c".repeat(24)}`;
const timestamp = "2099-08-15T00:00:00.000Z";
const artifactHash = "1".repeat(64);
const reviewHash = "2".repeat(64);
const patchHash = "3".repeat(64);

function proposalState(overrides = {}) {
  const diagnostic = {
    diagnosticId: `repository_proposal_diagnostic_${"4".repeat(24)}`,
    proposalId, proposalVersion: 1, code: "public_export",
    severity: "warning", message: "Confirm public export.",
    affectedFiles: ["src/a.ts"], affectedSymbols: ["a"],
    sourceType: "patch", sourceId: patchId, createdAt: timestamp,
  };
  const manifest = {
    schemaVersion: "repository-proposal-output-v1",
    changedFiles: [{
      path: "src/a.ts", operations: ["create_file"],
      artifactIds: [artifactId], patchVersions: [1],
    }],
    changedSymbols: [{
      filePath: "src/a.ts", symbol: "a", artifactIds: [artifactId],
    }],
    patchSummaries: [{
      patchId, patchVersion: 1, contentHash: patchHash,
      operationCount: 2, affectedFiles: ["src/a.ts"],
    }],
    reviewSummaries: [{
      reviewId, reviewVersion: 1, artifactId, verdict: "approved",
      confidence: 1, findingCount: 0,
    }],
    diagnostics: [diagnostic], confidence: 1,
    risks: ["public_export"], affectedComponents: ["src"],
    validationSummary: {
      valid: true, gateCount: 8, passedGateCount: 8,
      findings: [
        "ownership", "lifecycle", "version_fencing", "completeness",
        "artifact_approval", "review_approval", "manifest_consistency",
        "quota_validation",
      ].map((category) => ({ category, passed: true, codes: [] })),
    },
  };
  const metrics = {
    artifactCount: 1, reviewCount: 1, patchCount: 1,
    changedFileCount: 1, changedSymbolCount: 1,
    diagnosticCount: 1, manifestBytes: 1024,
  };
  const version = {
    proposalId, proposalVersion: 1, outputHash: "5".repeat(64),
    title: "Proposed changes for acme/widgets",
    summary: "1 file, 1 symbol, 1 approved artifact.",
    detailedDescription: "Deterministic proposal package.",
    manifest, reviewReferences: [reviewId], artifactReferences: [artifactId],
    diagnostics: [diagnostic], metrics,
    assemblyMetadata: {
      engineVersion: "repository-proposal-engine-v1",
      schemaVersion: "repository-proposal-output-v1",
      deterministicSeed: "6".repeat(64), repositoryRevision: revision,
      executionVersion: "execution-v1", workspacePersistenceVersion: 1,
      artifactVersions: [{
        artifactId, artifactVersion: 1, contentHash: artifactHash,
      }],
      reviewVersions: [{
        reviewId, reviewVersion: 1, outputHash: reviewHash,
      }],
      patchVersions: [{
        patchId, patchVersion: 1, contentHash: patchHash,
      }],
      assembledAt: timestamp, assemblyLatencyMs: 0,
    },
    createdAt: timestamp, assembledAt: timestamp, validatedAt: timestamp,
  };
  return {
    proposalId, schemaVersion: "repository-proposal-schema-v1",
    persistenceVersion: 1, tenantId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    executionId: "execution-1", workspaceId, ownerId: "user-1",
    proposalVersion: 1, lifecycle: "awaiting_review", versions: [version],
    diagnostics: [diagnostic], decisions: [], lifecycleHistory: [],
    recoveryHistory: [], archiveMetadata: null,
    validationFailureCount: 0, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    reviewRequestedAt: timestamp, assemblyLeaseExpiresAt: null,
    ...overrides,
  };
}

test("PostgreSQL proposal engine enforces normalized manifests, CAS, isolation, metrics, RLS, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',
          indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
      const patch = {
        patchId, workspaceId, executionId: "execution-1",
        workUnitId: "work-unit-1", patchVersion: 1,
        snapshotHash: "7".repeat(64), fileOperations: [{
          operation: "create_file", path: "src/a.ts",
          content: "export const a = 1;\n",
        }], symbolOperations: [{
          operation: "add_symbol", filePath: "src/a.ts", symbol: "a",
          declaration: "export const a = 1;",
        }], diagnostics: [], confidence: 1, contentHash: patchHash,
        createdAt: timestamp, validatedAt: timestamp,
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
          'snapshot-v1','${"7".repeat(64)}','active',
          ${json({
            leaseId: "lease-1", ownerId: "user-1", claimToken: "claim",
            acquiredAt: timestamp, heartbeatAt: timestamp,
            expiresAt: "2099-08-15T01:00:00.000Z",
          })},
          ${json({ persistenceVersion: 1, patches: [patch] })},0,0,0,
          '${timestamp}'::timestamptz,'${timestamp}'::timestamptz
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
        insert into public.repository_quality_reviews(
          tenant_id,review_id,schema_version,repository_id,
          repository_revision,artifact_id,workspace_id,execution_id,
          work_unit_id,owner_id,reviewer_type,review_version,lifecycle,state,
          validation_failure_count,recovery_count,created_at,updated_at,
          completed_at
        ) values(
          'user-1','${reviewId}','repository-review-schema-v1',
          'acme/widgets','${revision}','${artifactId}','${workspaceId}',
          'execution-1','work-unit-1','user-1','system',1,'approved',
          ${json({
            persistenceVersion: 2,
            versions: [{ reviewVersion: 1, outputHash: reviewHash }],
          })},0,0,'${timestamp}'::timestamptz,
          '${timestamp}'::timestamptz,'${timestamp}'::timestamptz
        )
      `);

      const initial = proposalState();
      const saved = JSON.parse(scalar(url, `
        select proposal from public.save_repository_change_proposal(
          ${json(initial)},null
        )
      `));
      assert.equal(saved.proposalId, proposalId);
      assert.equal(scalar(url,
        "select count(*) from public.repository_change_proposal_versions"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_change_manifests"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_change_proposal_diagnostics"),
      "1");
      assert.equal(scalar(url, `
        select proposal is null
        from public.get_repository_change_proposal('user-2','${proposalId}')
      `), "");

      const decision = {
        decisionId: `repository_proposal_decision_${"8".repeat(24)}`,
        proposalId, proposalVersion: 1, ownerId: "user-1",
        reviewerId: "reviewer-1", verdict: "approved",
        rationaleCodes: ["ready"], idempotencyKey: "approve-1",
        createdAt: "2099-08-15T00:00:01.000Z",
      };
      const approved = proposalState({
        persistenceVersion: 2, lifecycle: "approved", decisions: [decision],
        updatedAt: decision.createdAt, completedAt: decision.createdAt,
        assemblyLeaseExpiresAt: null,
      });
      scalar(url, `
        select proposal from public.save_repository_change_proposal(
          ${json(approved)},'1'
        )
      `);
      assert.equal(scalar(url,
        "select count(*) from public.repository_change_proposal_decisions"),
      "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_change_proposal_versions"), "1");

      const stale = psql(url, `
        select proposal from public.save_repository_change_proposal(
          ${json({ ...approved, persistenceVersion: 3 })},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_proposal_version_conflict/);

      const metrics = JSON.parse(scalar(url, `
        select metrics
        from public.repository_change_proposal_metrics('user-1')
      `));
      assert.equal(metrics.proposalsAssembled, 1);
      assert.equal(metrics.manifestSize, 1024);
      assert.equal(metrics.diagnosticsCount, 1);
      assert.equal(scalar(url, `
        select valid from public.verify_repository_change_proposal_contract(
          'repository-proposal-engine-v1','repository-proposal-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_change_proposals'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_change_proposals','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_repository_change_proposal(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_repository_change_proposals('user-1',1,2,10)
      `), "0");
    });
  });
