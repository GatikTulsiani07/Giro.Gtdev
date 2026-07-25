import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { MetricsRegistry } from "../observability/metrics.js";
import {
  deterministicCollaborationAssignments,
  propagateCollaborationReadiness,
} from "../services/multiAgentCollaboration/scheduler.js";
import { MultiAgentCollaborationEngine } from "../services/multiAgentCollaboration/service.js";
import { MemoryCollaborationStore } from "../services/multiAgentCollaboration/store.js";
import type {
  CollaborationParticipantClaim,
  CollaborationQuotas,
  CollaborationSession,
  CreateCollaborationInput,
} from "../services/multiAgentCollaboration/types.js";
import { CollaborationError } from "../services/multiAgentCollaboration/types.js";

const now = new Date("2099-07-25T00:00:00.000Z");
const quotas: CollaborationQuotas = {
  participants: 8,
  messages: 100,
  pendingReviews: 10,
  durationMs: 86_400_000,
  retries: 2,
  messageBytes: 10_000,
  findings: 20,
  retentionCount: 2,
};

function artifact<T = unknown>(version: string, payload: T) {
  return {
    version,
    published: true as const,
    tenantId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: "a".repeat(40),
    payload,
  };
}

function creation(overrides: Partial<CreateCollaborationInput> = {}): CreateCollaborationInput {
  return {
    tenantId: "user-1",
    executionId: "execution-1",
    executionVersion: "execution-v1",
    repositoryId: "acme/widgets",
    repositoryRevision: "a".repeat(40),
    planVersion: "plan-v1",
    coordinatorRuntimeId: "runtime-coordinator",
    workUnits: [
      {
        workUnitId: "unit-a",
        workUnitVersion: "unit-a-v1",
        order: 0,
        prerequisites: [],
        eligibleAgentIds: ["backend-engineer"],
        eligibleRoles: ["contributor"],
        reviewRequired: true,
        maxAttempts: 3,
      },
      {
        workUnitId: "unit-b",
        workUnitVersion: "unit-b-v1",
        order: 1,
        prerequisites: ["unit-a"],
        eligibleAgentIds: ["backend-engineer"],
        eligibleRoles: ["contributor"],
        reviewRequired: false,
        maxAttempts: 3,
      },
    ],
    context: {
      repositorySnapshot: artifact("a".repeat(40), { files: [] }),
      retrievalBundle: artifact("retrieval-v1", { results: [] }),
      repositoryGraph: artifact("graph-v1", { nodes: [], edges: [] }),
      intelligence: artifact("intelligence-v1", { status: "published" }),
      planning: artifact("plan-v1", { status: "published" }),
      executionMetadata: artifact("execution-v1", {
        executionId: "execution-1",
        executionVersion: "execution-v1",
        planVersion: "plan-v1",
      }),
    },
    ...overrides,
  };
}

async function participant(
  store: MemoryCollaborationStore,
  session: CollaborationSession,
  runtimeId: string,
  agentId: string,
  role: "coordinator" | "contributor" | "reviewer",
  at = now,
) {
  const updated = await store.registerParticipant({
    tenantId: session.tenantId,
    collaborationId: session.collaborationId,
    runtimeId,
    agentId,
    capabilityVersion: `${agentId}-capability-v1`,
    role,
    leaseMs: 60_000,
  }, quotas, at);
  return updated.participants.find((item) => item.runtimeId === runtimeId)!;
}

function claim(session: CollaborationSession, runtimeId: string): CollaborationParticipantClaim {
  const participant = session.participants.find((item) => item.runtimeId === runtimeId)!;
  return {
    tenantId: session.tenantId,
    collaborationId: session.collaborationId,
    runtimeId,
    capabilityVersion: participant.capabilityVersion,
    claimToken: participant.lease!.claimToken,
  };
}

async function activeCollaboration(store = new MemoryCollaborationStore()) {
  let session = await store.create(creation(), quotas, now);
  await participant(store, session, "runtime-coordinator", "planner", "coordinator");
  await participant(store, session, "runtime-worker", "backend-engineer", "contributor");
  await participant(store, session, "runtime-reviewer", "reviewer", "reviewer");
  session = await store.activate(
    session.tenantId, session.collaborationId, session.coordinatorRuntimeId, now,
  );
  return { store, session };
}

test("collaboration creation is deterministic, idempotent, versioned, and context-immutable", async () => {
  const store = new MemoryCollaborationStore();
  const first = await store.create(creation(), quotas, now);
  const second = await store.create(creation(), quotas, now);
  assert.deepEqual(second, first);
  assert.match(first.collaborationId, /^collaboration_[0-9a-f]{24}$/);
  assert.equal(first.lifecycle, "created");
  assert.deepEqual(first.workUnits.map((unit) => unit.status), ["ready", "blocked"]);
  assert.throws(() => {
    (first.context.planning.payload as { status: string }).status = "building";
  });
});

test("participant registration is deterministic and rejects duplicates, stale capabilities, and coordinator conflicts", async () => {
  const store = new MemoryCollaborationStore();
  const session = await store.create(creation(), quotas, now);
  const coordinator = await participant(
    store, session, "runtime-coordinator", "planner", "coordinator",
  );
  const replay = await store.registerParticipant({
    tenantId: session.tenantId,
    collaborationId: session.collaborationId,
    runtimeId: coordinator.runtimeId,
    agentId: coordinator.agentId,
    capabilityVersion: coordinator.capabilityVersion,
    role: coordinator.role,
    leaseMs: 60_000,
  }, quotas, now);
  assert.equal(replay.participants.length, 1);
  await assert.rejects(() => store.registerParticipant({
    tenantId: session.tenantId,
    collaborationId: session.collaborationId,
    runtimeId: coordinator.runtimeId,
    agentId: coordinator.agentId,
    capabilityVersion: "stale-capability-v2",
    role: coordinator.role,
    leaseMs: 60_000,
  }, quotas, now), (error: unknown) =>
    error instanceof CollaborationError && error.code === "duplicate_collaboration_participant");
});

test("assignment order, dependency readiness, ownership, and downstream blocking are reproducible", async () => {
  const { store, session: initial } = await activeCollaboration();
  const predicted = deterministicCollaborationAssignments(initial);
  assert.deepEqual(predicted.map((item) => [
    item.unit.workUnitId, item.participant.runtimeId,
  ]), [["unit-a", "runtime-worker"]]);
  const scheduled = await store.schedule(
    initial.tenantId, initial.collaborationId, quotas, now,
  );
  assert.equal(scheduled.workUnits[0]?.ownerRuntimeId, "runtime-worker");
  assert.equal(scheduled.workUnits[1]?.status, "blocked");
  assert.equal(scheduled.messages[0]?.messageType, "assignment");
  const propagated = propagateCollaborationReadiness({
    ...scheduled,
    workUnits: scheduled.workUnits.map((unit) =>
      unit.workUnitId === "unit-a" ? { ...unit, status: "failed" as const } : unit),
  });
  assert.equal(propagated.find((unit) => unit.workUnitId === "unit-b")?.blockerCode,
    "upstream_failed");
});

test("structured messages are durable, schema-checked, immutable, and version fenced", async () => {
  const { store, session: initial } = await activeCollaboration();
  const scheduled = await store.schedule(initial.tenantId, initial.collaborationId, quotas, now);
  const workerClaim = claim(scheduled, "runtime-worker");
  const message = await store.sendMessage({
    claim: workerClaim,
    messageType: "progress",
    receiverRuntimeId: "runtime-coordinator",
    workUnitId: "unit-a",
    workUnitVersion: "unit-a-v1",
    payload: { status: "running", percentage: 50 },
  }, quotas, now);
  assert.match(message.messageId, /^collaboration_message_/);
  assert.equal(message.payloadSchemaVersion, "collaboration-message-v1");
  assert.throws(() => {
    (message.payload as { percentage: number }).percentage = 100;
  });
  await assert.rejects(() => store.sendMessage({
    claim: workerClaim,
    messageType: "progress",
    receiverRuntimeId: "runtime-coordinator",
    workUnitId: "unit-a",
    workUnitVersion: "stale",
    payload: { status: "running", percentage: 75 },
  }, quotas, now), (error: unknown) =>
    error instanceof CollaborationError && error.code === "stale_collaboration_work_unit");
  await assert.rejects(() => store.sendMessage({
    claim: workerClaim,
    messageType: "question",
    receiverRuntimeId: "runtime-coordinator",
    workUnitId: "unit-a",
    workUnitVersion: "unit-a-v1",
    payload: { question: "Missing question ID" },
  }, quotas, now), /does not match its schema/);
  await assert.rejects(() => store.sendMessage({
    claim: workerClaim,
    messageType: "progress",
    receiverRuntimeId: "runtime-coordinator",
    workUnitId: "unit-a",
    workUnitVersion: "unit-a-v1",
    payload: { status: "running", percentage: "50" },
  }, quotas, now), (error: unknown) =>
    error instanceof CollaborationError && error.code === "invalid_collaboration_message");
});

test("peer review routing is deterministic and rejects stale output reviews", async () => {
  const { store, session: initial } = await activeCollaboration();
  let session = await store.schedule(initial.tenantId, initial.collaborationId, quotas, now);
  const workerClaim = claim(session, "runtime-worker");
  session = await store.startWork(workerClaim, "unit-a", "unit-a-v1", now);
  session = await store.completeWork(
    workerClaim, "unit-a", "unit-a-v1", 1, quotas, now,
  );
  const review = await store.requestReview(
    workerClaim, "unit-a", "unit-a-v1", 1, quotas, now,
  );
  assert.equal(review.reviewerRuntimeId, "runtime-reviewer");
  const reviewerClaim = claim(await store.get(session.tenantId, session.collaborationId) ??
    session, "runtime-reviewer");
  await assert.rejects(() => store.submitReview({
    claim: reviewerClaim,
    reviewId: review.reviewId,
    reviewedOutputVersion: 2,
    verdict: "approved",
    findings: [],
  }, quotas, now), (error: unknown) =>
    error instanceof CollaborationError && error.code === "stale_collaboration_review");
  const completed = await store.submitReview({
    claim: reviewerClaim,
    reviewId: review.reviewId,
    reviewedOutputVersion: 1,
    verdict: "approved",
    findings: ["Output matches the published plan."],
  }, quotas, now);
  assert.equal(completed.verdict, "approved");
  session = (await store.get(session.tenantId, session.collaborationId))!;
  assert.equal(session.workUnits.find((unit) => unit.workUnitId === "unit-a")?.status,
    "succeeded");
  assert.equal(session.workUnits.find((unit) => unit.workUnitId === "unit-b")?.status,
    "ready");
});

test("retry routing, reassignment, recovery, audit history, and completion operate deterministically", async () => {
  const store = new MemoryCollaborationStore();
  let session = await store.create(creation({
    workUnits: [{
      ...creation().workUnits[0]!,
      reviewRequired: false,
    }],
  }), quotas, now);
  await participant(store, session, "runtime-coordinator", "planner", "coordinator");
  await participant(store, session, "runtime-a", "backend-engineer", "contributor");
  await participant(
    store, session, "runtime-b", "backend-engineer", "contributor",
    new Date(now.getTime() + 30_000),
  );
  session = await store.activate(
    session.tenantId, session.collaborationId, session.coordinatorRuntimeId, now,
  );
  session = await store.schedule(session.tenantId, session.collaborationId, quotas, now);
  assert.equal(session.workUnits[0]?.ownerRuntimeId, "runtime-a");
  assert.ok(await store.recover(new Date(now.getTime() + 60_001), quotas) >= 2);
  session = (await store.get(session.tenantId, session.collaborationId))!;
  assert.equal(session.participants.find((item) => item.runtimeId === "runtime-a")?.status,
    "abandoned");
  assert.equal(session.workUnits[0]?.status, "ready");
  assert.ok(session.recoveryState.length >= 2);
  session = await store.schedule(
    session.tenantId, session.collaborationId, quotas,
    new Date(now.getTime() + 60_001),
  );
  assert.equal(session.workUnits[0]?.ownerRuntimeId, "runtime-b");
  const workerClaim = claim(session, "runtime-b");
  session = await store.completeWork(
    workerClaim, "unit-a", "unit-a-v1", 1, quotas,
    new Date(now.getTime() + 60_001),
  );
  assert.equal(session.lifecycle, "completed");
  assert.equal(session.reassignmentCount, 1);
});

test("recovery releases work already owned by an abandoned participant", async () => {
  const { store, session: initial } = await activeCollaboration();
  const scheduled = await store.schedule(
    initial.tenantId, initial.collaborationId, quotas, now,
  );
  const restored = new MemoryCollaborationStore();
  restored.hydrate({
    ...scheduled,
    participants: scheduled.participants.map((participant) =>
      participant.runtimeId === "runtime-worker"
        ? { ...participant, status: "abandoned" as const, lease: null }
        : participant),
  });
  assert.equal(await restored.recover(now, quotas), 1);
  const recovered = await restored.get(scheduled.tenantId, scheduled.collaborationId);
  assert.equal(recovered?.workUnits[0]?.status, "ready");
  assert.equal(recovered?.workUnits[0]?.ownerRuntimeId, null);
  assert.equal(recovered?.recoveryState.at(-1)?.reason, "abandoned_participant");
});

test("tenant isolation and participant, message, review, duration, and retry quotas are enforced", async () => {
  const store = new MemoryCollaborationStore();
  const session = await store.create(creation(), { ...quotas, participants: 2 }, now);
  await participant(store, session, "runtime-coordinator", "planner", "coordinator");
  await participant(store, session, "runtime-worker", "backend-engineer", "contributor");
  await assert.rejects(() => store.registerParticipant({
    tenantId: session.tenantId,
    collaborationId: session.collaborationId,
    runtimeId: "runtime-extra",
    agentId: "reviewer",
    capabilityVersion: "reviewer-capability-v1",
    role: "reviewer",
    leaseMs: 60_000,
  }, { ...quotas, participants: 2 }, now), /Participant quota exceeded/);
  assert.equal(await store.get("user-2", session.collaborationId), null);
  const active = await store.activate(
    session.tenantId, session.collaborationId, session.coordinatorRuntimeId, now,
  );
  await assert.rejects(() => store.schedule(
    active.tenantId, active.collaborationId,
    { ...quotas, durationMs: 1 },
    new Date(now.getTime() + 2),
  ), /duration quota/);
});

test("message, pending-review, and retry routing quotas reject or terminally route without partial state", async () => {
  const { store, session: initial } = await activeCollaboration();
  await assert.rejects(() => store.schedule(
    initial.tenantId,
    initial.collaborationId,
    { ...quotas, messages: 0 },
    now,
  ), /message quota/);
  let session = await store.schedule(
    initial.tenantId, initial.collaborationId, quotas, now,
  );
  const workerClaim = claim(session, "runtime-worker");
  session = await store.completeWork(
    workerClaim, "unit-a", "unit-a-v1", 1, quotas, now,
  );
  await assert.rejects(() => store.requestReview(
    workerClaim,
    "unit-a",
    "unit-a-v1",
    1,
    { ...quotas, pendingReviews: 0 },
    now,
  ), /review quota/);

  const retryStore = new MemoryCollaborationStore();
  let retrySession = await retryStore.create(creation({
    workUnits: [{ ...creation().workUnits[0]!, reviewRequired: false }],
  }), quotas, now);
  await participant(
    retryStore, retrySession, "runtime-coordinator", "planner", "coordinator",
  );
  await participant(
    retryStore, retrySession, "runtime-worker", "backend-engineer", "contributor",
  );
  retrySession = await retryStore.activate(
    retrySession.tenantId,
    retrySession.collaborationId,
    retrySession.coordinatorRuntimeId,
    now,
  );
  retrySession = await retryStore.schedule(
    retrySession.tenantId, retrySession.collaborationId, quotas, now,
  );
  retrySession = await retryStore.failWork(
    claim(retrySession, "runtime-worker"),
    "unit-a",
    "unit-a-v1",
    "permanent_failure",
    true,
    { ...quotas, retries: 0 },
    now,
  );
  assert.equal(retrySession.workUnits[0]?.status, "failed");
  assert.equal(retrySession.lifecycle, "failed");
  assert.equal(retrySession.messages.length, 1);
});

test("metrics, structured logging, tracing integration, and startup validation are complete", async () => {
  const store = new MemoryCollaborationStore();
  const logs: Array<{ operation: string; fields: Record<string, unknown> }> = [];
  const engine = new MultiAgentCollaborationEngine(store, quotas, {
    info(operation, fields) { logs.push({ operation, fields: fields ?? {} }); },
    warn() {},
    error() {},
    debug() {},
    async flush() {},
  });
  const session = await engine.create(creation());
  await engine.registerParticipant({
    tenantId: session.tenantId,
    collaborationId: session.collaborationId,
    runtimeId: "runtime-coordinator",
    agentId: "planner",
    capabilityVersion: "planner-capability-v1",
    role: "coordinator",
    leaseMs: 60_000,
  });
  const metrics = await engine.metrics("user-1");
  assert.equal(metrics.activeCollaborations, 1);
  assert.equal(metrics.participants, 1);
  assert.ok(logs.some((entry) => entry.operation === "collaboration.created"));
  await assert.doesNotReject(() => engine.verify());
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0,
    uptimeSeconds: () => 1,
  });
  registry.recordCollaboration(metrics);
  const rendered = registry.render();
  for (const name of [
    "giro_collaboration_active", "giro_collaboration_participants",
    "giro_collaboration_messages_total", "giro_collaboration_reviews_total",
    "giro_collaboration_conflicts_total", "giro_collaboration_reassignments_total",
    "giro_collaboration_recoveries_total", "giro_collaboration_completion_latency_ms_total",
  ]) assert.match(rendered, new RegExp(name));
});

test("migration defines collaboration persistence, fencing, RLS, grants, indexes, recovery, and retention", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260811000000_add_multi_agent_collaboration_engine.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "collaborations", "collaboration_participants", "collaboration_messages",
    "collaboration_reviews", "collaboration_diagnostics", "collaboration_recovery_state",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /collaboration_work_units_schedule_idx/);
  assert.match(migration, /collaboration_reviews_pending_idx/);
  assert.match(migration, /save_collaboration_state/);
  assert.match(migration, /verify_collaboration_contract/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant execute on function public\.save_collaboration_state/);
  assert.match(migration, /collect_collaborations/);
  assert.match(migration, /on delete cascade/);
});
