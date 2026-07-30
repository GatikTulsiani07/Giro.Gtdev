import { stableId } from "../repositoryExecution/determinism.js";
import type { RepositoryEngineeringSpecification } from "../repositorySpecification/types.js";
import type { RepositoryTaskPlan } from "../repositoryTaskPlanner/types.js";
import type {
  CoordinatedExecutionRecord, ExecutionReadinessCheck,
  ExecutionReadinessReport, ExecutionSummary,
} from "./types.js";

const unique = (values: readonly string[]) =>
  [...new Set(values.filter(Boolean))].sort();

export function buildExecutionReadiness(
  execution: CoordinatedExecutionRecord,
  task: RepositoryTaskPlan,
  specification: RepositoryEngineeringSpecification,
  workflowEvidence: readonly string[],
  createdAt: string,
): ExecutionReadinessReport {
  const sourceVersions = Object.values(task.sourceVersions);
  const checks: ExecutionReadinessCheck[] = [
    { name: "ownership", passed:
      task.task.ownerId === execution.ownerId &&
      specification.specification.ownerId === execution.ownerId,
    evidence: [execution.ownerId] },
    { name: "repository revision", passed:
      task.task.repositoryRevision === execution.repositoryRevision &&
      specification.specification.repositoryRevision ===
        execution.repositoryRevision,
    evidence: [execution.repositoryRevision] },
    { name: "published intelligence", passed:
      sourceVersions.every(Boolean),
    evidence: unique(sourceVersions) },
    { name: "specification availability", passed:
      ["published", "partial"].includes(
        specification.specification.lifecycle),
    evidence: [specification.specification.specificationId] },
    { name: "task validity", passed:
      task.task.taskId === execution.taskId &&
      ["published", "partial"].includes(task.task.lifecycle),
    evidence: [task.task.taskId, task.task.schemaVersion] },
    { name: "graph integrity", passed:
      Boolean(task.sourceVersions.repositoryGraph),
    evidence: [task.sourceVersions.repositoryGraph] },
    { name: "semantic consistency", passed:
      Boolean(task.sourceVersions.semanticGraph),
    evidence: [task.sourceVersions.semanticGraph] },
    { name: "feature lineage", passed:
      Boolean(task.sourceVersions.featureGraph) &&
      specification.specification.ownershipFingerprint ===
        execution.ownershipFingerprint,
    evidence: [
      task.sourceVersions.featureGraph,
      specification.specification.ownershipFingerprint,
    ] },
    { name: "workflow validity", passed: workflowEvidence.length > 0,
      evidence: unique(workflowEvidence) },
  ];
  const failed = checks.filter((check) => !check.passed);
  const partialSources = task.task.lifecycle === "partial" ||
    specification.specification.lifecycle === "partial";
  const status = failed.length > 0 ? "not_ready" :
    partialSources ? "partial" : "ready";
  return {
    reportId: stableId("execution_readiness_report", {
      executionId: execution.executionId,
      checks: checks.map((check) => ({
        name: check.name, passed: check.passed,
      })),
    }),
    status, checks, createdAt,
  };
}

export function buildExecutionSummary(
  execution: CoordinatedExecutionRecord,
  specification: RepositoryEngineeringSpecification,
  readiness: ExecutionReadinessReport,
): ExecutionSummary {
  return {
    repository: {
      repositoryId: execution.repositoryId,
      revision: execution.repositoryRevision,
    },
    affectedFeatures: unique(specification.impact.affectedFeatures),
    affectedModules: unique(specification.impact.affectedModules),
    implementationPhases: structuredClone(
      specification.implementationPhases),
    risks: structuredClone(specification.risks),
    validationChecklist: unique(
      specification.acceptanceCriteria.validationChecklist),
    testingStrategy: structuredClone(specification.testStrategy),
    readinessStatus: readiness.status,
  };
}
