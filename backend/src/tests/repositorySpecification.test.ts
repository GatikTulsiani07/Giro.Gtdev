import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyRepositorySpecification,
  deterministicSpecificationId,
} from "../services/repositorySpecification/classifier.js";
import {
  buildRepositoryEngineeringSpecification,
  titleForSpecification,
} from "../services/repositorySpecification/engine.js";
import {
  RepositorySpecificationEngine,
} from "../services/repositorySpecification/service.js";
import {
  MemoryRepositorySpecificationStore,
  PostgresRepositorySpecificationStore,
} from "../services/repositorySpecification/store.js";
import {
  REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
  RepositorySpecificationError,
  type CreateRepositorySpecificationInput,
  type EngineeringSpecificationRecord,
  type RepositoryEngineeringSpecification,
} from "../services/repositorySpecification/types.js";
import {
  validateRepositoryEngineeringSpecification,
} from "../services/repositorySpecification/validation.js";
import type {
  RepositoryTaskPlan,
} from "../services/repositoryTaskPlanner/types.js";

const revision = "a".repeat(40);
const timestamp = "2026-08-28T00:00:00.000Z";
const input: CreateRepositorySpecificationInput = {
  tenantId: "tenant-1",
  ownerId: "user-1",
  repositoryOwnerId: "user-1",
  repositoryId: "acme/widgets",
  repositoryRevision: revision,
  objective: "Fix the payment API authentication bug",
  requestedAt: timestamp,
};

function taskPlan(): RepositoryTaskPlan {
  return {
    task: {
      taskId: "task-1", schemaVersion: "repository-task-plan-schema-v1",
      persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
      repositoryId: "acme/widgets", repositoryRevision: revision,
      userRequest: input.objective,
      normalizedObjective: "fix the payment api authentication bug",
      category: "bug fix", confidence: 0.86, lifecycle: "published",
      createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
    },
    sourceVersions: {
      repositoryIntelligence: "intelligence-v1",
      repositoryGraph: "graph-v1",
      semanticGraph: "semantic-v1",
      featureGraph: "feature-v1",
    },
    orchestrationPlan: [],
    impact: {
      affectedFeatures: ["payments"],
      affectedModules: ["payment-api"],
      affectedFiles: [
        "src/payment/service.test.ts", "src/payment/service.ts",
      ],
      affectedSymbols: ["PaymentService.authenticate"],
      dependencies: ["calls:PaymentRoute->PaymentService.authenticate"],
      downstreamImpact: ["PaymentRoute"],
    },
    phases: [],
    risk: {
      implementationComplexity: 30, architecturalRisk: 40,
      dependencyRisk: 35, regressionRisk: 55, overallRisk: 42,
      level: "medium", inputs: { coupling: 5, affectedFiles: 2 },
    },
    validationChecklist: {
      requiredTests: ["Run payment unit tests."],
      verificationSteps: ["Verify authentication failures and success."],
      affectedWorkflows: ["payment-workflow"],
      reviewChecklist: ["Review API compatibility."],
    },
    changeRoadmap: null, changeRisk: null, diagnostics: [],
    engineUsage: [
      "Repository Intelligence", "Semantic Intelligence",
      "Feature Intelligence", "Change Intelligence", "Query Engine",
      "Repository Insights", "Evolution Intelligence", "Knowledge Engine",
      "Workflow Engine",
    ],
    cacheHit: false, orchestrationLatencyMs: 3,
    accuracyInputCount: 9, recoveryCount: 0,
  };
}

function record(
  lifecycle: EngineeringSpecificationRecord["lifecycle"] = "published",
): EngineeringSpecificationRecord {
  return {
    specificationId: deterministicSpecificationId(input),
    schemaVersion: REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
    persistenceVersion: 1, tenantId: "tenant-1", ownerId: "user-1",
    repositoryId: "acme/widgets", repositoryRevision: revision,
    taskId: null, workflowId: null, type: "bug-fix",
    title: titleForSpecification("bug-fix", input.objective),
    objective: input.objective, scope: ["payments"],
    assumptions: ["Published intelligence is current."],
    constraints: ["No source code is generated."], confidence: 0.86,
    ownershipFingerprint: "ownership-v1", lifecycle,
    createdAt: timestamp, updatedAt: timestamp,
    completedAt: lifecycle === "published" ? timestamp : null,
  };
}

function specification() {
  return buildRepositoryEngineeringSpecification({
    record: record(), taskPlan: taskPlan(), latencyMs: 5,
  });
}

test("deterministic IDs and classification cover every specification type", () => {
  assert.equal(
    deterministicSpecificationId(input),
    deterministicSpecificationId({ ...input }),
  );
  const cases = {
    feature: "Add a new checkout feature",
    "bug-fix": "Fix a broken checkout defect",
    refactor: "Refactor the checkout module",
    api: "Change the checkout API endpoint contract",
    architecture: "Improve architecture module boundaries",
    migration: "Migrate the database schema",
    security: "Fix a security vulnerability",
    performance: "Optimize checkout latency and throughput",
    testing: "Add testing coverage and fixtures",
  } as const;
  for (const [expected, objective] of Object.entries(cases)) {
    assert.equal(classifyRepositorySpecification(objective).type, expected);
  }
});

test("builder composes context, impact, phases, risks, criteria, and test strategy without source code", () => {
  const value = specification();
  validateRepositoryEngineeringSpecification(value);
  assert.equal(value.implementationPhases.length, 7);
  assert.deepEqual(value.implementationPhases.map((phase) => phase.kind), [
    "preparation", "implementation", "verification", "testing", "review",
    "rollout", "post-deployment validation",
  ]);
  assert.deepEqual(value.impact.affectedFeatures, ["payments"]);
  assert.ok(value.context.knowledge.includes("Knowledge Engine"));
  assert.ok(value.risks.regression.evidence.includes("PaymentRoute"));
  assert.ok(value.acceptanceCriteria.functionalRequirements.length > 0);
  assert.ok(value.testStrategy.unitTestingPlan.some(
    (item) => item.includes("service.test.ts")));
  const unsafe = structuredClone(value) as any;
  unsafe.implementationPhases = unsafe.implementationPhases.map(
    (phase: RepositoryEngineeringSpecification["implementationPhases"][number],
      position: number) => position === 0
      ? { ...phase, actions: ["function unsafe() { return true; }"] }
      : phase);
  assert.throws(() => validateRepositoryEngineeringSpecification(unsafe));
});

test("service enforces ownership and revision fencing and reuses unchanged specifications", async () => {
  const store = new MemoryRepositorySpecificationStore();
  const repository = {
    repositoryId: "acme/widgets", ownerUserId: "user-1",
    currentRevision: revision, indexedRevision: revision,
    deletionState: "active",
  };
  let plans = 0;
  const dependencies = {
    repositories: { getRepository: async () => repository },
    taskPlanner: {
      plan: async () => { plans += 1; return taskPlan(); },
      verify: async () => {},
    },
  };
  const engine = new RepositorySpecificationEngine(
    store, dependencies as never, () => new Date(timestamp));
  const first = await engine.generate(input);
  const second = await engine.generate(input);
  assert.equal(first.specification.lifecycle, "published");
  assert.equal(second.cacheHit, true);
  assert.equal(plans, 1);
  assert.deepEqual(await engine.metrics("tenant-1"), {
    specificationsCreated: 1, cacheHits: 1,
    averageOrchestrationLatencyMs: first.orchestrationLatencyMs,
    reuseRate: 0.5, recoveryCount: 0,
  });
  await assert.rejects(() => engine.generate({
    ...input, taskId: "different-task",
  }), (error: unknown) =>
    error instanceof RepositorySpecificationError &&
    error.code === "repository_specification_task_lineage_invalid");
  repository.ownerUserId = "other";
  await assert.rejects(() => new RepositorySpecificationEngine(
    new MemoryRepositorySpecificationStore(), dependencies as never,
  ).generate(input), (error: unknown) =>
    error instanceof RepositorySpecificationError &&
    error.code === "repository_specification_access_denied");
  repository.ownerUserId = "user-1";
  repository.currentRevision = "b".repeat(40);
  await assert.rejects(() => new RepositorySpecificationEngine(
    new MemoryRepositorySpecificationStore(), dependencies as never,
  ).generate(input), (error: unknown) =>
    error instanceof RepositorySpecificationError &&
    error.code === "repository_specification_revision_conflict");
});

test("recovery fences interrupted generation and startup verifies dependencies", async () => {
  const store = new MemoryRepositorySpecificationStore();
  const interrupted = {
    ...specification(),
    specification: record("generating"),
    implementationPhases: [],
  } satisfies RepositoryEngineeringSpecification;
  store.hydrate(interrupted);
  assert.equal(await store.recover(), 1);
  assert.equal(await store.get(
    "tenant-1", "user-1", interrupted.specification.specificationId), null);
  let verified = 0;
  store.verify = async () => { verified += 1; };
  const engine = new RepositorySpecificationEngine(store, {
    repositories: {} as never,
    taskPlanner: {
      plan: async () => taskPlan(),
      verify: async () => { verified += 1; },
    },
  });
  await engine.verify();
  assert.equal(verified, 2);
});

test("PostgreSQL adapter and migration expose equivalent durable contracts", async () => {
  const value = specification();
  const calls: string[] = [];
  const database = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "save_repository_engineering_specification" ||
          name === "get_repository_engineering_specification") {
        return { data: [{ specification: value }], error: null };
      }
      if (name === "repository_specification_engine_metrics") return {
        data: [{
          specificationsCreated: 1, cacheHits: 0,
          averageOrchestrationLatencyMs: 5, reuseRate: 0,
          recoveryCount: 0,
        }], error: null,
      };
      if (name === "verify_repository_specification_engine_contract") return {
        data: [{
          valid: true,
          schemaVersion: REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
          failures: [],
        }], error: null,
      };
      return { data: [1], error: null };
    },
  };
  const store = new PostgresRepositorySpecificationStore(database as never);
  assert.deepEqual(await store.save(value), value);
  assert.deepEqual(await store.get(
    "tenant-1", "user-1", value.specification.specificationId), value);
  await store.recordCacheHit(
    "tenant-1", "user-1", value.specification.specificationId);
  assert.equal(await store.recover(), 1);
  assert.equal((await store.metrics()).specificationsCreated, 1);
  assert.equal(await store.collect("tenant-1", 10), 1);
  await store.verify();
  assert.deepEqual(calls, [
    "save_repository_engineering_specification",
    "get_repository_engineering_specification",
    "record_repository_specification_cache_hit",
    "recover_repository_engineering_specifications",
    "repository_specification_engine_metrics",
    "collect_repository_engineering_specifications",
    "verify_repository_specification_engine_contract",
  ]);
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260828000000_add_repository_engineering_specification_engine.sql",
    import.meta.url), "utf8");
  for (const contract of [
    "repository_engineering_specifications",
    "repository_specification_phases",
    "repository_specification_acceptance_criteria",
    "repository_specification_diagnostics",
    "repository_specification_cache",
    "repository_specification_metrics",
    "repository_specification_retention",
    "enable row level security", "service_role", "on delete cascade",
    "repository_specification_cache_identity_idx",
    "verify_repository_specification_engine_contract",
  ]) assert.ok(migration.includes(contract), contract);
});
