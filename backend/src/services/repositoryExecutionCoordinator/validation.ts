import {
  EXECUTION_COORDINATOR_STAGES,
  REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION,
  REPOSITORY_EXECUTION_COORDINATOR_VERSION,
  RepositoryExecutionCoordinatorError,
  type RepositoryCoordinatedExecution,
} from "./types.js";

export const EXECUTION_COORDINATOR_REGISTRATION = Object.freeze({
  coordinator: REPOSITORY_EXECUTION_COORDINATOR_VERSION,
  services: Object.freeze([
    "Repository Intelligence", "Semantic Intelligence",
    "Feature Intelligence", "Change Intelligence", "Query Engine",
    "Insight Engine", "Evolution Engine", "Knowledge Engine",
    "Workflow Engine", "Task Planner", "Specification Engine",
  ]),
});

export function validateExecutionCoordinatorRegistration() {
  if (EXECUTION_COORDINATOR_REGISTRATION.services.length !== 11 ||
      new Set(EXECUTION_COORDINATOR_REGISTRATION.services).size !== 11 ||
      EXECUTION_COORDINATOR_REGISTRATION.coordinator !==
        REPOSITORY_EXECUTION_COORDINATOR_VERSION) {
    throw new RepositoryExecutionCoordinatorError(
      "repository_execution_coordinator_registration_invalid",
      "Execution coordinator service registration is invalid.");
  }
}

export function validateRepositoryCoordinatedExecution(
  value: RepositoryCoordinatedExecution,
) {
  const execution = value.execution;
  const completed = execution.status === "completed" ||
    execution.status === "partial";
  const transitionIds = new Set(value.stageHistory.map(
    (item) => item.transitionId));
  const forbidden = /```|(?:^|\s)(?:function|class|const|let|var)\s+\w+\s*(?:[=({:]|=>)|(?:^|\s)(?:import|export)\s+/i;
  const summaryText = value.summary ? [
    ...value.summary.validationChecklist,
    ...value.summary.implementationPhases.flatMap((phase) =>
      [phase.objective, ...phase.actions]),
    ...Object.values(value.summary.testingStrategy).flat(),
  ] : [];
  if (!execution.executionId ||
      execution.schemaVersion !==
        REPOSITORY_EXECUTION_COORDINATOR_SCHEMA_VERSION ||
      !execution.tenantId || !execution.ownerId || !execution.repositoryId ||
      !/^[0-9a-f]{40}$/.test(execution.repositoryRevision) ||
      !execution.taskId || !execution.specificationId ||
      !execution.workflowId || !execution.objective ||
      !execution.ownershipFingerprint ||
      value.orchestrationLatencyMs < 0 || value.recoveryCount < 0 ||
      (completed && value.stageHistory.length !==
        EXECUTION_COORDINATOR_STAGES.length) ||
      value.stageHistory.some((transition, position) =>
        transition.position !== position ||
        transition.stage !== EXECUTION_COORDINATOR_STAGES[position] ||
        transition.fromStage !== (
          position === 0 ? null : EXECUTION_COORDINATOR_STAGES[position - 1]
        ) ||
        !transition.transitionId || !transition.referenceId ||
        transition.durationMs < 0) ||
      transitionIds.size !== value.stageHistory.length ||
      (completed && (!value.readiness || !value.summary)) ||
      execution.status === "completed" &&
        value.readiness?.status !== "ready" ||
      value.summary?.readinessStatus !== value.readiness?.status ||
      summaryText.some((text) => forbidden.test(text))) {
    throw new RepositoryExecutionCoordinatorError(
      "repository_coordinated_execution_invalid",
      "Execution coordination structure, lineage, ordering, readiness, or safety contract is invalid.",
      { coordinatorVersion: REPOSITORY_EXECUTION_COORDINATOR_VERSION });
  }
}

export const cloneCoordinatedExecution = <T>(value: T): T =>
  structuredClone(value);
