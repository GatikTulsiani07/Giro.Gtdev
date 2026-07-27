import assert from "node:assert/strict";
import test from "node:test";

import { AgentCapabilityRegistry } from "../services/agentRuntime/registry.js";
import { AgentRuntimeScheduler } from "../services/agentRuntime/service.js";
import { MemoryAgentRuntimeStore } from "../services/agentRuntime/store.js";
import {
  EndToEndEngineeringWorkflowHarness,
  ExistingServicesWorkflowComposition,
  MemoryAutonomousWorkflowStore,
  WORKFLOW_ENGINE_REGISTRY,
  WORKFLOW_STAGES,
  type WorkflowHarnessScenario,
  type WorkflowServiceDependencies,
  type WorkflowStage,
} from "../services/autonomousWorkflow/index.js";
import {
  MultiAgentCollaborationEngine,
  MemoryCollaborationStore,
} from "../services/multiAgentCollaboration/index.js";
import {
  RepositoryApplyEngine,
  MemoryRepositoryApplyStore,
} from "../services/repositoryApply/index.js";
import {
  RepositoryArtifactEngine,
  MemoryRepositoryArtifactStore,
} from "../services/repositoryArtifact/index.js";
import { stableHash } from "../services/repositoryExecution/determinism.js";
import { prepareExecutionRun } from "../services/repositoryExecution/orchestrator.js";
import {
  RepositoryExecutionOrchestrator,
  runtimeExecutionQuotas,
} from "../services/repositoryExecution/service.js";
import { MemoryRepositoryExecutionStore } from "../services/repositoryExecution/store.js";
import { analyzeRepositoryIntelligence } from "../services/repositoryIntelligence/analyzer.js";
import { RepositoryIntelligenceService } from "../services/repositoryIntelligence/service.js";
import { MemoryRepositoryIntelligenceStore } from "../services/repositoryIntelligence/store.js";
import {
  RepositoryKnowledgeEngine,
  MemoryRepositoryKnowledgeStore,
} from "../services/repositoryKnowledge/index.js";
import {
  RepositoryPlanningService,
} from "../services/repositoryPlanning/service.js";
import { buildRepositoryPlan } from "../services/repositoryPlanning/planner.js";
import { MemoryRepositoryPlanningStore } from "../services/repositoryPlanning/store.js";
import type { RepositoryPlanningInput } from "../services/repositoryPlanning/types.js";
import {
  RepositoryProposalEngine,
  MemoryRepositoryProposalStore,
} from "../services/repositoryProposal/index.js";
import {
  RepositoryReviewEngine,
  MemoryRepositoryReviewStore,
} from "../services/repositoryReview/index.js";
import {
  RepositoryWorkspacePatchEngine,
  MemoryRepositoryWorkspaceStore,
} from "../services/repositoryWorkspace/index.js";
import {
  ToolInvocationService,
  ToolRegistry,
  MemoryToolInvocationStore,
} from "../services/toolInvocation/index.js";

const at = new Date("2099-08-19T00:00:00.000Z");
const revision = "d".repeat(40);
const repositoryId = "acme/integration";
const logger = {
  info() {}, warn() {}, error() {}, debug() {}, async flush() {},
};

function graphNode(
  nodeId: string,
  file: string,
  name: string,
  graphVersion: string,
) {
  return {
    nodeId, symbolId: nodeId, graphVersion, repositoryId,
    repositoryRevision: revision, repositoryVersion: revision,
    parserVersion: "typescript-compiler-v1", name,
    qualifiedName: `${file}:${name}`, kind: "function" as const,
    language: "typescript", file, line: 1, endLine: 3,
    column: 1, endColumn: 1, exported: true, defaultExport: false,
    metadata: {},
  };
}

function planningFixture(): RepositoryPlanningInput {
  const graphVersion = "integration-graph-v1";
  const nodes = [
    graphNode("a", "src/a.ts", "a", graphVersion),
    graphNode("z", "src/z.ts", "z", graphVersion),
  ];
  const edges = [{
    edgeId: "a-z", graphVersion, repositoryId,
    repositoryRevision: revision, parserVersion: "typescript-compiler-v1",
    fromNodeId: "a", toNodeId: "z", fromSymbolId: "a", toSymbolId: "z",
    kind: "imports" as const, distance: 1, metadata: {},
  }];
  const snapshot = analyzeRepositoryIntelligence({
    repositoryId, repositoryRevision: revision, graphVersion,
    embeddingVersion: "integration-embedding-v1",
    parserVersion: "typescript-compiler-v1", nodes, edges,
    files: nodes.map(({ file }) => ({ filePath: file, size: 100 })),
    changedFiles: [],
  });
  return {
    repositoryId, repositoryRevision: revision,
    userTask: "Add deterministic integration proposal",
    intelligence: {
      ...snapshot, status: "published", createdAt: at.toISOString(),
      validatedAt: at.toISOString(), publishedAt: at.toISOString(),
      publicationMetadata: {
        repositoryRevision: revision, graphVersion,
        embeddingVersion: snapshot.embeddingVersion,
        previousIntelligenceVersion: null,
      },
    },
    graph: {
      graphVersion, repositoryId, repositoryRevision: revision,
      repositoryVersion: revision, parserVersion: "typescript-compiler-v1",
      status: "published", createdAt: at.toISOString(),
      publishedAt: at.toISOString(), nodes, edges,
      diagnostics: {
        parsedFileCount: 2, parserFailureCount: 0,
        unresolvedImportCount: 0, importCount: 1,
        unresolvedFileRatio: 0, parserFailureRatio: 0,
        orphanSymbolCount: 0, duplicateNodeIdCount: 0,
        duplicateEdgeIdCount: 0, missingEndpointCount: 0,
        impossibleSelfEdgeCount: 0, graphBytes: 200, durationMs: 1,
        failures: [],
      },
    },
    embeddingVersion: snapshot.embeddingVersion,
    retrievalResults: [{
      repository: repositoryId, filePath: "src/a.ts",
      language: "typescript", content: "export const a = 1;",
      startLine: 1, endLine: 1, score: 0.95, source: "semantic",
      signals: { semantic: 0.95 }, chunkId: "a", symbol: "a",
    }],
    repositoryStatistics: { files: 2, symbols: 2, dependencyEdges: 1 },
    repositoryHistory: [],
  };
}

async function realServices() {
  const fixture = planningFixture();
  const intelligenceStore = new MemoryRepositoryIntelligenceStore();
  const identity = {
    repositoryId, revision, branch: null, jobId: "integration-job",
    workerId: "integration-worker", claimToken: "integration-claim",
  };
  await intelligenceStore.begin(identity, fixture.intelligence);
  await intelligenceStore.stage(identity, fixture.intelligence);
  await intelligenceStore.validate(
    identity, fixture.intelligence.intelligenceVersion);
  await intelligenceStore.publish(
    identity, fixture.intelligence.intelligenceVersion);

  const planningStore = new MemoryRepositoryPlanningStore();
  const executionStore = new MemoryRepositoryExecutionStore();
  const agentRuntimeStore = new MemoryAgentRuntimeStore();
  const dependencies: WorkflowServiceDependencies = {
    intelligenceService: new RepositoryIntelligenceService(intelligenceStore),
    intelligenceStore,
    planningStore,
    planningService: new RepositoryPlanningService(planningStore),
    executionStore,
    executionOrchestrator:
      new RepositoryExecutionOrchestrator(executionStore),
    agentRuntimeStore,
    agentRuntimeScheduler: new AgentRuntimeScheduler(agentRuntimeStore),
    toolInvocationService: new ToolInvocationService(
      new MemoryToolInvocationStore(), new ToolRegistry(), undefined, () => at,
    ),
    collaborationEngine: new MultiAgentCollaborationEngine(
      new MemoryCollaborationStore(), undefined, logger),
    workspaceEngine: new RepositoryWorkspacePatchEngine(
      new MemoryRepositoryWorkspaceStore(), undefined, logger),
    artifactEngine: new RepositoryArtifactEngine(
      new MemoryRepositoryArtifactStore(), undefined, logger),
    reviewEngine: new RepositoryReviewEngine(
      new MemoryRepositoryReviewStore(), undefined, logger),
    proposalEngine: new RepositoryProposalEngine(
      new MemoryRepositoryProposalStore(), undefined, logger),
    applyEngine: new RepositoryApplyEngine(
      new MemoryRepositoryApplyStore(), undefined, logger),
    knowledgeEngine: new RepositoryKnowledgeEngine(
      new MemoryRepositoryKnowledgeStore(), undefined, logger),
  };
  return {
    fixture,
    composition: new ExistingServicesWorkflowComposition(dependencies),
  };
}

function expectedExecutionId(fixture: RepositoryPlanningInput): string {
  const plan = {
    ...buildRepositoryPlan(fixture),
    status: "published" as const,
    createdAt: at.toISOString(),
    validatedAt: at.toISOString(),
    publishedAt: at.toISOString(),
    publicationMetadata: {
      previousPlanVersion: null,
      repositoryRevision: fixture.repositoryRevision,
      intelligenceVersion: fixture.intelligence.intelligenceVersion,
      graphVersion: fixture.graph.graphVersion,
      embeddingVersion: fixture.embeddingVersion,
    },
  };
  return prepareExecutionRun({
    ownerId: "tenant-1", planOwnerId: "tenant-1",
    repositoryOwnerId: "tenant-1", repositoryId,
    repositoryRevision: revision, plan, policy: "agent_assisted",
    idempotencyKey: "integration-execution",
  }, runtimeExecutionQuotas, at.toISOString()).run.executionId;
}

function scenario(
  fixture: RepositoryPlanningInput,
  tenantId = "tenant-1",
  failures: Partial<Record<WorkflowStage, number>> = {},
): WorkflowHarnessScenario {
  const executionId = expectedExecutionId(fixture);
  return {
    create: {
      tenantId, repositoryId, repositoryRevision: revision,
      executionId, ownerId: tenantId, repositoryOwnerId: tenantId,
      idempotencyKey: "integration-workflow",
    },
    failureInjection: failures,
    resumeAfterExhaustion: true,
    executionApproval: (_workflow, output) => {
      const run = output as ReturnType<typeof prepareExecutionRun>["run"];
      return {
        decision: "approved",
        input: {
          ownerId: tenantId, repositoryId, executionId: run.executionId,
          executionVersion: run.executionVersion,
          repositoryRevision: revision,
          idempotencyKey: `approve-${run.executionId}`,
        },
      };
    },
    stageInput: ({ stage, previousLineage, outputs }) => {
      const plan = outputs.planning as Record<string, unknown> | undefined;
      const run = outputs.execution as Record<string, any> | undefined;
      const runtime = outputs.agent_runtime as Record<string, any> | undefined;
      const workspaceOutput = outputs.workspace as {
        workspace: Record<string, any>; claim: Record<string, any>;
      } | undefined;
      const patchOutput = outputs.patch as {
        patch: Record<string, any>; workspace: Record<string, any>;
      } | undefined;
      const patch = patchOutput?.patch;
      const currentWorkspace = patchOutput?.workspace ??
        workspaceOutput?.workspace;
      const artifact = outputs.artifact as Record<string, any> | undefined;
      const reviewOutput = outputs.review as {
        review: Record<string, any>; artifact: Record<string, any>;
      } | undefined;
      const proposal = outputs.proposal as Record<string, any> | undefined;
      const transaction = outputs.apply as Record<string, any> | undefined;
      const workUnit = run?.workUnits?.[0];
      const capability = new AgentCapabilityRegistry().get("planner").capability;
      const published = (version: string, payload: unknown) => ({
        version, published: true as const, payload,
      });
      const scoped = (version: string, payload: unknown) => ({
        ...published(version, payload), tenantId, repositoryId,
        repositoryRevision: revision,
      });
      let payload: unknown;
      switch (stage) {
        case "intelligence":
          payload = { repositoryId, repositoryRevision: revision };
          break;
        case "planning":
          payload = {
            ...fixture,
            intelligence: outputs.intelligence,
          };
          break;
        case "execution":
          payload = {
            ownerId: tenantId, planOwnerId: tenantId,
            repositoryOwnerId: tenantId, repositoryId,
            repositoryRevision: revision, plan: outputs.planning,
            policy: "agent_assisted", idempotencyKey: "integration-execution",
          };
          break;
        case "agent_runtime":
          payload = {
            agentId: "planner",
            context: {
              tenantId, executionId: run!.executionId,
              executionVersion: run!.executionVersion,
              workUnitId: workUnit.workUnitId,
              workUnitVersion: `${run!.executionVersion}:${workUnit.workUnitId}`,
              repositoryId,
              repositorySnapshot: published(revision, { files: ["src/a.ts", "src/z.ts"] }),
              retrievalBundle: published("retrieval-v1", fixture.retrievalResults),
              graphExpansion: published(fixture.graph.graphVersion, fixture.graph),
              intelligenceSnapshot: published(
                fixture.intelligence.intelligenceVersion, outputs.intelligence),
              executionMetadata: { executionId: run!.executionId },
              workUnitMetadata: { objective: workUnit.objective },
              policy: {
                planningOnly: true, repositoryMutation: false,
                allowed: capability.allowed, forbidden: capability.forbidden,
              },
              limits: {
                runtimeDurationMs: 120_000, retries: 2,
                outputBytes: 100_000, concurrentWorkUnits: 1,
              },
            },
          };
          break;
        case "tool_invocation":
          payload = {
            request: {
              toolId: "internal.hybrid-retrieval-v2",
              toolVersion: "hybrid-retrieval-v2-v1",
              input: { query: "a", limit: 2 },
              idempotencyKey: `tool-${runtime!.runtimeId}`,
            },
            context: {
              tenantId,
              repositorySnapshot: published(revision, {
                files: [{ path: "src/a.ts" }, { path: "src/z.ts" }],
              }),
              retrievalBundle: published("retrieval-v1", {
                candidates: fixture.retrievalResults,
              }),
              graph: published(fixture.graph.graphVersion, fixture.graph),
              intelligence: published(
                fixture.intelligence.intelligenceVersion, outputs.intelligence),
              planning: published(String(plan!.planVersion), plan),
              executionMetadata: {
                executionId: run!.executionId,
                executionVersion: run!.executionVersion,
                workUnitId: workUnit.workUnitId,
                workUnitVersion: `${run!.executionVersion}:${workUnit.workUnitId}`,
                repositoryId, repositoryRevision: revision,
                ownerId: tenantId, leased: true,
                leaseOwnerId: runtime!.runtimeId,
                leaseExpiresAt: "2099-08-19T01:00:00.000Z",
              },
              runtimeMetadata: {
                runtimeId: runtime!.runtimeId, healthy: true,
                ownerId: tenantId,
                allowedPermissions: [
                  "retrieval", "graph_traversal", "intelligence_lookup",
                  "planning", "diagnostics", "metrics",
                ],
              },
            },
          };
          break;
        case "collaboration":
          payload = {
            tenantId, executionId: run!.executionId,
            executionVersion: run!.executionVersion,
            repositoryId, repositoryRevision: revision,
            planVersion: String(plan!.planVersion),
            coordinatorRuntimeId: runtime!.runtimeId,
            workUnits: run!.workUnits.map((unit: Record<string, any>) => ({
              workUnitId: unit.workUnitId,
              workUnitVersion: `${run!.executionVersion}:${unit.workUnitId}`,
              order: unit.order, prerequisites: unit.prerequisites,
              eligibleAgentIds: ["backend-engineer"],
              eligibleRoles: ["contributor"], reviewRequired: true,
              maxAttempts: unit.retryPolicy.maxAttempts,
            })),
            context: {
              repositorySnapshot: scoped(revision, { files: [] }),
              retrievalBundle: scoped("retrieval-v1", outputs.tool_invocation),
              repositoryGraph: scoped(fixture.graph.graphVersion, fixture.graph),
              intelligence: scoped(
                fixture.intelligence.intelligenceVersion, outputs.intelligence),
              planning: scoped(String(plan!.planVersion), plan),
              executionMetadata: scoped(run!.executionVersion, {
                executionId: run!.executionId,
                executionVersion: run!.executionVersion,
                planVersion: String(plan!.planVersion),
              }),
            },
          };
          break;
        case "workspace":
          payload = {
            activate: true,
            create: {
              tenantId, repositoryId, repositoryRevision: revision,
              executionId: run!.executionId, workUnitId: workUnit.workUnitId,
              ownerId: tenantId, repositoryOwnerId: tenantId,
              executionOwnerId: tenantId,
              snapshot: {
                published: true, tenantId, repositoryId,
                repositoryRevision: revision, snapshotVersion: revision,
                revisionHash: revision, graphVersion: fixture.graph.graphVersion,
                intelligenceVersion: fixture.intelligence.intelligenceVersion,
                retrievalVersion: "retrieval-v1",
                planningVersion: String(plan!.planVersion),
              },
              collaborationReference: {
                collaborationId: (outputs.collaboration as any).collaborationId,
                contentHash: previousLineage!.outputHash,
              },
            },
          };
          break;
        case "patch":
          payload = {
            claim: workspaceOutput!.claim, basePatchVersion: 0,
            fileOperations: [
              { operation: "create_file", path: "src/a.ts",
                content: "export const a = 1;\n" },
              { operation: "update_file", path: "src/z.ts",
                content: "export const z = 2;\n",
                expectedContentHash: "before-z" },
            ],
            symbolOperations: [{
              operation: "add_symbol", filePath: "src/a.ts", symbol: "a",
              declaration: "export const a = 1;",
            }],
            diagnostics: [], confidence: 0.95,
          };
          break;
        case "artifact":
          payload = {
            tenantId, ownerId: tenantId, repositoryOwnerId: tenantId,
            executionOwnerId: tenantId, artifactType: "source_code",
            baseArtifactVersion: 0, workspace: currentWorkspace,
            snapshot: currentWorkspace!.snapshot, patch,
            repositoryGraph: {
              version: fixture.graph.graphVersion,
              contentHash: stableHash(fixture.graph), published: true,
            },
            intelligence: {
              version: fixture.intelligence.intelligenceVersion,
              contentHash: stableHash(outputs.intelligence), published: true,
            },
            planning: {
              version: String(plan!.planVersion),
              contentHash: stableHash(plan), published: true,
            },
            executionMetadata: {
              executionId: run!.executionId, workUnitId: workUnit.workUnitId,
              ownerId: tenantId, executionVersion: run!.executionVersion,
            },
            workspaceMetadata: {
              workspaceId: currentWorkspace!.workspaceId,
              ownerId: tenantId,
              lifecycle: currentWorkspace!.lifecycle,
              snapshotVersion: currentWorkspace!.snapshotVersion,
              patchVersion: patch!.patchVersion,
            },
          };
          break;
        case "review":
          payload = {
            create: {
              tenantId, ownerId: tenantId, repositoryOwnerId: tenantId,
              executionOwnerId: tenantId, reviewerType: "system",
              baseReviewVersion: 0, artifact,
              workspace: currentWorkspace,
              snapshot: currentWorkspace!.snapshot, patch,
              repositoryGraph: {
                version: fixture.graph.graphVersion,
                contentHash: stableHash(fixture.graph), published: true,
                dependencies: [{
                  fromFile: "src/a.ts", toFile: "src/z.ts", blocking: true,
                }],
                symbols: [{ filePath: "src/a.ts", symbol: "a" }],
              },
              intelligence: {
                version: fixture.intelligence.intelligenceVersion,
                contentHash: stableHash(outputs.intelligence), published: true,
                knownFiles: ["src/a.ts", "src/z.ts"],
                knownSymbols: [{ filePath: "src/a.ts", symbol: "a" }],
              },
              planning: {
                version: String(plan!.planVersion),
                contentHash: stableHash(plan), published: true,
                affectedFiles: ["src/a.ts", "src/z.ts"],
                affectedSymbols: [{ filePath: "src/a.ts", symbol: "a" }],
                dependencies: [{
                  fromFile: "src/a.ts", toFile: "src/z.ts", blocking: true,
                }],
              },
              executionMetadata: {
                executionId: run!.executionId, workUnitId: workUnit.workUnitId,
                ownerId: tenantId, executionVersion: run!.executionVersion,
              },
            },
            decision: {
              tenantId, ownerId: tenantId, reviewerId: "integration-reviewer",
              verdict: "approved", rationaleCodes: ["all_gates_passed"],
              idempotencyKey: "integration-review",
            },
            artifactDecision: {
              tenantId, ownerId: tenantId, reviewerId: "integration-reviewer",
              decision: "approved", findings: [],
              idempotencyKey: "integration-artifact-approval",
            },
          };
          break;
        case "proposal":
          payload = {
            assemble: {
              tenantId, ownerId: tenantId, repositoryOwnerId: tenantId,
              executionOwnerId: tenantId, baseProposalVersion: 0,
              workspace: currentWorkspace,
              artifacts: [reviewOutput!.artifact], patches: [patch],
              reviews: [reviewOutput!.review],
              executionMetadata: {
                executionId: run!.executionId, workUnitId: workUnit.workUnitId,
                ownerId: tenantId, executionVersion: run!.executionVersion,
              },
            },
            decision: {
              tenantId, ownerId: tenantId, reviewerId: "integration-reviewer",
              verdict: "approved", rationaleCodes: ["ready"],
              idempotencyKey: "integration-proposal",
            },
          };
          break;
        case "apply":
          payload = {
            prepare: {
              tenantId, ownerId: tenantId, repositoryOwnerId: tenantId,
              executionOwnerId: tenantId, baseTransactionVersion: 0,
              proposal, workspace: currentWorkspace,
              artifacts: [reviewOutput!.artifact], patches: [patch],
              executionMetadata: {
                executionId: run!.executionId, workUnitId: workUnit.workUnitId,
                ownerId: tenantId, executionVersion: run!.executionVersion,
              },
            },
            confirmation: {
              tenantId, ownerId: tenantId, confirmerId: "integration-owner",
              decision: "ready", rationaleCodes: ["confirmed"],
              idempotencyKey: "integration-apply",
            },
          };
          break;
        case "knowledge":
          payload = {
            tenantId, ownerId: tenantId, repositoryOwnerId: tenantId,
            repositoryId, repositoryRevision: revision,
            namespace: "implementation", subject: "integration proposal",
            content: {
              schemaVersion: "repository-knowledge-schema-v1",
              summary: "The approved proposal has a deterministic apply plan.",
              facts: [{
                key: "transaction", value: transaction!.transactionId,
                evidence: [proposal!.proposalId],
              }],
              tags: ["integration", "workflow"],
            },
            sources: [{
              sourceId: proposal!.proposalId, sourceType: "proposal",
              repositoryId, repositoryRevision: revision,
              sourceVersion: String(proposal!.proposalVersion),
              contentHash: previousLineage!.outputHash,
              executionId: run!.executionId, published: true,
              publishedAt: at.toISOString(),
            }],
            confidence: 0.95, executionId: run!.executionId, baseVersion: 0,
          };
          break;
      }
      return { payload, consumed: previousLineage };
    },
  };
}

async function execute(
  tenantId = "tenant-1",
  failures: Partial<Record<WorkflowStage, number>> = {},
) {
  const services = await realServices();
  const harness = new EndToEndEngineeringWorkflowHarness(
    new MemoryAutonomousWorkflowStore(), services.composition,
    undefined, () => at,
  );
  return {
    harness,
    result: await harness.run(scenario(services.fixture, tenantId, failures)),
  };
}

test("real services complete the lineage-fenced engineering lifecycle", async () => {
  const { result } = await execute();
  assert.equal(result.workflow.lifecycle, "completed");
  assert.deepEqual(result.stageOrder, WORKFLOW_STAGES);
  assert.match(result.lineage.artifact!.referenceId, /^repository_artifact_/);
  assert.match(result.lineage.proposal!.referenceId, /^repository_proposal_/);
  assert.match(result.lineage.apply!.referenceId, /^repository_apply_/);
  assert.match(result.lineage.knowledge!.referenceId, /^knowledge_/);
  assert.ok(Object.values(result.metrics.stageSuccessRate)
    .every((rate) => rate === 1));
});

test("identical real-service runs replay deterministically", async () => {
  const left = await execute();
  const right = await execute();
  const replay = left.harness.validateReplay(left.result, right.result);
  assert.equal(replay.valid, true);
  assert.equal(replay.replayCount, 1);
  assert.equal(left.result.workflow.workflowId, right.result.workflow.workflowId);
  for (const stage of ["artifact", "proposal", "knowledge"] as const) {
    assert.equal(left.result.lineage[stage]?.referenceId,
      right.result.lineage[stage]?.referenceId);
  }
  assert.deepEqual(left.result.workflow.diagnostics.map(({ code }) => code),
    right.result.workflow.diagnostics.map(({ code }) => code));
  assert.deepEqual(left.result.metrics, right.result.metrics);
});

test("every stage supports deterministic failure retry with audit preservation",
  async () => {
    for (const stage of WORKFLOW_STAGES) {
      const { result } = await execute(`tenant-failure-${stage}`, {
        [stage]: 1,
      });
      assert.equal(result.workflow.lifecycle, "completed");
      assert.equal(result.workflow.retryCounts[stage], 1);
      assert.ok(result.workflow.diagnostics.some((item) =>
        item.stage === stage &&
        item.code === "integration_harness_injected_failure"));
      assert.ok(result.workflow.attemptHistory.some((item) =>
        item.stage === stage && item.event === "failed"));
    }
  });

test("expired interruption recovery and retry exhaustion resume committed state",
  async () => {
    const services = await realServices();
    let clock = at;
    const recoverHarness = new EndToEndEngineeringWorkflowHarness(
      new MemoryAutonomousWorkflowStore(), services.composition,
      undefined, () => clock);
    const recoveryScenario = {
      ...scenario(services.fixture, "tenant-recovery"),
      interruptOnceAt: "intelligence" as const,
      onInterrupted: () => {
        clock = new Date(at.getTime() + 6 * 60 * 1_000);
      },
    };
    const recovered = await recoverHarness.run(recoveryScenario);
    assert.equal(recovered.workflow.lifecycle, "completed");
    assert.equal(recovered.workflow.recoveryCount, 1);
    assert.equal(recovered.metrics.recoveries, 1);
    assert.equal(recovered.workflow.recoveryHistory[0]?.stage, "intelligence");

    const resumed = await execute("tenant-resume", { intelligence: 4 });
    assert.equal(resumed.result.workflow.lifecycle, "completed");
    assert.equal(resumed.result.workflow.resumeCount, 1);
    assert.ok(resumed.result.workflow.lifecycleHistory.some((event) =>
      event.reason === "workflow_resumed"));
    assert.equal(resumed.result.workflow.checkpoints.length,
      WORKFLOW_STAGES.length);
  });

test("cancellation, concurrent tenants, isolation, and startup discovery hold",
  async () => {
    assert.deepEqual(
      WORKFLOW_ENGINE_REGISTRY.map(({ stage }) => stage), WORKFLOW_STAGES);
    const services = await realServices();
    const store = new MemoryAutonomousWorkflowStore();
    const harness = new EndToEndEngineeringWorkflowHarness(
      store, services.composition, undefined, () => at);
    await harness.verifyStartup();
    const cancelledScenario = {
      ...scenario(services.fixture, "tenant-cancel", { review: 1 }),
      cancelAfterFailureAt: "review" as const,
    };
    const cancelled = await harness.run(cancelledScenario);
    assert.equal(cancelled.workflow.lifecycle, "cancelled");
    assert.ok(cancelled.workflow.attemptHistory.some((event) =>
      event.stage === "review" && event.event === "failed"));

    const [left, right] = await Promise.all([
      execute("tenant-concurrent-a"),
      execute("tenant-concurrent-b"),
    ]);
    assert.equal(left.result.workflow.lifecycle, "completed");
    assert.equal(right.result.workflow.lifecycle, "completed");
    assert.notEqual(left.result.workflow.workflowId,
      right.result.workflow.workflowId);
    assert.equal(await store.get(
      "tenant-concurrent-a", right.result.workflow.workflowId,
      "tenant-concurrent-a"), null);
    assert.deepEqual(left.result.stageOrder, right.result.stageOrder);
  });
