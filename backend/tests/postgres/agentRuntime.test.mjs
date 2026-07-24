import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigrations,
  postgresAvailability,
  scalar,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;

const capability = {
  capabilityVersion: "planner-capability-v1",
  capabilityHash: "a".repeat(64),
  deterministic: true,
  allowed: [
    "reasoning", "retrieval", "repository_graph",
    "repository_intelligence", "repository_planning",
  ],
  forbidden: ["shell", "filesystem_mutation", "git", "network", "secrets", "process_execution"],
};

const agent = {
  agentId: "planner",
  name: "Planner",
  version: "planner-v1",
  capability,
  supportedWork: ["planning"],
  supportedRepositories: ["published:*"],
  supportedLanguages: ["all"],
  limits: { runtimeDurationMs: 120_000, retries: 2, outputBytes: 100_000, concurrentWorkUnits: 1 },
};

function context(suffix) {
  return {
    tenantId: "tenant-1",
    executionId: `execution-${suffix}`,
    executionVersion: `execution-${suffix}-v1`,
    workUnitId: `work-${suffix}`,
    workUnitVersion: `work-${suffix}-v1`,
    repositoryId: "acme/widgets",
    repositorySnapshot: { version: "revision-1", published: true, payload: {} },
    retrievalBundle: { version: "retrieval-1", published: true, payload: {} },
    graphExpansion: { version: "graph-1", published: true, payload: {} },
    intelligenceSnapshot: { version: "intelligence-1", published: true, payload: {} },
    executionMetadata: {},
    workUnitMetadata: {},
    policy: {
      planningOnly: true,
      repositoryMutation: false,
      allowed: capability.allowed,
      forbidden: capability.forbidden,
    },
    limits: agent.limits,
  };
}

const output = {
  summary: "A bounded plan.",
  reasoning: ["Published evidence supports the plan."],
  findings: [],
  risks: [],
  assumptions: [],
  proposedFiles: ["src/service.ts"],
  proposedSymbols: ["createWidget"],
  validation: ["typecheck"],
  tests: ["service unit test"],
  confidence: 0.9,
};

const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

test("PostgreSQL agent runtime matches the fenced memory lifecycle and isolation contract", { skip }, async () => {
  await withDisposableDatabase(availability, async ({ url }) => {
    await applyMigrations(url);
    const firstContext = context("one");
    const runtime = JSON.parse(scalar(url, `
      select runtime from public.create_agent_runtime(
        'runtime-one',${json(agent)},${json(firstContext)},10
      )
    `));
    assert.equal(runtime.status, "ready");
    assert.equal(runtime.context.policy.repositoryMutation, false);

    const lease = JSON.parse(scalar(url, `
      select lease from public.lease_agent_runtime('tenant-1','worker-1',60000,4,120000)
    `));
    assert.equal(lease.runtimeId, "runtime-one");
    assert.equal(lease.attempt, 1);

    const running = JSON.parse(scalar(url, `
      select runtime from public.transition_agent_runtime(
        'tenant-1','runtime-one','execution-one-v1','work-one-v1',
        'worker-1','${lease.claimToken}','running'
      )
    `));
    assert.equal(running.status, "running");

    const versioned = JSON.parse(scalar(url, `
      select output from public.publish_agent_runtime_output(
        'tenant-1','runtime-one','execution-one-v1','work-one-v1',
        'worker-1','${lease.claimToken}',${json(output)},100000
      )
    `));
    assert.equal(versioned.outputVersion, 1);
    assert.equal(versioned.executionVersion, "execution-one-v1");
    assert.equal(versioned.capabilityVersion, "planner-capability-v1");
    assert.equal(JSON.parse(scalar(url, `
      select runtime from public.get_agent_runtime('tenant-1','runtime-one')
    `)).status, "completed");
    assert.equal(scalar(url, `
      select count(*) from public.get_agent_runtime('tenant-2','runtime-one')
    `), "0");

    const secondContext = context("two");
    scalar(url, `select runtime from public.create_agent_runtime(
      'runtime-two',${json(agent)},${json(secondContext)},10
    )`);
    const secondLease = JSON.parse(scalar(url, `
      select lease from public.lease_agent_runtime('tenant-1','worker-2',1000,4,120000)
    `));
    scalar(url, `
      update public.agent_runtime_leases set
        leased_at=now()-interval '2 seconds',
        heartbeat_at=now()-interval '2 seconds',
        expires_at=now()-interval '1 second'
      where tenant_id='tenant-1' and runtime_id='runtime-two'
    `);
    assert.equal(scalar(url, `
      select recovered_count from public.recover_agent_runtimes(now(),2,120000)
    `), "1");
    const recovered = JSON.parse(scalar(url, `
      select runtime from public.get_agent_runtime('tenant-1','runtime-two')
    `));
    assert.equal(recovered.status, "ready");
    assert.equal(recovered.recoveryCount, 1);
    assert.equal(recovered.diagnostics[0].code, "lease_expired");
    assert.ok(secondLease.claimToken);

    const capabilities = Array.from({ length: 10 }, (_, index) => ({ agentId: `agent-${index}` }));
    const verification = JSON.parse(scalar(url, `
      select jsonb_build_object('valid',valid,'problems',problems)
      from public.verify_agent_runtime_contract('agent-runtime-v1',${json(capabilities)})
    `));
    assert.equal(verification.valid, true);
    assert.deepEqual(verification.problems, []);
  });
});
