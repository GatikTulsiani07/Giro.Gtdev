import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableId } from "../repositoryExecution/determinism.js";
import {
  AutonomousWorkflowError,
  runtimeAutonomousWorkflowOrchestrator,
  type AutonomousWorkflow,
  type WorkflowStage,
} from "../autonomousWorkflow/index.js";
import { runtimeRepositoryArtifactEngine } from "../repositoryArtifact/service.js";
import { runtimeRepositoryReviewEngine } from "../repositoryReview/service.js";
import { runtimeRepositoryProposalEngine } from "../repositoryProposal/service.js";
import { runtimeRepositoryApplyEngine } from "../repositoryApply/service.js";
import { runtimeRepositoryKnowledgeEngine } from "../repositoryKnowledge/service.js";
import type {
  KnowledgeNamespace,
  RetrieveKnowledgeQuery,
} from "../repositoryKnowledge/types.js";
import {
  runtimeEngineeringApiIdempotencyStore,
  type EngineeringApiIdempotencyStore,
} from "./idempotencyStore.js";

export interface EngineeringPlatformApiDependencies {
  readonly workflows: typeof runtimeAutonomousWorkflowOrchestrator;
  readonly artifacts: typeof runtimeRepositoryArtifactEngine;
  readonly reviews: typeof runtimeRepositoryReviewEngine;
  readonly proposals: typeof runtimeRepositoryProposalEngine;
  readonly apply: typeof runtimeRepositoryApplyEngine;
  readonly knowledge: typeof runtimeRepositoryKnowledgeEngine;
  readonly repositories: RepositoryStore;
  readonly idempotency: EngineeringApiIdempotencyStore;
}

export const runtimeEngineeringPlatformApiDependencies:
EngineeringPlatformApiDependencies = {
  workflows: runtimeAutonomousWorkflowOrchestrator,
  artifacts: runtimeRepositoryArtifactEngine,
  reviews: runtimeRepositoryReviewEngine,
  proposals: runtimeRepositoryProposalEngine,
  apply: runtimeRepositoryApplyEngine,
  knowledge: runtimeRepositoryKnowledgeEngine,
  repositories: repositoryStore,
  idempotency: runtimeEngineeringApiIdempotencyStore,
};

export class EngineeringPlatformApiError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "precondition_failed"
      | "validation_failed"
      | "service_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "EngineeringPlatformApiError";
  }
}

export interface PublicWorkflowResource {
  readonly workflowId: string;
  readonly repositoryId: string;
  readonly executionId: string;
  readonly version: number;
  readonly lifecycle: AutonomousWorkflow["lifecycle"];
  readonly currentStage: WorkflowStage | null;
  readonly approvalState: "required" | "approved" | "not_required";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly links: Readonly<Record<string, string>>;
}

export function publicWorkflow(
  workflow: AutonomousWorkflow,
): PublicWorkflowResource {
  const root = `/api/v1/workflows/${workflow.workflowId}`;
  return Object.freeze({
    workflowId: workflow.workflowId,
    repositoryId: workflow.repositoryId,
    executionId: workflow.executionId,
    version: workflow.workflowVersion,
    lifecycle: workflow.lifecycle,
    currentStage: workflow.currentStage,
    approvalState: workflow.lifecycle === "awaiting_approval"
      ? "required"
      : workflow.approvals.length > 0 ? "approved" : "not_required",
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    links: Object.freeze({
      self: root,
      history: `${root}/history`,
      artifacts: `${root}/artifacts`,
      review: `${root}/review`,
      proposal: `${root}/proposal`,
      applyPlan: `${root}/apply-plan`,
    }),
  });
}

export class EngineeringPlatformApiService {
  constructor(
    readonly dependencies: EngineeringPlatformApiDependencies =
      runtimeEngineeringPlatformApiDependencies,
  ) {}

  async verify() {
    await Promise.all([
      this.dependencies.workflows.verify(),
      this.dependencies.artifacts.verify(),
      this.dependencies.reviews.verify(),
      this.dependencies.proposals.verify(),
      this.dependencies.apply.verify(),
      this.dependencies.knowledge.verify(),
      this.dependencies.idempotency.verify(),
    ]);
  }

  async authorizeRepository(
    ownerId: string,
    repositoryId: string,
    revision?: string,
  ) {
    const repository =
      await this.dependencies.repositories.getRepository(repositoryId);
    if (!repository) {
      throw new EngineeringPlatformApiError(
        "not_found", "Repository was not found.");
    }
    if (repository.ownerUserId !== ownerId) {
      throw new EngineeringPlatformApiError(
        "forbidden", "Repository access is forbidden.");
    }
    if (repository.deletionState !== "active" ||
        repository.status !== "indexed" ||
        !repository.currentRevision) {
      throw new EngineeringPlatformApiError(
        "conflict", "Repository is not connected at a published revision.");
    }
    if (revision && revision !== repository.currentRevision) {
      throw new EngineeringPlatformApiError(
        "precondition_failed", "Repository revision is stale.");
    }
    return repository;
  }

  async createWorkflow(input: {
    ownerId: string;
    repositoryId: string;
    repositoryRevision: string;
    task: string;
    executionConfiguration: Readonly<Record<string, unknown>>;
    idempotencyKey: string;
  }) {
    await this.authorizeRepository(
      input.ownerId, input.repositoryId, input.repositoryRevision);
    const executionId = stableId("api_execution", {
      ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      task: input.task,
      executionConfiguration: input.executionConfiguration,
    });
    return this.dependencies.workflows.create({
      tenantId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      executionId,
      ownerId: input.ownerId,
      repositoryOwnerId: input.ownerId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  listWorkflows(ownerId: string) {
    return this.dependencies.workflows.list(ownerId, ownerId);
  }

  async getWorkflow(ownerId: string, workflowId: string) {
    const workflow =
      await this.dependencies.workflows.get(ownerId, workflowId, ownerId);
    if (!workflow) {
      throw new EngineeringPlatformApiError(
        "not_found", "Workflow was not found.");
    }
    return workflow;
  }

  requireVersion(workflow: AutonomousWorkflow, expectedVersion: number) {
    if (workflow.workflowVersion !== expectedVersion) {
      throw new EngineeringPlatformApiError(
        "precondition_failed", "Workflow version is stale.");
    }
  }

  async approve(ownerId: string, workflowId: string, expectedVersion: number) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    this.requireVersion(workflow, expectedVersion);
    const execution = workflow.checkpoints.find(({ stage }) =>
      stage === "execution");
    if (!execution) {
      throw new EngineeringPlatformApiError(
        "conflict", "Workflow has not produced an execution.");
    }
    return this.dependencies.workflows.approve({
      tenantId: ownerId,
      workflowId,
      ownerId,
      expectedWorkflowVersion: expectedVersion,
      idempotencyKey: `api-approval:${workflowId}:${expectedVersion}`,
      executionApproval: {
        decision: "approved",
        input: {
          ownerId,
          repositoryId: workflow.repositoryId,
          executionId: workflow.executionId,
          executionVersion: execution.result.referenceVersion,
          repositoryRevision: workflow.repositoryRevision,
          idempotencyKey: `api-execution-approval:${workflowId}`,
        },
      },
    });
  }

  async retry(ownerId: string, workflowId: string, expectedVersion: number) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    this.requireVersion(workflow, expectedVersion);
    return this.dependencies.workflows.retry({
      tenantId: ownerId, workflowId, ownerId,
      expectedWorkflowVersion: expectedVersion,
    });
  }

  async resume(ownerId: string, workflowId: string, expectedVersion: number) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    this.requireVersion(workflow, expectedVersion);
    return this.dependencies.workflows.resume({
      tenantId: ownerId, workflowId, ownerId,
      expectedWorkflowVersion: expectedVersion,
    });
  }

  async cancel(ownerId: string, workflowId: string, expectedVersion: number) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    this.requireVersion(workflow, expectedVersion);
    return this.dependencies.workflows.cancel({
      tenantId: ownerId, workflowId, ownerId,
      expectedWorkflowVersion: expectedVersion,
      idempotencyKey: `api-cancel:${workflowId}:${expectedVersion}`,
      executionCancellation: workflow.checkpoints.some(({ stage }) =>
        stage === "execution") ? {
          ownerId,
          repositoryId: workflow.repositoryId,
          executionId: workflow.executionId,
          idempotencyKey: `api-execution-cancel:${workflowId}`,
        } : undefined,
    });
  }

  async replay(ownerId: string, workflowId: string, expectedVersion: number) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    this.requireVersion(workflow, expectedVersion);
    return this.dependencies.workflows.replay(ownerId, workflowId, ownerId);
  }

  async artifact(ownerId: string, workflowId: string, artifactId?: string) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    const checkpoint = workflow.checkpoints.find(({ stage }) =>
      stage === "artifact");
    if (!checkpoint || (artifactId &&
        checkpoint.result.referenceId !== artifactId)) {
      throw new EngineeringPlatformApiError(
        "not_found", "Artifact was not found for this workflow.");
    }
    const artifact = await this.dependencies.artifacts.get(
      ownerId, checkpoint.result.referenceId, ownerId);
    if (!artifact || artifact.executionId !== workflow.executionId) {
      throw new EngineeringPlatformApiError(
        "not_found", "Artifact was not found for this workflow.");
    }
    return artifact;
  }

  private async stageResource(
    ownerId: string,
    workflowId: string,
    stage: "review" | "proposal" | "apply",
  ) {
    const workflow = await this.getWorkflow(ownerId, workflowId);
    const checkpoint = workflow.checkpoints.find((item) => item.stage === stage);
    if (!checkpoint) {
      throw new EngineeringPlatformApiError(
        "not_found", `${stage} is not available.`);
    }
    const engine = stage === "review" ? this.dependencies.reviews
      : stage === "proposal" ? this.dependencies.proposals
      : this.dependencies.apply;
    const resource = await engine.get(
      ownerId, checkpoint.result.referenceId, ownerId);
    if (!resource || resource.executionId !== workflow.executionId) {
      throw new EngineeringPlatformApiError(
        "not_found", `${stage} is not available.`);
    }
    return resource;
  }

  review(ownerId: string, workflowId: string) {
    return this.stageResource(ownerId, workflowId, "review");
  }

  proposal(ownerId: string, workflowId: string) {
    return this.stageResource(ownerId, workflowId, "proposal");
  }

  applyPlan(ownerId: string, workflowId: string) {
    return this.stageResource(ownerId, workflowId, "apply");
  }

  async retrieveKnowledge(input: {
    ownerId: string;
    repositoryId: string;
    repositoryRevision?: string;
    namespace?: KnowledgeNamespace;
    subject?: string;
    executionId?: string;
    minimumConfidence?: number;
    version?: number;
    limit?: number;
  }) {
    await this.authorizeRepository(input.ownerId, input.repositoryId);
    const query: RetrieveKnowledgeQuery = {
      tenantId: input.ownerId,
      ownerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      namespace: input.namespace,
      subject: input.subject,
      executionId: input.executionId,
      minimumConfidence: input.minimumConfidence,
      version: input.version,
      limit: input.limit,
    };
    return this.dependencies.knowledge.retrieve(query);
  }

  async getKnowledge(
    ownerId: string,
    repositoryId: string,
    knowledgeId: string,
  ) {
    await this.authorizeRepository(ownerId, repositoryId);
    const entry = await this.dependencies.knowledge.get(
      ownerId, knowledgeId, ownerId);
    if (!entry || entry.repositoryId !== repositoryId) {
      throw new EngineeringPlatformApiError(
        "not_found", "Knowledge entry was not found.");
    }
    return entry;
  }

  async memories(ownerId: string, repositoryId: string) {
    await this.authorizeRepository(ownerId, repositoryId);
    return this.dependencies.knowledge.listMemories(
      ownerId, repositoryId, ownerId);
  }
}

export const runtimeEngineeringPlatformApiService =
  new EngineeringPlatformApiService();
