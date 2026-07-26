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
const reviewId = `repository_quality_review_${"d".repeat(24)}`;
const timestamp = "2099-08-14T00:00:00.000Z";

function reviewState(overrides = {}) {
  const finding = {
    findingId: `repository_review_finding_${"1".repeat(24)}`,
    reviewId, reviewVersion: 1, severity: "info",
    category: "schema_correctness", affectedFile: null, affectedSymbol: null,
    explanation: "schema_correctness gate passed.",
    recommendation: "No corrective action required.", createdAt: timestamp,
  };
  const diagnostic = {
    diagnosticId: `repository_review_diagnostic_${"2".repeat(24)}`,
    reviewId, reviewVersion: 1, code: "review_export",
    message: "Review public export.", severity: "warning", createdAt: timestamp,
  };
  const version = {
    reviewId, reviewVersion: 1, artifactVersion: 1,
    outputHash: "3".repeat(64), verdict: "approved", confidence: 1,
    findings: [finding], diagnostics: [diagnostic],
    metrics: {
      gateCount: 10, passedGateCount: 10, infoCount: 10,
      warningCount: 0, errorCount: 0, blockerCount: 0,
    },
    reviewMetadata: {
      engineVersion: "repository-review-engine-v1",
      schemaVersion: "repository-review-output-v1",
      deterministicSeed: "4".repeat(64), artifactVersion: 1,
      artifactContentHash: "5".repeat(64), snapshotVersion: "snapshot-v1",
      snapshotHash: "6".repeat(64), patchVersion: 1,
      patchHash: "7".repeat(64), graphVersion: "graph-v1",
      intelligenceVersion: "intelligence-v1", planningVersion: "planning-v1",
      executionVersion: "execution-v1", validatedAt: timestamp,
      validationLatencyMs: 0,
    },
    createdAt: timestamp, validatedAt: timestamp,
  };
  return {
    reviewId, schemaVersion: "repository-review-schema-v1",
    persistenceVersion: 1, tenantId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    artifactId, workspaceId, executionId: "execution-1",
    workUnitId: "work-unit-1", ownerId: "user-1", reviewerType: "system",
    reviewVersion: 1, lifecycle: "awaiting_decision", versions: [version],
    findings: [finding], diagnostics: [diagnostic], decisions: [],
    lifecycleHistory: [], recoveryHistory: [], archiveMetadata: null,
    validationFailureCount: 0, recoveryCount: 0,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    decisionRequestedAt: timestamp, reviewLeaseExpiresAt: null,
    ...overrides,
  };
}

test("PostgreSQL quality review engine enforces normalized history, findings, CAS, isolation, metrics, RLS, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `
        update public.repositories set
          status='indexed',current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'
      `);
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
          'snapshot-v1','${"6".repeat(64)}','active',
          ${json({
            leaseId: "lease-1", ownerId: "user-1", claimToken: "claim",
            acquiredAt: timestamp, heartbeatAt: timestamp,
            expiresAt: "2099-08-14T01:00:00.000Z",
          })},
          ${json({ persistenceVersion: 1 })},0,0,0,
          '${timestamp}'::timestamptz,'${timestamp}'::timestamptz
        )
      `);
      psql(url, `
        insert into public.repository_proposed_artifacts(
          tenant_id,artifact_id,schema_version,repository_id,
          repository_revision,workspace_id,execution_id,work_unit_id,
          owner_id,artifact_type,artifact_version,lifecycle,state,
          validation_failure_count,recovery_count,created_at,updated_at
        ) values(
          'user-1','${artifactId}','repository-artifact-schema-v1',
          'acme/widgets','${revision}','${workspaceId}','execution-1',
          'work-unit-1','user-1','source_code',1,'awaiting_review',
          ${json({ persistenceVersion: 1 })},0,0,
          '${timestamp}'::timestamptz,'${timestamp}'::timestamptz
        )
      `);

      const initial = reviewState();
      const saved = JSON.parse(scalar(url, `
        select review from public.save_repository_quality_review(
          ${json(initial)},null
        )
      `));
      assert.equal(saved.reviewId, reviewId);
      assert.equal(scalar(url,
        "select count(*) from public.repository_quality_review_versions"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_quality_review_findings"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_quality_review_diagnostics"), "1");
      assert.equal(scalar(url, `
        select review is null
        from public.get_repository_quality_review('user-2','${reviewId}')
      `), "");

      const decision = {
        decisionId: `repository_review_decision_${"8".repeat(24)}`,
        reviewId, reviewVersion: 1, ownerId: "user-1",
        reviewerId: "reviewer-1", verdict: "approved",
        rationaleCodes: ["all_gates_passed"], idempotencyKey: "approve-1",
        createdAt: "2099-08-14T00:00:01.000Z",
      };
      const approved = reviewState({
        persistenceVersion: 2, lifecycle: "approved", decisions: [decision],
        updatedAt: decision.createdAt, completedAt: decision.createdAt,
      });
      scalar(url, `
        select review from public.save_repository_quality_review(
          ${json(approved)},'1'
        )
      `);
      assert.equal(scalar(url,
        "select count(*) from public.repository_quality_review_decisions"), "1");
      assert.equal(scalar(url,
        "select count(*) from public.repository_quality_review_versions"), "1");

      const stale = psql(url, `
        select review from public.save_repository_quality_review(
          ${json({ ...approved, persistenceVersion: 3 })},'1'
        )
      `, { allowFailure: true });
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /repository_review_version_conflict/);

      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_quality_review_metrics('user-1')
      `));
      assert.equal(metrics.reviewsCreated, 1);
      assert.equal(metrics.approvals, 1);
      assert.equal(metrics.reviewLatencyMs, 1000);
      assert.equal(scalar(url, `
        select valid from public.verify_repository_quality_review_contract(
          'repository-review-engine-v1','repository-review-schema-v1'
        )
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.repository_quality_reviews'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_quality_reviews','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.save_repository_quality_review(jsonb,text)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select deleted_count
        from public.collect_repository_quality_reviews('user-1',1,2,10)
      `), "0");
    });
  });
