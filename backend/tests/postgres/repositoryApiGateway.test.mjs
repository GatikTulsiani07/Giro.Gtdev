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
const timestamp = "2099-08-30T00:00:00.000Z";
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function cacheRecord() {
  return {
    cacheKey: "gateway-cache-1",
    schemaVersion: "repository-api-gateway-schema-v1",
    ownerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    ownershipFingerprint: "ownership-1",
    service: "repository-query",
    requestFingerprint: "request-1",
    status: "ok",
    payload: { answer: "deterministic" },
    diagnostics: [],
    createdAt: timestamp,
    lastAccessedAt: timestamp,
    hitCount: 0,
  };
}

test("PostgreSQL gateway cache and metrics match the memory contract",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
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
      const record = cacheRecord();
      const saved = JSON.parse(scalar(url, `
        select public.put_repository_api_gateway_cache(${json(record)})
      `));
      assert.deepEqual(saved, record);
      const cached = JSON.parse(scalar(url, `
        select public.get_repository_api_gateway_cache(
          'gateway-cache-1','ownership-1')
      `));
      assert.deepEqual(
        { ...cached, lastAccessedAt: record.lastAccessedAt },
        { ...record, hitCount: 1 },
      );
      assert.notEqual(cached.lastAccessedAt, record.lastAccessedAt);
      assert.equal(scalar(url, `
        select public.get_repository_api_gateway_cache(
          'gateway-cache-1','other')
      `), "");

      psql(url, `
        select public.record_repository_api_gateway_metric(${json({
          ownerId: "user-1", endpoint: "repository-query",
          service: "repository-query", latencyMs: 12,
          cacheHit: false, failed: false,
        })});
        select public.record_repository_api_gateway_metric(${json({
          ownerId: "user-1", endpoint: "repository-query",
          service: "repository-query", latencyMs: 3,
          cacheHit: true, failed: false,
        })});
      `);
      const metrics = JSON.parse(scalar(url, `
        select public.repository_api_gateway_metrics('user-1')
      `));
      assert.deepEqual(metrics, {
        endpointUsage: { "repository-query": 2 },
        serviceDistribution: { "repository-query": 2 },
        totalLatencyMs: 15,
        cacheHits: 1,
        failures: 0,
      });
      const verified = JSON.parse(scalar(url,
        "select public.verify_repository_api_gateway_contract()"));
      assert.equal(verified.valid, true, JSON.stringify(verified));
      assert.equal(verified.routes, 10);
      assert.equal(verified.indexes, 6);
      assert.equal(verified.metricsRegistered, true);
      assert.equal(scalar(url, `
        select count(*) from pg_class where relname in(
          'repository_api_gateway_cache',
          'repository_api_gateway_metric_events'
        ) and relrowsecurity
      `), "2");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_api_gateway_cache','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'service_role','public.repository_api_gateway_cache','select')
      `), "t");

      psql(url, `
        update public.repositories set owner_user_id='other-user'
        where repository_id='acme/widgets'
      `);
      assert.equal(scalar(url, `
        select public.recover_repository_api_gateway_cache()
      `), "1");
    });
  });

test("gateway migration remains idempotent and rejects stale ownership",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      assert.throws(() => psql(url, `
        select public.put_repository_api_gateway_cache(${json(cacheRecord())})
      `), /repository_api_gateway_fence_invalid/);
    });
  });
