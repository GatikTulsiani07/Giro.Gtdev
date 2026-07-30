import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableId } from "../repositoryExecution/determinism.js";
import {
  runtimeRepositoryQueryEngine,
} from "../repositoryQuery/service.js";
import type {
  RepositoryQueryExecution, RepositoryQueryInput,
} from "../repositoryQuery/types.js";
import {
  runtimeRepositorySpecificationEngine,
} from "../repositorySpecification/service.js";
import type {
  CreateRepositorySpecificationInput,
  RepositoryEngineeringSpecification,
} from "../repositorySpecification/types.js";
import {
  runtimeRepositoryTaskPlanner,
} from "../repositoryTaskPlanner/service.js";
import type {
  CreateRepositoryTaskPlanInput, RepositoryTaskPlan,
} from "../repositoryTaskPlanner/types.js";
import {
  runtimeAutonomousWorkflowOrchestrator,
} from "../autonomousWorkflow/service.js";
import type { AutonomousWorkflow } from "../autonomousWorkflow/types.js";
import {
  deterministicExecutionLineage,
  deterministicExecutionTransitionId,
} from "./determinism.js";
import {
  runtimeRepositoryExecutionCoordinatorStore,
  type RepositoryExecutionCoordinatorStore,
} from "./store.js";
import {
  buildExecutionReadiness,
  buildExecutionSummary,
} from "./summary.js";
import {
  EXECUTION_COORDINATOR_STAGES,
  REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION,
  RepositoryExecutionCoordinatorError,
  type CoordinateRepositoryExecutionInput,
  type ExecutionCoordinatorDiagnostic,
  type ExecutionCoordinatorStage,
  type RepositoryCoordinatedExecution,
  type StageOutcome,
} from "./types.js";
import {
  validateExecutionCoordinatorRegistration,
  validateRepositoryCoordinatedExecution,
} from "./validation.js";

interface CoordinatorDependencies {
  readonly repositories: RepositoryStore;
  readonly query: {
    query(input: RepositoryQueryInput): Promise<RepositoryQueryExecution>;
    verify(): Promise<void>;
  };
  readonly taskPlanner: {
    plan(input: CreateRepositoryTaskPlanInput): Promise<RepositoryTaskPlan>;
    verify(): Promise<void>;
  };
  readonly specifications: {
    generate(input: CreateRepositorySpecificationInput):
      Promise<RepositoryEngineeringSpecification>;
    verify(): Promise<void>;
  };
  readonly workflows: {
    get(tenantId: string, workflowId: string, ownerId: string):
      Promise<AutonomousWorkflow | null>;
    verify(): Promise<void>;
  };
}

export const runtimeRepositoryExecutionCoordinatorDependencies:
CoordinatorDependencies = {
  repositories: repositoryStore,
  query: runtimeRepositoryQueryEngine,
  taskPlanner: runtimeRepositoryTaskPlanner,
  specifications: runtimeRepositorySpecificationEngine,
  workflows: runtimeAutonomousWorkflowOrchestrator,
};

export class RepositoryExecutionCoordinator {
  constructor(
    private readonly store: RepositoryExecutionCoordinatorStore =
      runtimeRepositoryExecutionCoordinatorStore,
    private readonly dependencies: CoordinatorDependencies =
      runtimeRepositoryExecutionCoordinatorDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async coordinate(input: CoordinateRepositoryExecutionInput):
  Promise<RepositoryCoordinatedExecution> {
    const repository = await this.dependencies.repositories.getRepository(
      input.repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        repository.ownerUserId !== input.repositoryOwnerId ||
        input.ownerId !== input.repositoryOwnerId) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordinator_access_denied",
        "Repository is not owned by the requesting user.");
    }
    if (repository.currentRevision !== input.repositoryRevision ||
        repository.indexedRevision !== input.repositoryRevision) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordinator_revision_conflict",
        "Execution revision is not the current indexed repository revision.");
    }
    if (!input.objective.trim() || !input.workflowId.trim()) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordinator_input_invalid",
        "Objective and workflow ID are required.");
    }
    const lineage = deterministicExecutionLineage(input);
    const cached = await this.store.get(
      input.tenantId, input.ownerId, lineage.executionId);
    if (cached &&
        cached.execution.repositoryRevision === repository.currentRevision &&
        cached.execution.taskId === lineage.taskId &&
        cached.execution.specificationId === lineage.specificationId &&
        cached.execution.workflowId === input.workflowId &&
        cached.execution.ownerId === repository.ownerUserId) {
      await this.store.recordCacheHit(
        input.tenantId, input.ownerId, lineage.executionId);
      return { ...cached, cacheHit: true };
    }

    const workflow = await this.dependencies.workflows.get(
      input.tenantId, input.workflowId, input.ownerId);
    if (!workflow || workflow.repositoryId !== input.repositoryId ||
        workflow.repositoryRevision !== input.repositoryRevision ||
        workflow.ownerId !== input.ownerId) {
      throw new RepositoryExecutionCoordinatorError(
        "repository_execution_coordinator_workflow_invalid",
        "Workflow is not owned and fenced to the requested repository revision.");
    }
    const fixedTime = input.requestedAt
      ? new Date(input.requestedAt).toISOString() : null;
    const timestamp = () => fixedTime ?? this.clock().toISOString();
    const orchestrationStarted = Date.now();
    const createdAt = timestamp();
    const ownershipFingerprint = stableId("execution_coordination_ownership", {
      ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
    });
    let current: RepositoryCoordinatedExecution = await this.store.save({
      execution: {
        ...lineage,
        schemaVersion: REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION,
        persistenceVersion: 1,
        tenantId: input.tenantId,
        ownerId: input.ownerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        workflowId: input.workflowId,
        objective: input.objective.trim(),
        ownershipFingerprint,
        status: "coordinating",
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      },
      stageHistory: [],
      readiness: null,
      summary: null,
      diagnostics: [],
      cacheHit: false,
      orchestrationLatencyMs: 0,
      recoveryCount: 0,
    });
    let activeStage: ExecutionCoordinatorStage = "query";

    const transition = async (
      stage: ExecutionCoordinatorStage,
      outcome: StageOutcome,
      referenceId: string,
      startedAt: string,
      startedMs: number,
      diagnostics: readonly ExecutionCoordinatorDiagnostic[] = [],
    ) => {
      const position = current.stageHistory.length;
      if (stage !== EXECUTION_COORDINATOR_STAGES[position]) {
        throw new RepositoryExecutionCoordinatorError(
          "repository_execution_coordinator_stage_order_invalid",
          "Execution coordination stage order is invalid.");
      }
      const completedAt = timestamp();
      const updated: RepositoryCoordinatedExecution = {
        ...current,
        execution: {
          ...current.execution,
          updatedAt: completedAt,
        },
        stageHistory: [...current.stageHistory, {
          transitionId: deterministicExecutionTransitionId(
            current.execution.executionId, position, stage),
          position,
          fromStage: position === 0 ? null :
            EXECUTION_COORDINATOR_STAGES[position - 1]!,
          stage,
          outcome,
          referenceId,
          startedAt,
          completedAt,
          durationMs: fixedTime ? 0 : Math.max(0, Date.now() - startedMs),
        }],
        diagnostics: [...current.diagnostics, ...diagnostics],
      };
      current = await this.store.save(
        updated, current.execution.persistenceVersion);
    };

    try {
      let stageStartedAt = timestamp();
      let stageStartedMs = Date.now();
      const query = await this.dependencies.query.query({
        tenantId: input.tenantId,
        userId: input.ownerId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        query: input.objective,
        workflowId: input.workflowId,
        requestedAt: input.requestedAt,
      });
      const queryPartial = query.query.lifecycle !== "completed";
      await transition("query", queryPartial ? "partial" : "completed",
        query.query.queryId, stageStartedAt, stageStartedMs,
        query.diagnostics.map((item) => ({
          code: item.code, message: item.message,
          severity: item.severity, stage: "query" as const,
        })));

      activeStage = "task planning";
      stageStartedAt = timestamp();
      stageStartedMs = Date.now();
      const task = await this.dependencies.taskPlanner.plan({
        tenantId: input.tenantId,
        ownerId: input.ownerId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        userRequest: input.objective,
        workflowId: input.workflowId,
        requestedAt: input.requestedAt,
      });
      if (task.task.taskId !== lineage.taskId) {
        throw new RepositoryExecutionCoordinatorError(
          "repository_execution_coordinator_task_lineage_invalid",
          "Task Planner returned an unexpected deterministic task ID.");
      }
      const taskPartial = task.task.lifecycle !== "published";
      await transition("task planning",
        taskPartial ? "partial" : "completed", task.task.taskId,
        stageStartedAt, stageStartedMs,
        task.diagnostics.map((item) => ({
          code: item.code, message: item.message,
          severity: item.severity, stage: "task planning" as const,
        })));

      activeStage = "specification generation";
      stageStartedAt = timestamp();
      stageStartedMs = Date.now();
      const specification = await this.dependencies.specifications.generate({
        tenantId: input.tenantId,
        ownerId: input.ownerId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        objective: input.objective,
        taskId: lineage.taskId,
        workflowId: input.workflowId,
        requestedAt: input.requestedAt,
      });
      if (specification.specification.specificationId !==
          lineage.specificationId) {
        throw new RepositoryExecutionCoordinatorError(
          "repository_execution_coordinator_specification_lineage_invalid",
          "Specification Engine returned an unexpected deterministic specification ID.");
      }
      current = {
        ...current,
        execution: {
          ...current.execution,
          ownershipFingerprint:
            specification.specification.ownershipFingerprint,
        },
      };
      const specificationPartial =
        specification.specification.lifecycle !== "published";
      await transition("specification generation",
        specificationPartial ? "partial" : "completed",
        specification.specification.specificationId,
        stageStartedAt, stageStartedMs,
        specification.diagnostics.map((item) => ({
          code: item.code, message: item.message,
          severity: item.severity,
          stage: "specification generation" as const,
        })));

      activeStage = "impact verification";
      stageStartedAt = timestamp();
      stageStartedMs = Date.now();
      const impactReference = stableId("execution_verified_impact", {
        executionId: lineage.executionId,
        impact: specification.impact,
      });
      await transition("impact verification", "completed", impactReference,
        stageStartedAt, stageStartedMs);

      activeStage = "review preparation";
      stageStartedAt = timestamp();
      stageStartedMs = Date.now();
      const reviewReference = stableId("execution_review_preparation", {
        executionId: lineage.executionId,
        risks: specification.risks,
        acceptanceCriteria: specification.acceptanceCriteria,
      });
      await transition("review preparation", "completed", reviewReference,
        stageStartedAt, stageStartedMs);

      activeStage = "execution readiness";
      stageStartedAt = timestamp();
      stageStartedMs = Date.now();
      const readiness = buildExecutionReadiness(
        current.execution, task, specification, [
          workflow.workflowId,
          String(workflow.workflowVersion),
          workflow.lifecycle,
        ], timestamp());
      current = {
        ...current,
        readiness,
        summary: buildExecutionSummary(
          current.execution, specification, readiness),
      };
      await transition("execution readiness",
        readiness.status === "ready" ? "completed" : "partial",
        readiness.reportId, stageStartedAt, stageStartedMs);

      activeStage = "completion";
      stageStartedAt = timestamp();
      stageStartedMs = Date.now();
      await transition("completion",
        readiness.status === "ready" ? "completed" : "partial",
        lineage.executionId, stageStartedAt, stageStartedMs);
      const completedAt = timestamp();
      const partial = current.stageHistory.some(
        (item) => item.outcome === "partial");
      current = await this.store.save({
        ...current,
        execution: {
          ...current.execution,
          status: partial ? "partial" : "completed",
          updatedAt: completedAt,
          completedAt,
        },
        orchestrationLatencyMs: fixedTime ? 0 :
          Math.max(0, Date.now() - orchestrationStarted),
      }, current.execution.persistenceVersion);
      validateRepositoryCoordinatedExecution(current);
      return current;
    } catch (error) {
      const failure = error instanceof Error ? error.message :
        "Execution coordination failed.";
      const position = current.stageHistory.length;
      if (position < EXECUTION_COORDINATOR_STAGES.length &&
          EXECUTION_COORDINATOR_STAGES[position] === activeStage) {
        await transition(activeStage, "failed", stableId(
          "execution_coordination_failure", {
            executionId: lineage.executionId, stage: activeStage, failure,
          }), timestamp(), Date.now(), [{
          code: error instanceof RepositoryExecutionCoordinatorError
            ? error.code : "repository_execution_coordination_failed",
          message: failure, severity: "error", stage: activeStage,
        }]);
      }
      const failedAt = timestamp();
      current = await this.store.save({
        ...current,
        execution: {
          ...current.execution,
          status: "failed",
          updatedAt: failedAt,
          completedAt: null,
        },
        orchestrationLatencyMs: fixedTime ? 0 :
          Math.max(0, Date.now() - orchestrationStarted),
      }, current.execution.persistenceVersion);
      return current;
    }
  }

  get(tenantId: string, ownerId: string, executionId: string) {
    return this.store.get(tenantId, ownerId, executionId);
  }
  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }
  recover() {
    return this.store.recover();
  }
  collect(tenantId: string, retainedExecutions: number) {
    return this.store.collect(tenantId, retainedExecutions);
  }
  async verify() {
    validateExecutionCoordinatorRegistration();
    await this.store.verify();
    await this.dependencies.query.verify();
    await this.dependencies.taskPlanner.verify();
    await this.dependencies.specifications.verify();
    await this.dependencies.workflows.verify();
  }
}

export const runtimeRepositoryExecutionCoordinator =
  new RepositoryExecutionCoordinator();
