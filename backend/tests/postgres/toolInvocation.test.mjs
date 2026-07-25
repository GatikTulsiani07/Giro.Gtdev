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
const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const revision = "a".repeat(40);
const forbidden = [
  "shell_execution", "git", "repository_mutation", "process_spawning", "secrets",
  "arbitrary_filesystem_writes", "unrestricted_networking", "arbitrary_code",
];
const tool = {
  toolId: "internal.metrics",
  version: "metrics-tool-v1",
  capabilityHash: "b".repeat(64),
  category: "Metrics",
  description: "Reads bounded published metrics.",
  inputSchema: { type: "object", additionalProperties: false },
  outputSchema: { type: "object", additionalProperties: true },
  requiredPermissions: ["metrics"],
  forbiddenCapabilities: forbidden,
  timeoutMs: 5000,
  resourceLimits: {
    inputBytes: 65536, outputBytes: 1048576, diagnosticsBytes: 65536,
    resultItems: 500, traversalDepth: 8,
  },
  lifecycle: "ready",
};

function identity(suffix, overrides = {}) {
  return {
    invocationId: `tool_invocation_${suffix.repeat(24).slice(0, 24)}`,
    tenantId: "user-1",
    executionId: `execution-${suffix}`,
    executionVersion: `execution-${suffix}-v1`,
    workUnitId: `work-${suffix}`,
    workUnitVersion: `work-${suffix}-v1`,
    runtimeId: "runtime-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    toolId: tool.toolId,
    toolVersion: tool.version,
    inputHash: suffix.repeat(64).slice(0, 64),
    timeoutMs: 5000,
    timestamp: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

const metrics = {
  usage: 1, latencyMs: 4, timeouts: 0, failures: 0, retryCount: 0,
  payloadBytes: 12, cacheHits: 0, cacheMisses: 1, diagnosticGeneration: 0,
};
const output = {
  version: tool.version,
  payload: { sources: [] },
  diagnostics: [],
  metrics,
  durationMs: 4,
  warnings: [],
};

test("PostgreSQL tool invocation matches durable replay, fencing, isolation, recovery, and metrics contracts", { skip }, async () => {
  await withDisposableDatabase(availability, async ({ url }) => {
    await applyMigrations(url);
    assert.equal(JSON.parse(scalar(url, `
      select row_to_json(contract) from public.verify_tool_invocation_contract(
        'tool-invocation-v1',${json([tool])}
      ) contract
    `)).valid, false, "the production registry requires all ten built-ins");

    const allTools = Array.from({ length: 10 }, (_value, index) => ({
      ...tool,
      toolId: index === 0 ? tool.toolId : `internal.test-${index}`,
      version: index === 0 ? tool.version : `test-${index}-v1`,
      capabilityHash: index === 0 ? tool.capabilityHash : String(index).repeat(64),
    }));
    const verified = JSON.parse(scalar(url, `
      select row_to_json(contract) from public.verify_tool_invocation_contract(
        'tool-invocation-v1',${json(allTools)}
      ) contract
    `));
    assert.equal(verified.valid, true);

    psql(url, seedRepositorySql("acme/widgets"));
    const jobId = scalar(url, createJobSql("acme/widgets"));
    psql(url, `insert into public.repository_snapshots(
      repository_id,revision,commit_sha,job_id,status
    ) values('acme/widgets','${revision}','${revision}','${jobId}','building')`);

    const first = JSON.parse(scalar(url, `
      select row_to_json(started) from public.begin_tool_invocation(
        ${json(identity("c"))},10,2
      ) started
    `));
    assert.equal(first.state, "acquired");
    assert.equal(first.invocation.status, "running");

    const completed = JSON.parse(scalar(url, `
      select result from public.complete_tool_invocation(
        'user-1','${identity("c").invocationId}',${json(output)},'${"d".repeat(64)}',4
      )
    `));
    assert.equal(completed.invocation.status, "succeeded");
    assert.equal(completed.invocation.outputHash, "d".repeat(64));
    assert.deepEqual(completed.output, output);

    const replay = JSON.parse(scalar(url, `
      select row_to_json(started) from public.begin_tool_invocation(
        ${json(identity("c"))},10,2
      ) started
    `));
    assert.equal(replay.state, "replay");
    assert.equal(replay.result.replayed, true);
    assert.deepEqual(replay.result.output, output);
    assert.equal(scalar(url, `
      select count(*) from public.get_tool_invocation(
        'user-2','${identity("c").invocationId}'
      )
    `), "0");

    const conflict = psql(url, `
      select * from public.begin_tool_invocation(
        ${json(identity("c", { inputHash: "e".repeat(64) }))},10,2
      )
    `, { allowFailure: true });
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /tool_invocation_conflict/);

    scalar(url, `select state from public.begin_tool_invocation(${json(identity("f"))},10,2)`);
    psql(url, `update public.tool_invocations set lease_expires_at=now()-interval '1 second'
      where tenant_id='user-1' and invocation_id='${identity("f").invocationId}'`);
    assert.equal(scalar(url, `select recovered_count from public.recover_tool_invocations(now())`), "1");
    const recovered = JSON.parse(scalar(url, `
      select result from public.get_tool_invocation('user-1','${identity("f").invocationId}')
    `));
    assert.equal(recovered.invocation.status, "failed");
    assert.equal(recovered.invocation.failure.code, "unfinished_tool_invocation");
    assert.equal(recovered.output, null);

    const aggregate = JSON.parse(scalar(url, `
      select metrics from public.tool_invocation_metrics('user-1')
    `));
    assert.equal(aggregate.usage, 2);
    assert.equal(aggregate.failures, 1);
    assert.equal(aggregate.retryCount, 1);
    assert.equal(scalar(url, `
      select relrowsecurity from pg_class where oid='public.tool_invocations'::regclass
    `), "t");
    assert.equal(scalar(url, `
      select has_table_privilege('anon','public.tool_invocations','select')
    `), "f");
  });
});
