import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations, postgresAvailability, psql, scalar, seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const timestamp = "2099-08-24T00:00:00.000Z";
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function execution(lifecycle = "completed") {
  const query = {
    queryId: "query_deterministic", schemaVersion: "repository-query-schema-v1",
    persistenceVersion: 1, tenantId: "tenant-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    workflowId: null, sessionId: "session-1", userId: "user-1",
    originalQuery: "Where is JWT validated?",
    normalizedQuery: "where is jwt validated?",
    intents: ["semantic", "symbol", "navigation"], confidence: 0.82,
    lifecycle, createdAt: timestamp, updatedAt: timestamp,
    completedAt: lifecycle === "completed" ? timestamp : null,
  };
  const plan = {
    planId: "query_plan_deterministic", queryId: query.queryId,
    steps: [
      { position: 0, engine: "Repository Intelligence", required: true,
        reason: "navigation" },
      { position: 1, engine: "Semantic Code Intelligence", required: true,
        reason: "semantic, symbol, navigation" },
      { position: 2, engine: "Feature Intelligence", required: true,
        reason: "navigation" },
    ],
    selectors: [{ kind: "repository", value: "*" }],
  };
  return {
    query, plan,
    response: lifecycle === "completed" ? {
      queryId: query.queryId, repositoryId: query.repositoryId,
      repositoryRevision: revision, intents: query.intents,
      relevantFiles: ["src/auth/jwt.ts"], confidence: 0.82,
    } : null,
    diagnostics: [], cacheHit: false,
    engineUsage: lifecycle === "completed"
      ? plan.steps.map((step) => step.engine) : [],
    latencyMs: lifecycle === "completed" ? 12 : 0,
  };
}

test("PostgreSQL repository query engine preserves ownership, revision fencing, cache, recovery, metrics, RLS, grants, and retention",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets"));
      psql(url, `update public.repositories set
        status='indexed',current_revision='${revision}',indexed_revision='${revision}'
        where repository_id='acme/widgets'`);

      const saved = JSON.parse(scalar(url, `
        select execution from public.save_repository_query(
          ${json(execution())},null)
      `));
      assert.equal(saved.query.queryId, "query_deterministic");
      assert.equal(saved.query.persistenceVersion, 1);
      assert.equal(saved.response.relevantFiles[0], "src/auth/jwt.ts");
      assert.equal(JSON.parse(scalar(url, `
        select execution from public.get_repository_query(
          'tenant-1','user-1','query_deterministic')
      `)).query.userId, "user-1");
      assert.equal(scalar(url, `
        select count(*) from public.get_repository_query(
          'tenant-1','other','query_deterministic')
      `), "0");
      psql(url, `select public.record_repository_query_cache_hit(
        'tenant-1','user-1','query_deterministic')`);
      const metrics = JSON.parse(scalar(url, `
        select metrics from public.repository_query_metrics('tenant-1')
      `));
      assert.equal(metrics.queries, 1);
      assert.equal(metrics.cacheHits, 1);
      assert.equal(Number(metrics.averageLatencyMs), 12);
      assert.equal(metrics.engineUsage["Semantic Code Intelligence"], 1);
      assert.equal(metrics.intentDistribution.navigation, 1);
      assert.equal(metrics.confidenceDistribution.high, 1);

      const verification = JSON.parse(scalar(url, `
        select row_to_json(contract) from (
          select * from public.verify_repository_query_contract(
            'repository-query-engine-v1','repository-query-schema-v1')
        ) contract
      `));
      assert.equal(verification.valid, true, JSON.stringify(verification));
      assert.equal(scalar(url, `select count(*) from pg_class where relname in(
        'repository_queries','repository_query_plans',
        'repository_query_cached_responses','repository_query_diagnostics',
        'repository_query_metrics','repository_query_retention'
      ) and relrowsecurity`), "6");
      assert.equal(scalar(url, `
        select has_table_privilege(
          'anon','public.repository_queries','select')
      `), "f");
      assert.equal(scalar(url, `
        select has_function_privilege(
          'service_role','public.save_repository_query(jsonb,text)','execute')
      `), "t");

      const running = execution("running");
      running.query.queryId = "query_interrupted";
      running.plan.queryId = "query_interrupted";
      running.plan.planId = "query_plan_interrupted";
      scalar(url, `select execution from public.save_repository_query(
        ${json(running)},null)`);
      assert.equal(scalar(url, `
        select recovered_count from public.recover_repository_queries()
      `), "1");
      const recovered = JSON.parse(scalar(url, `
        select execution from public.get_repository_query(
          'tenant-1','user-1','query_interrupted')
      `));
      assert.equal(recovered.query.lifecycle, "failed");
      assert.equal(JSON.parse(scalar(url, `
        select metrics from public.repository_query_metrics('tenant-1')
      `)).recoveryCount, 1);

      psql(url, `update public.repositories set
        current_revision='${"b".repeat(40)}',
        indexed_revision='${"b".repeat(40)}'
        where repository_id='acme/widgets'`);
      assert.notEqual(psql(url, `
        select execution from public.save_repository_query(
          ${json({ ...execution(), query: {
            ...execution().query, queryId: "query_stale",
          }, plan: {
            ...execution().plan, queryId: "query_stale",
            planId: "query_plan_stale",
          } })},null)
      `, { allowFailure: true }).status, 0);
      assert.equal(scalar(url, `
        select deleted_count from public.collect_repository_queries(
          'tenant-1',1)
      `), "1");
      assert.equal(scalar(url, `
        select retained_queries from public.repository_query_retention
        where tenant_id='tenant-1'
      `), "1");
    });
  });
