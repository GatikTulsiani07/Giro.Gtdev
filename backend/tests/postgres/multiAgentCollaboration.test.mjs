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
const revision = "b".repeat(40);
const collaborationId = `collaboration_${"c".repeat(24)}`;
const createdAt = "2099-07-25T00:00:00.000Z";

function artifact(version, payload = {}) {
  return {
    version,
    published: true,
    tenantId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    payload,
  };
}

function participant(runtimeId, agentId, role) {
  return {
    runtimeId,
    agentId,
    capabilityVersion: `${agentId}-capability-v1`,
    assignedWorkUnits: runtimeId === "runtime-worker" ? ["unit-a"] : [],
    lease: {
      leaseId: `collaboration_lease_${runtimeId === "runtime-worker" ? "a" : runtimeId === "runtime-reviewer" ? "b" : "c"}`.padEnd(44, "0"),
      claimToken: "d".repeat(64),
      acquiredAt: createdAt,
      heartbeatAt: createdAt,
      expiresAt: "2099-07-25T01:00:00.000Z",
    },
    heartbeat: null,
    role,
    status: "active",
    registeredAt: createdAt,
    updatedAt: createdAt,
  };
}

function state(overrides = {}) {
  return {
    collaborationId,
    tenantId: "user-1",
    executionId: "execution-1",
    executionVersion: "execution-v1",
    repositoryId: "acme/widgets",
    repositoryRevision: revision,
    planVersion: "plan-v1",
    participants: [
      participant("runtime-coordinator", "planner", "coordinator"),
      participant("runtime-reviewer", "reviewer", "reviewer"),
      participant("runtime-worker", "backend-engineer", "contributor"),
    ],
    coordinatorRuntimeId: "runtime-coordinator",
    lifecycle: "active",
    workUnits: [{
      workUnitId: "unit-a",
      workUnitVersion: "unit-a-v1",
      order: 0,
      prerequisites: [],
      eligibleAgentIds: ["backend-engineer"],
      eligibleRoles: ["contributor"],
      reviewRequired: true,
      maxAttempts: 3,
      status: "assigned",
      ownerRuntimeId: "runtime-worker",
      assignment: {
        assignmentId: `collaboration_assignment_${"a".repeat(24)}`,
        runtimeId: "runtime-worker",
        assignedAt: createdAt,
        attempt: 1,
      },
      outputVersion: 0,
      retryCount: 0,
      blockerCode: null,
      updatedAt: createdAt,
    }],
    context: {
      repositorySnapshot: artifact(revision),
      retrievalBundle: artifact("retrieval-v1"),
      repositoryGraph: artifact("graph-v1"),
      intelligence: artifact("intelligence-v1"),
      planning: artifact("plan-v1"),
      executionMetadata: artifact("execution-v1", {
        executionId: "execution-1",
        executionVersion: "execution-v1",
        planVersion: "plan-v1",
      }),
    },
    messages: [{
      messageId: `collaboration_message_${"d".repeat(24)}`,
      collaborationId,
      messageType: "assignment",
      senderRuntimeId: "runtime-coordinator",
      receiverRuntimeId: "runtime-worker",
      executionVersion: "execution-v1",
      workUnitId: "unit-a",
      workUnitVersion: "unit-a-v1",
      timestamp: createdAt,
      payloadSchemaVersion: "collaboration-message-v1",
      payloadHash: "e".repeat(64),
      payload: {
        assignmentId: `collaboration_assignment_${"a".repeat(24)}`,
        attempt: 1,
      },
      orphaned: false,
    }],
    reviews: [],
    diagnostics: [],
    recoveryState: [],
    conflictCount: 0,
    reassignmentCount: 0,
    recoveryCount: 0,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    ...overrides,
  };
}

test("PostgreSQL collaboration matches CAS persistence, normalized audit, isolation, review, metrics, and retention contracts", { skip }, async () => {
  await withDisposableDatabase(availability, async ({ url }) => {
    await applyMigrations(url);
    psql(url, seedRepositorySql("acme/widgets"));
    const jobId = scalar(url, createJobSql("acme/widgets"));
    psql(url, `insert into public.repository_snapshots(
      repository_id,revision,commit_sha,job_id,status
    ) values('acme/widgets','${revision}','${revision}','${jobId}','building')`);

    const verified = JSON.parse(scalar(url, `
      select row_to_json(contract) from public.verify_collaboration_contract(
        'multi-agent-collaboration-v1'
      ) contract
    `));
    assert.equal(verified.valid, true);

    const initial = state();
    const saved = JSON.parse(scalar(url, `
      select collaboration from public.save_collaboration_state(${json(initial)},null)
    `));
    assert.deepEqual(saved, initial);
    assert.equal(scalar(url, `select count(*) from public.collaboration_participants`), "3");
    assert.equal(scalar(url, `select count(*) from public.collaboration_work_units`), "1");
    assert.equal(scalar(url, `select count(*) from public.collaboration_messages`), "1");

    const loaded = JSON.parse(scalar(url, `
      select collaboration from public.get_collaboration('user-1','${collaborationId}')
    `));
    assert.deepEqual(loaded, initial);
    assert.equal(scalar(url, `
      select count(*) from public.get_collaboration('user-2','${collaborationId}')
    `), "0");

    const review = {
      reviewId: `collaboration_review_${"f".repeat(24)}`,
      collaborationId,
      workUnitId: "unit-a",
      workUnitVersion: "unit-a-v1",
      requesterRuntimeId: "runtime-worker",
      reviewerRuntimeId: "runtime-reviewer",
      reviewedOutputVersion: 1,
      verdict: null,
      findings: [],
      status: "pending",
      requestedAt: "2099-07-25T00:00:01.000Z",
      timestamp: null,
    };
    const reviewing = state({
      reviews: [review],
      workUnits: [{
        ...initial.workUnits[0],
        status: "awaiting_review",
        outputVersion: 1,
        updatedAt: "2099-07-25T00:00:01.000Z",
      }],
      updatedAt: "2099-07-25T00:00:01.000Z",
    });
    scalar(url, `
      select collaboration from public.save_collaboration_state(
        ${json(reviewing)},'${initial.updatedAt}'
      )
    `);
    assert.equal(scalar(url, `
      select count(*) from public.collaboration_reviews where status='pending'
    `), "1");

    const stale = psql(url, `
      select collaboration from public.save_collaboration_state(
        ${json({ ...reviewing, updatedAt: "2099-07-25T00:00:02.000Z" })},
        '${initial.updatedAt}'
      )
    `, { allowFailure: true });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /collaboration_version_conflict/);

    const staleReview = {
      ...reviewing,
      reviews: [{ ...review, reviewedOutputVersion: 2 }],
      updatedAt: "2099-07-25T00:00:02.000Z",
    };
    const staleReviewResult = psql(url, `
      select collaboration from public.save_collaboration_state(
        ${json(staleReview)},'${reviewing.updatedAt}'
      )
    `, { allowFailure: true });
    assert.notEqual(staleReviewResult.status, 0);
    assert.match(staleReviewResult.stderr, /stale_collaboration_review/);

    const aggregate = JSON.parse(scalar(url, `
      select metrics from public.collaboration_metrics('user-1')
    `));
    assert.equal(aggregate.activeCollaborations, 1);
    assert.equal(aggregate.participants, 3);
    assert.equal(aggregate.messages, 1);
    assert.equal(aggregate.reviews, 1);
    assert.equal(scalar(url, `
      select jsonb_array_length(collaborations) from public.list_recoverable_collaborations()
    `), "1");

    scalar(url, `select public.record_collaboration_conflict(
      'user-1','${collaborationId}','collaboration_assignment_conflict','Duplicate owner.'
    )`);
    const conflicted = JSON.parse(scalar(url, `
      select collaboration from public.get_collaboration('user-1','${collaborationId}')
    `));
    assert.equal(conflicted.conflictCount, 1);
    assert.equal(conflicted.diagnostics.length, 1);

    assert.equal(scalar(url, `
      select relrowsecurity from pg_class where oid='public.collaborations'::regclass
    `), "t");
    assert.equal(scalar(url, `
      select has_table_privilege('anon','public.collaborations','select')
    `), "f");
    assert.equal(scalar(url, `
      select deleted_count from public.collect_collaborations('user-1',2)
    `), "0");
  });
});
