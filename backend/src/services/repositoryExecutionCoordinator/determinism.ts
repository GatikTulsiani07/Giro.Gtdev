import { stableId } from "../repositoryExecution/determinism.js";
import {
  deterministicSpecificationId,
  normalizeSpecificationObjective,
} from "../repositorySpecification/classifier.js";
import { deterministicRepositoryTaskId } from "../repositoryTaskPlanner/classifier.js";
import type {
  CoordinateRepositoryExecutionInput,
  ExecutionCoordinatorStage,
} from "./types.js";

export function deterministicExecutionLineage(
  input: CoordinateRepositoryExecutionInput,
) {
  const taskId = deterministicRepositoryTaskId({
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    repositoryOwnerId: input.repositoryOwnerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    userRequest: input.objective,
    workflowId: input.workflowId,
    requestedAt: input.requestedAt,
  });
  const specificationId = deterministicSpecificationId({
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    repositoryOwnerId: input.repositoryOwnerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    objective: input.objective,
    taskId,
    workflowId: input.workflowId,
    requestedAt: input.requestedAt,
  });
  const executionId = stableId("repository_execution_coordination", {
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    taskId,
    specificationId,
    workflowId: input.workflowId,
    objective: normalizeSpecificationObjective(input.objective),
  });
  return { executionId, taskId, specificationId };
}

export function deterministicExecutionTransitionId(
  executionId: string,
  position: number,
  stage: ExecutionCoordinatorStage,
) {
  return stableId("repository_execution_transition", {
    executionId, position, stage,
  });
}
