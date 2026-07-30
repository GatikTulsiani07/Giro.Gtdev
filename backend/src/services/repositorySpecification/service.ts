import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableId } from "../repositoryExecution/determinism.js";
import {
  runtimeRepositoryTaskPlanner,
} from "../repositoryTaskPlanner/service.js";
import type {
  CreateRepositoryTaskPlanInput,
  RepositoryTaskPlan,
} from "../repositoryTaskPlanner/types.js";
import {
  classifyRepositorySpecification,
  deterministicSpecificationId,
  normalizeSpecificationObjective,
} from "./classifier.js";
import {
  buildRepositoryEngineeringSpecification,
  titleForSpecification,
} from "./engine.js";
import {
  runtimeRepositorySpecificationStore,
  type RepositorySpecificationStore,
} from "./store.js";
import {
  REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
  RepositorySpecificationError,
  type CreateRepositorySpecificationInput,
  type EngineeringSpecificationRecord,
} from "./types.js";
import { validateRepositoryEngineeringSpecification } from "./validation.js";

interface SpecificationDependencies {
  repositories: RepositoryStore;
  taskPlanner: {
    plan(input: CreateRepositoryTaskPlanInput): Promise<RepositoryTaskPlan>;
    verify(): Promise<void>;
  };
}

export const runtimeRepositorySpecificationDependencies:
SpecificationDependencies = {
  repositories: repositoryStore,
  taskPlanner: runtimeRepositoryTaskPlanner,
};

export class RepositorySpecificationEngine {
  constructor(
    private readonly store: RepositorySpecificationStore =
      runtimeRepositorySpecificationStore,
    private readonly dependencies: SpecificationDependencies =
      runtimeRepositorySpecificationDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async generate(input: CreateRepositorySpecificationInput) {
    const repository = await this.dependencies.repositories.getRepository(
      input.repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        repository.ownerUserId !== input.repositoryOwnerId ||
        input.ownerId !== input.repositoryOwnerId) {
      throw new RepositorySpecificationError(
        "repository_specification_access_denied",
        "Repository is not owned by the requesting user.");
    }
    if (repository.currentRevision !== input.repositoryRevision ||
        repository.indexedRevision !== input.repositoryRevision) {
      throw new RepositorySpecificationError(
        "repository_specification_revision_conflict",
        "Specification revision is not the current indexed repository revision.");
    }
    const objective = normalizeSpecificationObjective(input.objective);
    if (!objective) throw new RepositorySpecificationError(
      "repository_specification_empty_objective",
      "Specification objective must not be empty.");
    const specificationId = deterministicSpecificationId(input);
    const cached = await this.store.get(
      input.tenantId, input.ownerId, specificationId);
    if (cached &&
        cached.specification.repositoryRevision === repository.currentRevision &&
        cached.specification.taskId === (input.taskId ?? null) &&
        cached.specification.workflowId === (input.workflowId ?? null)) {
      await this.store.recordCacheHit(
        input.tenantId, input.ownerId, specificationId);
      return { ...cached, cacheHit: true };
    }
    const started = Date.now();
    let taskPlan: RepositoryTaskPlan;
    try {
      taskPlan = await this.dependencies.taskPlanner.plan({
        tenantId: input.tenantId,
        ownerId: input.ownerId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        userRequest: input.objective,
        workflowId: input.workflowId,
        requestedAt: input.requestedAt,
      });
    } catch (error) {
      throw new RepositorySpecificationError(
        "repository_specification_orchestration_failed",
        error instanceof Error ? error.message :
          "Task planning intelligence orchestration failed.");
    }
    if (input.taskId && input.taskId !== taskPlan.task.taskId) {
      throw new RepositorySpecificationError(
        "repository_specification_task_lineage_invalid",
        "Requested task ID does not match the deterministic task planning record.");
    }
    const classification = classifyRepositorySpecification(input.objective);
    const now = (input.requestedAt
      ? new Date(input.requestedAt) : this.clock()).toISOString();
    const completedAt = this.clock().toISOString();
    const ownershipFingerprint = stableId("specification_ownership", {
      repositoryOwnerId: input.repositoryOwnerId,
      featureGraph: taskPlan.sourceVersions.featureGraph,
      affectedFeatures: [...taskPlan.impact.affectedFeatures].sort(),
    });
    const record: EngineeringSpecificationRecord = {
      specificationId,
      schemaVersion: REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
      persistenceVersion: 1,
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      taskId: input.taskId ?? null,
      workflowId: input.workflowId ?? null,
      type: classification.type,
      title: titleForSpecification(classification.type, input.objective.trim()),
      objective: input.objective.trim(),
      scope: [
        ...taskPlan.impact.affectedFeatures,
        ...taskPlan.impact.affectedModules,
        ...taskPlan.impact.affectedFiles,
        ...taskPlan.impact.affectedSymbols,
      ].filter((value, index, values) => values.indexOf(value) === index).sort(),
      assumptions: [
        "Published repository intelligence accurately represents the fenced revision.",
        "Existing API contracts remain unchanged unless the objective explicitly requires an API specification.",
      ],
      constraints: [
        "This specification does not generate or contain source code.",
        `Implementation is fenced to repository revision ${input.repositoryRevision}.`,
        "Only evidence from owned, published repository intelligence may be used.",
      ],
      confidence: Number(((classification.confidence +
        taskPlan.task.confidence) / 2).toFixed(2)),
      ownershipFingerprint,
      lifecycle: taskPlan.task.lifecycle === "partial" ? "partial" : "published",
      createdAt: now,
      updatedAt: completedAt,
      completedAt,
    };
    const value = buildRepositoryEngineeringSpecification({
      record,
      taskPlan,
      latencyMs: Math.max(0, Date.now() - started),
    });
    validateRepositoryEngineeringSpecification(value);
    return this.store.save(value);
  }

  get(tenantId: string, ownerId: string, specificationId: string) {
    return this.store.get(tenantId, ownerId, specificationId);
  }
  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }
  recover() {
    return this.store.recover();
  }
  collect(tenantId: string, retainedSpecifications: number) {
    return this.store.collect(tenantId, retainedSpecifications);
  }
  async verify() {
    await this.store.verify();
    await this.dependencies.taskPlanner.verify();
  }
}

export const runtimeRepositorySpecificationEngine =
  new RepositorySpecificationEngine();
