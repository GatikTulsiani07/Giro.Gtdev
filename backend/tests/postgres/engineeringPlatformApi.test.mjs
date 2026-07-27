import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations,
  postgresAvailability,
  psql,
  scalar,
  seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const sqlJson = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

test("PostgreSQL engineering API contract preserves idempotency, workflow ordering, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));

      const record = {
        recordId: `engineering_api_idempotency_${"1".repeat(24)}`,
        ownerId: "user-1",
        route: "POST /api/v1/workflows",
        target: "acme/widgets",
        idempotencyKey: "request-1",
        payloadHash: "a".repeat(64),
        status: 201,
        response: { workflowId: "workflow-1", version: 1 },
        createdAt: "2099-08-19T00:00:00.000Z",
        expiresAt: "2099-08-20T00:00:00.000Z",
      };
      const written = JSON.parse(scalar(url, `
        select record from public.put_engineering_api_idempotency(
          ${sqlJson(record)}
        )
      `));
      assert.deepEqual(written.response, record.response);
      const read = JSON.parse(scalar(url, `
        select record from public.get_engineering_api_idempotency(
          'user-1','POST /api/v1/workflows','acme/widgets','request-1'
        )
      `));
      assert.equal(read.recordId, record.recordId);
      assert.deepEqual(read.response, record.response);
      const duplicate = JSON.parse(scalar(url, `
        select record from public.put_engineering_api_idempotency(
          ${sqlJson(record)}
        )
      `));
      assert.equal(duplicate.recordId, record.recordId);

      const conflict = psql(url, `
        select record from public.put_engineering_api_idempotency(
          ${sqlJson({ ...record, payloadHash: "b".repeat(64) })}
        )
      `, { allowFailure: true });
      assert.notEqual(conflict.status, 0);
      assert.match(conflict.stderr, /engineering_api_idempotency_conflict/);

      const state = {
        workflowId: "workflow-1",
        repositoryId: "acme/widgets",
        ownerId: "user-1",
        updatedAt: "2099-08-19T00:00:00.000Z",
      };
      psql(url, `
        insert into public.autonomous_workflows(
          tenant_id,workflow_id,schema_version,repository_id,
          repository_revision,execution_id,owner_id,workflow_version,
          lifecycle,current_stage,state,created_at,updated_at
        ) values(
          'user-1','workflow-1','autonomous-workflow-schema-v1',
          'acme/widgets','${"c".repeat(40)}','execution-1','user-1',1,
          'created','intelligence',${sqlJson(state)},
          '2099-08-19T00:00:00.000Z','2099-08-19T00:00:00.000Z'
        )
      `);
      const workflows = JSON.parse(scalar(url, `
        select workflows from public.list_autonomous_workflows(
          'user-1','user-1'
        )
      `));
      assert.deepEqual(workflows, [state]);
      assert.equal(scalar(url, `
        select valid from public.verify_engineering_platform_api_contract()
      `), "t");
      assert.equal(scalar(url, `
        select relrowsecurity from pg_class
        where oid='public.engineering_api_idempotency'::regclass
      `), "t");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.engineering_api_idempotency','select'
        )
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role',
          'public.put_engineering_api_idempotency(jsonb)','execute'
        )
      `), "t");
      assert.equal(scalar(url, `
        select removed from public.collect_engineering_api_idempotency(100)
      `), "0");
    });
  });
