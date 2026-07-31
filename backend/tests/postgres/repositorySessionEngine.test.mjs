import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations,
  createJobSql,
  postgresAvailability,
  psql,
  scalar,
  seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "0123456789abcdef0123456789abcdef01234567";
const timestamp = "2099-08-31T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function record(sessionId = "repository-session-1",
  lifecycle = "active") {
  const context = {
    sessionId, contextVersion: 1,
    activeFeature: "feature-payments", activeModule: "payments",
    activeWorkflow: null, activeArchitecture: revision,
    activeChangeAnalysis: null,
    previousQuestions: ["Where is payment handled?"],
    previousAnswers: ["Payment is handled by the payment service."],
    recentFiles: ["src/payment.ts"], recentSymbols: ["symbol-payment"],
    recentFeatures: ["feature-payments"], viewedInsights: ["insight-1"],
    viewedPlans: ["task-1"], viewedSpecifications: ["specification-1"],
    viewedExecutionSummaries: ["execution-1"], updatedAt: timestamp,
  };
  return {
    session: {
      sessionId, schemaVersion: "repository-session-schema-v1",
      persistenceVersion: 1, tenantId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      ownerId: "user-1", userId: "user-1", workflowId: null,
      lifecycle, createdAt: timestamp, updatedAt: timestamp,
      expiresAt: "2099-09-30T00:00:00.000Z", archivedAt: null,
    },
    events: [{
      eventId: "event-1", sessionId, sequence: 1, kind: "query",
      referenceId: "query-1", summary: "Where is payment handled?",
      attributes: {}, createdAt: timestamp,
    }, {
      eventId: "event-2", sessionId, sequence: 2, kind: "answer",
      referenceId: "query-1",
      summary: "Payment is handled by the payment service.",
      attributes: {}, createdAt: timestamp,
    }],
    context,
    diagnostics: [],
    reuseCount: 0,
    recoveryCount: 0,
  };
}

function seed(url) {
  psql(url, seedRepositorySql("acme/widgets"));
  const jobId = scalar(url, createJobSql("acme/widgets"));
  psql(url, `
    insert into public.repository_snapshots(
      repository_id,revision,commit_sha,job_id,status,indexed_at
    ) values(
      'acme/widgets','${revision}','${revision}','${jobId}',
      'published','${timestamp}'
    );
    update public.repositories set status='indexed',
      current_revision='${revision}',indexed_revision='${revision}'
    where repository_id='acme/widgets';
  `);
}

test("PostgreSQL repository sessions match memory serialization and navigation",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seed(url);
      const expected = record();
      const saved = JSON.parse(scalar(url, `
        select public.save_repository_engineering_session(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.deepEqual(JSON.parse(scalar(url, `
        select public.get_repository_engineering_session(
          'user-1','user-1','repository-session-1')
      `)), expected);
      const listed = JSON.parse(scalar(url, `
        select public.list_repository_engineering_sessions(
          'user-1','user-1')
      `));
      assert.deepEqual(listed.sessions, [expected]);
      assert.deepEqual(JSON.parse(scalar(url, `
        select public.list_repository_engineering_sessions(
          'user-1','other')
      `)).sessions, []);
      assert.equal(scalar(url, `
        select public.get_repository_engineering_session(
          'user-1','other','repository-session-1')
      `), "");
      assert.equal(scalar(url,
        "select count(*) from public.repository_session_events"), "2");
      assert.equal(scalar(url, `
        select context_size
        from public.repository_session_context_snapshots
      `), "12");

      psql(url, `
        select public.record_repository_session_reuse(
          'user-1','user-1','repository-session-1')
      `);
      const metrics = JSON.parse(scalar(url, `
        select public.repository_session_engine_metrics('user-1')
      `));
      assert.equal(Number(metrics.activeSessions), 1);
      assert.equal(Number(metrics.averageContextSize), 12);
      assert.equal(Number(metrics.sessionReuse), 1);
      const verification = JSON.parse(scalar(url,
        "select public.verify_repository_session_engine_contract()"));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(verification.tables, 5);
      assert.equal(verification.indexes, 12);
      assert.equal(verification.retention, true);
      const apiVerification = JSON.parse(scalar(url,
        "select public.verify_repository_session_api_persistence_contract()"));
      assert.equal(apiVerification.valid, true);
      assert.equal(apiVerification.listing, true);
      assert.equal(scalar(url, `
        select count(*) from pg_class where relname in(
          'repository_engineering_sessions','repository_session_events',
          'repository_session_context_snapshots',
          'repository_session_diagnostics','repository_session_metrics'
        ) and relrowsecurity
      `), "5");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_engineering_sessions','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'service_role','public.repository_engineering_sessions','select')
      `), "t");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'anon',
          'public.list_repository_engineering_sessions(text,text)',
          'execute')
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.list_repository_engineering_sessions(text,text)',
          'execute')
      `), "t");
    });
  });

test("PostgreSQL preserves session workflow attachment metadata equivalently",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seed(url);
      const base = record("workflow-session");
      const expected = {
        ...base,
        session: {
          ...base.session,
          workflowId: "workflow-attachment-1",
          workflowAttachedAt: timestamp,
        },
        context: {
          ...base.context,
          contextVersion: 2,
          activeWorkflow: "workflow-attachment-1",
        },
      };
      const saved = JSON.parse(scalar(url, `
        select public.save_repository_engineering_session(
          ${json(expected)},null)
      `));
      assert.deepEqual(saved, expected);
      assert.equal(scalar(url, `
        select workflow_id from public.repository_engineering_sessions
        where tenant_id='user-1' and session_id='workflow-session'
      `), "workflow-attachment-1");
      const loaded = JSON.parse(scalar(url, `
        select public.get_repository_engineering_session(
          'user-1','user-1','workflow-session')
      `));
      assert.equal(loaded.session.workflowAttachedAt, timestamp);
      assert.equal(loaded.context.activeWorkflow, "workflow-attachment-1");
    });
  });

test("PostgreSQL recovery repairs interruption, partial context, and expiration",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      seed(url);
      const interrupted = record("interrupted-session", "interrupted");
      const expired = {
        ...record("expired-session"),
        session: {
          ...record("expired-session").session,
          expiresAt: "2099-08-30T00:00:00.000Z",
        },
      };
      psql(url, `
        select public.save_repository_engineering_session(
          ${json(interrupted)},null);
        select public.save_repository_engineering_session(
          ${json(expired)},null);
        delete from public.repository_session_context_snapshots
        where session_id='interrupted-session';
      `);
      assert.equal(scalar(url, `
        select public.recover_repository_engineering_sessions(
          '2099-08-31T01:00:00.000Z')
      `), "2");
      const recovered = JSON.parse(scalar(url, `
        select public.get_repository_engineering_session(
          'user-1','user-1','interrupted-session')
      `));
      const archived = JSON.parse(scalar(url, `
        select public.get_repository_engineering_session(
          'user-1','user-1','expired-session')
      `));
      assert.equal(recovered.session.lifecycle, "recovered");
      assert.equal(recovered.recoveryCount, 1);
      assert.equal(archived.session.lifecycle, "archived");
      assert.equal(scalar(url,
        "select count(*) from public.repository_session_diagnostics"), "2");
      assert.equal(scalar(url, `
        select public.collect_repository_engineering_sessions('user-1',0)
      `), "1");
    });
  });
