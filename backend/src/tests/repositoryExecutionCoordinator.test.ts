import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deterministicExecutionLineage,
} from "../services/repositoryExecutionCoordinator/determinism.js";
import {
  RepositoryExecutionCoordinator,
} from "../services/repositoryExecutionCoordinator/service.js";
import {
  MemoryRepositoryExecutionCoordinatorStore,
  PostgresRepositoryExecutionCoordinatorStore,
} from "../services/repositoryExecutionCoordinator/store.js";
import {
  EXECUTION_COORDINATOR_STAGES,
  REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION,
  RepositoryExecutionCoordinatorError,
  type CoordinateRepositoryExecutionInput,
  type RepositoryCoordinatedExecution,
} from "../services/repositoryExecutionCoordinator/types.js";
import {
  validateExecutionCoordinatorRegistration,
  validateRepositoryCoordinatedExecution,
} from "../services/repositoryExecutionCoordinator/validation.js";
import type {
  RepositoryEngineeringSpecification,
} from "../services/repositorySpecification/types.js";
import type {
  RepositoryTaskPlan,
} from "../services/repositoryTaskPlanner/types.js";

const revision = "a".repeat(40);
const timestamp = "2026-08-29T00:00:00.000Z";
const input: CoordinateRepositoryExecutionInput = {
  tenantId: "tenant-1", ownerId: "user-1",
  repositoryOwnerId: "user-1", repositoryId: "acme/widgets",
  repositoryRevision: revision, workflowId: "workflow-1",
  objective: "Fix payment authentication", requestedAt: timestamp,
};
const lineage = deterministicExecutionLineage(input);

function taskPlan(): RepositoryTaskPlan {
  return {
    task: {
      taskId: lineage.taskId,
      schemaVersion: "repository-task-plan-schema-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      userRequest: input.objective,
      normalizedObjective: "fix payment authentication",
      category: "bug fix", confidence: 0.86, lifecycle: "published",
      createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
    },
    sourceVersions: {
      repositoryIntelligence: "intelligence-v1",
      repositoryGraph: "graph-v1", semanticGraph: "semantic-v1",
      featureGraph: "feature-v1",
    },
    orchestrationPlan: [],
    impact: {
      affectedFeatures: ["payments"], affectedModules: ["payment-api"],
      affectedFiles: ["src/payment.ts"], affectedSymbols: ["authenticate"],
      dependencies: ["route->authenticate"], downstreamImpact: ["route"],
    },
    phases: [],
    risk: {
      implementationComplexity: 20, architecturalRisk: 30,
      dependencyRisk: 25, regressionRisk: 40, overallRisk: 30,
      level: "low", inputs: { affectedFiles: 1 },
    },
    validationChecklist: {
      requiredTests: ["Run payment tests."],
      verificationSteps: ["Verify authentication."],
      affectedWorkflows: ["workflow-1"],
      reviewChecklist: ["Review compatibility."],
    },
    changeRoadmap: null, changeRisk: null, diagnostics: [],
    engineUsage: [
      "Repository Intelligence", "Semantic Intelligence",
      "Feature Intelligence", "Change Intelligence", "Query Engine",
      "Repository Insights", "Evolution Intelligence", "Knowledge Engine",
      "Workflow Engine",
    ],
    cacheHit: false, orchestrationLatencyMs: 0,
    accuracyInputCount: 9, recoveryCount: 0,
  };
}

function specification(): RepositoryEngineeringSpecification {
  const phases = [
    "preparation", "implementation", "verification", "testing", "review",
    "rollout", "post-deployment validation",
  ].map((kind, position) => ({
    phaseId: `phase-${position}`, position, kind: kind as any,
    title: kind, objective: `Complete ${kind}.`,
    actions: [`Validate ${kind}.`], evidenceReferences: ["intelligence-v1"],
    dependsOn: position === 0 ? [] : [`phase-${position - 1}`],
  }));
  const risk = (summary: string) => ({
    score: 30, level: "low" as const, summary, evidence: ["payments"],
  });
  return {
    specification: {
      specificationId: lineage.specificationId,
      schemaVersion: "repository-engineering-specification-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      taskId: lineage.taskId, workflowId: "workflow-1", type: "bug-fix",
      title: "Bug Fix Specification", objective: input.objective,
      scope: ["payments"], assumptions: ["Published evidence is current."],
      constraints: ["No source code."], confidence: 0.86,
      ownershipFingerprint: "ownership-v1", lifecycle: "published",
      createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
    },
    context: {
      sourceVersions: taskPlan().sourceVersions,
      repository: [], semantic: [], featureOwnership: [],
      architecture: [], workflows: ["workflow-1"], knowledge: [],
      evolution: [], insights: [],
    },
    impact: {
      affectedFeatures: ["payments"], affectedModules: ["payment-api"],
      affectedFiles: ["src/payment.ts"], affectedSymbols: ["authenticate"],
      dependencyChain: ["route->authenticate"], downstreamImpact: ["route"],
    },
    implementationPhases: phases,
    risks: {
      architectural: risk("Architectural risk."),
      dependency: risk("Dependency risk."),
      regression: risk("Regression risk."),
      rollout: risk("Rollout risk."),
    },
    acceptanceCriteria: {
      functionalRequirements: ["Authentication works."],
      nonFunctionalRequirements: ["Contracts remain stable."],
      validationChecklist: ["Verify authentication."],
      successCriteria: ["All tests pass."],
    },
    testStrategy: {
      unitTestingPlan: ["Run unit tests."],
      integrationTestingPlan: ["Run integration tests."],
      regressionTestingPlan: ["Run regression tests."],
      validationSteps: ["Validate results."],
    },
    diagnostics: [], cacheHit: false, orchestrationLatencyMs: 0,
    recoveryCount: 0,
  };
}

function dependencies() {
  const repository = {
    repositoryId: "acme/widgets", ownerUserId: "user-1",
    currentRevision: revision, indexedRevision: revision,
    deletionState: "active",
  };
  const calls = new Map<string, number>();
  const called = (name: string) =>
    calls.set(name, (calls.get(name) ?? 0) + 1);
  const verify = async () => {};
  return {
    repository,
    calls,
    result: {
      repositories: { getRepository: async () => repository },
      query: {
        query: async () => {
          called("query");
          return {
            query: {
              queryId: "query-1", lifecycle: "completed",
            }, diagnostics: [],
          };
        }, verify,
      },
      taskPlanner: {
        plan: async () => { called("task"); return taskPlan(); }, verify,
      },
      specifications: {
        generate: async () => {
          called("specification");
          return specification();
        }, verify,
      },
      workflows: {
        get: async () => {
          called("workflow");
          return {
            workflowId: "workflow-1", workflowVersion: 1,
            lifecycle: "planning", ownerId: "user-1",
            repositoryId: "acme/widgets", repositoryRevision: revision,
          };
        }, verify,
      },
    },
  };
}

test("execution lineage IDs are deterministic and include task and specification lineage", () => {
  assert.deepEqual(
    deterministicExecutionLineage(input),
    deterministicExecutionLineage({ ...input }),
  );
  assert.notEqual(
    deterministicExecutionLineage(input).executionId,
    deterministicExecutionLineage({
      ...input, repositoryRevision: "b".repeat(40),
    }).executionId,
  );
});

test("coordinator orchestrates existing services, tracks ordered stages, builds readiness, and reuses completed execution", async () => {
  const fixture = dependencies();
  const store = new MemoryRepositoryExecutionCoordinatorStore();
  const coordinator = new RepositoryExecutionCoordinator(
    store, fixture.result as never, () => new Date(timestamp));
  const first = await coordinator.coordinate(input);
  validateRepositoryCoordinatedExecution(first);
  assert.equal(first.execution.status, "completed");
  assert.deepEqual(first.stageHistory.map((stage) => stage.stage),
    EXECUTION_COORDINATOR_STAGES);
  assert.ok(first.stageHistory.every((stage) => stage.durationMs === 0));
  assert.equal(first.readiness?.status, "ready");
  assert.deepEqual(first.summary?.affectedFeatures, ["payments"]);
  assert.equal(first.summary?.implementationPhases.length, 7);
  const second = await coordinator.coordinate(input);
  assert.equal(second.cacheHit, true);
  assert.equal(fixture.calls.get("query"), 1);
  assert.equal(fixture.calls.get("task"), 1);
  assert.equal(fixture.calls.get("specification"), 1);
  assert.equal(fixture.calls.get("workflow"), 1);
  const metrics = await coordinator.metrics("tenant-1");
  assert.equal(metrics.executions, 1);
  assert.equal(metrics.cacheHits, 1);
  assert.equal(metrics.readinessOutcomes.ready, 1);
  assert.deepEqual(Object.keys(metrics.stageDurations),
    EXECUTION_COORDINATOR_STAGES);
});

test("coordinator enforces ownership, revision, task, specification, and workflow readiness fencing", async () => {
  const fixture = dependencies();
  fixture.repository.ownerUserId = "other";
  await assert.rejects(() => new RepositoryExecutionCoordinator(
    new MemoryRepositoryExecutionCoordinatorStore(),
    fixture.result as never,
  ).coordinate(input), (error: unknown) =>
    error instanceof RepositoryExecutionCoordinatorError &&
    error.code === "repository_execution_coordinator_access_denied");
  fixture.repository.ownerUserId = "user-1";
  fixture.repository.currentRevision = "b".repeat(40);
  await assert.rejects(() => new RepositoryExecutionCoordinator(
    new MemoryRepositoryExecutionCoordinatorStore(),
    fixture.result as never,
  ).coordinate(input), (error: unknown) =>
    error instanceof RepositoryExecutionCoordinatorError &&
    error.code === "repository_execution_coordinator_revision_conflict");
  fixture.repository.currentRevision = revision;
  fixture.result.specifications.generate = async () => ({
    ...specification(),
    specification: {
      ...specification().specification,
      specificationId: "unexpected",
    },
  });
  const failed = await new RepositoryExecutionCoordinator(
    new MemoryRepositoryExecutionCoordinatorStore(),
    fixture.result as never, () => new Date(timestamp),
  ).coordinate(input);
  assert.equal(failed.execution.status, "failed");
  assert.equal(failed.stageHistory.at(-1)?.stage,
    "specification generation");
  assert.equal(failed.stageHistory.at(-1)?.outcome, "failed");
});

test("recovery fences interrupted and partial executions; startup verifies registration and dependencies", async () => {
  const fixture = dependencies();
  const store = new MemoryRepositoryExecutionCoordinatorStore();
  const coordinator = new RepositoryExecutionCoordinator(
    store, fixture.result as never, () => new Date(timestamp));
  const completed = await coordinator.coordinate(input);
  const interrupted = {
    ...completed,
    execution: {
      ...completed.execution, status: "coordinating" as const,
      completedAt: null,
    },
    stageHistory: completed.stageHistory.slice(0, 2),
    readiness: null,
    summary: null,
  };
  store.hydrate(interrupted);
  assert.equal(await store.recover(), 1);
  assert.equal(await store.get(
    "tenant-1", "user-1", interrupted.execution.executionId), null);
  validateExecutionCoordinatorRegistration();
  let verified = 0;
  store.verify = async () => { verified += 1; };
  for (const dependency of [
    fixture.result.query, fixture.result.taskPlanner,
    fixture.result.specifications, fixture.result.workflows,
  ]) dependency.verify = async () => { verified += 1; };
  await new RepositoryExecutionCoordinator(
    store, fixture.result as never).verify();
  assert.equal(verified, 5);
});

test("PostgreSQL adapter, migration, and coordinator dependency surface preserve safety contracts", async () => {
  const fixture = dependencies();
  const value = await new RepositoryExecutionCoordinator(
    new MemoryRepositoryExecutionCoordinatorStore(),
    fixture.result as never, () => new Date(timestamp),
  ).coordinate(input);
  const calls: string[] = [];
  const database = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "save_repository_coordinated_execution" ||
          name === "get_repository_coordinated_execution") {
        return { data: [{ execution: value }], error: null };
      }
      if (name === "repository_execution_coordinator_metrics") return {
        data: [{
          executions: 1, stageDurations: {}, cacheHits: 0,
          averageOrchestrationLatencyMs: 0, recoveryCount: 0,
          readinessOutcomes: { ready: 1, partial: 0, not_ready: 0 },
        }], error: null,
      };
      if (name === "verify_repository_execution_coordinator_contract") {
        return { data: [{
          valid: true,
          schemaVersion: REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION,
          failures: [],
        }], error: null };
      }
      return { data: [1], error: null };
    },
  };
  const store = new PostgresRepositoryExecutionCoordinatorStore(
    database as never);
  assert.deepEqual(await store.save(value), value);
  assert.deepEqual(await store.get(
    "tenant-1", "user-1", value.execution.executionId), value);
  await store.recordCacheHit(
    "tenant-1", "user-1", value.execution.executionId);
  assert.equal(await store.recover(), 1);
  assert.equal((await store.metrics()).executions, 1);
  assert.equal(await store.collect("tenant-1", 10), 1);
  await store.verify();
  assert.deepEqual(calls, [
    "save_repository_coordinated_execution",
    "get_repository_coordinated_execution",
    "record_repository_execution_coordination_cache_hit",
    "recover_repository_coordinated_executions",
    "repository_execution_coordinator_metrics",
    "collect_repository_coordinated_executions",
    "verify_repository_execution_coordinator_contract",
  ]);
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260829000000_add_repository_execution_coordinator.sql",
    import.meta.url), "utf8");
  for (const contract of [
    "repository_coordinated_executions",
    "repository_execution_stage_history",
    "repository_execution_readiness_reports",
    "repository_execution_coordinator_diagnostics",
    "repository_execution_coordinator_cache",
    "repository_execution_coordinator_metrics",
    "repository_execution_coordinator_retention",
    "enable row level security", "service_role", "on delete cascade",
    "repository_execution_coordinator_cache_identity_idx",
    "verify_repository_execution_coordinator_contract",
  ]) assert.ok(migration.includes(contract), contract);
  const service = await readFile(new URL(
    "../services/repositoryExecutionCoordinator/service.ts",
    import.meta.url), "utf8");
  for (const forbidden of [
    "child_process", "simple-git", "RepositoryApply",
    "ToolInvocation", "RepositorySandbox", "spawn(",
  ]) assert.equal(service.includes(forbidden), false, forbidden);
});
