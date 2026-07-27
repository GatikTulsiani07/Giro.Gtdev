import { runtimeAgentQuotas } from "../agentRuntime/service.js";
import { runtimeAgentRuntimeStore } from "../agentRuntime/store.js";
import type { CreateAgentRuntimeInput } from "../agentRuntime/store.js";
import { runtimeAgentRuntimeScheduler } from "../agentRuntime/service.js";
import {
  runtimeMultiAgentCollaborationEngine,
} from "../multiAgentCollaboration/service.js";
import type {
  CreateCollaborationInput,
} from "../multiAgentCollaboration/types.js";
import {
  runtimeRepositoryApplyEngine,
} from "../repositoryApply/service.js";
import type {
  ConfirmApplyTransactionInput,
  PrepareApplyTransactionInput,
} from "../repositoryApply/types.js";
import {
  runtimeRepositoryArtifactEngine,
} from "../repositoryArtifact/service.js";
import type {
  GenerateArtifactInput,
  ReviewArtifactInput,
} from "../repositoryArtifact/types.js";
import {
  runtimeRepositoryExecutionOrchestrator,
} from "../repositoryExecution/service.js";
import { runtimeRepositoryExecutionStore } from "../repositoryExecution/store.js";
import type {
  ExecutionApprovalInput,
} from "../repositoryExecution/store.js";
import type {
  ExecutionCreationInput,
} from "../repositoryExecution/types.js";
import {
  runtimeRepositoryIntelligenceService,
} from "../repositoryIntelligence/service.js";
import {
  runtimeRepositoryIntelligenceStore,
} from "../repositoryIntelligence/store.js";
import {
  runtimeRepositoryKnowledgeEngine,
} from "../repositoryKnowledge/service.js";
import type {
  CreateKnowledgeInput,
} from "../repositoryKnowledge/types.js";
import {
  runtimeRepositoryPlanningService,
} from "../repositoryPlanning/service.js";
import {
  runtimeRepositoryPlanningStore,
} from "../repositoryPlanning/store.js";
import type {
  RepositoryPlanningInput,
} from "../repositoryPlanning/types.js";
import {
  runtimeRepositoryProposalEngine,
} from "../repositoryProposal/service.js";
import type {
  AssembleProposalInput,
  DecideProposalInput,
} from "../repositoryProposal/types.js";
import {
  runtimeRepositoryReviewEngine,
} from "../repositoryReview/service.js";
import type {
  CreateReviewInput,
  DecideReviewInput,
} from "../repositoryReview/types.js";
import {
  runtimeRepositoryWorkspacePatchEngine,
} from "../repositoryWorkspace/service.js";
import type {
  CreateWorkspaceInput,
  GeneratePatchInput,
} from "../repositoryWorkspace/types.js";
import {
  runtimeToolInvocationService,
} from "../toolInvocation/service.js";
import type {
  ToolExecutionContext,
  ToolInvocationRequest,
} from "../toolInvocation/types.js";
import { stableHash } from "../repositoryExecution/determinism.js";
import {
  AutonomousWorkflowError,
  type WorkflowDependencyRecovery,
  type WorkflowStage,
  type WorkflowStageExecution,
  type WorkflowStageResult,
} from "./types.js";

type JsonObject = Record<string, unknown>;

export interface WorkflowExecutionApprovalCommand {
  readonly decision: "approved";
  readonly input: ExecutionApprovalInput;
}

export interface WorkflowExecutionCancellationCommand {
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly executionId: string;
  readonly idempotencyKey: string;
}

export interface WorkflowToolCommand {
  readonly request: ToolInvocationRequest;
  readonly context: ToolExecutionContext;
}

export interface WorkflowWorkspaceCommand {
  readonly create: CreateWorkspaceInput;
  readonly activate: true;
}

export interface WorkflowReviewCommand {
  readonly create: CreateReviewInput;
  readonly decision: Omit<DecideReviewInput, "reviewId" | "reviewVersion">;
  readonly artifactDecision: Omit<
    ReviewArtifactInput, "artifactId" | "artifactVersion"
  >;
}

export interface WorkflowProposalCommand {
  readonly assemble: AssembleProposalInput;
  readonly decision: Omit<
    DecideProposalInput, "proposalId" | "proposalVersion"
  >;
}

export interface WorkflowApplyCommand {
  readonly prepare: PrepareApplyTransactionInput;
  readonly confirmation: Omit<
    ConfirmApplyTransactionInput, "transactionId" | "transactionVersion"
  >;
}

export interface WorkflowServiceComposition {
  execute(stage: WorkflowStage, payload: unknown):
    Promise<WorkflowStageExecution>;
  approve(payload: unknown): Promise<void>;
  cancel(payload?: unknown): Promise<void>;
  recoverDependencies(): Promise<WorkflowDependencyRecovery>;
}

export interface WorkflowServiceDependencies {
  readonly intelligenceService: typeof runtimeRepositoryIntelligenceService;
  readonly intelligenceStore: typeof runtimeRepositoryIntelligenceStore;
  readonly planningService: typeof runtimeRepositoryPlanningService;
  readonly planningStore: typeof runtimeRepositoryPlanningStore;
  readonly executionOrchestrator: typeof runtimeRepositoryExecutionOrchestrator;
  readonly executionStore: typeof runtimeRepositoryExecutionStore;
  readonly agentRuntimeScheduler: typeof runtimeAgentRuntimeScheduler;
  readonly agentRuntimeStore: typeof runtimeAgentRuntimeStore;
  readonly toolInvocationService: typeof runtimeToolInvocationService;
  readonly collaborationEngine: typeof runtimeMultiAgentCollaborationEngine;
  readonly workspaceEngine: typeof runtimeRepositoryWorkspacePatchEngine;
  readonly artifactEngine: typeof runtimeRepositoryArtifactEngine;
  readonly reviewEngine: typeof runtimeRepositoryReviewEngine;
  readonly proposalEngine: typeof runtimeRepositoryProposalEngine;
  readonly applyEngine: typeof runtimeRepositoryApplyEngine;
  readonly knowledgeEngine: typeof runtimeRepositoryKnowledgeEngine;
}

export const runtimeWorkflowServiceDependencies:
WorkflowServiceDependencies = Object.freeze({
  intelligenceService: runtimeRepositoryIntelligenceService,
  intelligenceStore: runtimeRepositoryIntelligenceStore,
  planningService: runtimeRepositoryPlanningService,
  planningStore: runtimeRepositoryPlanningStore,
  executionOrchestrator: runtimeRepositoryExecutionOrchestrator,
  executionStore: runtimeRepositoryExecutionStore,
  agentRuntimeScheduler: runtimeAgentRuntimeScheduler,
  agentRuntimeStore: runtimeAgentRuntimeStore,
  toolInvocationService: runtimeToolInvocationService,
  collaborationEngine: runtimeMultiAgentCollaborationEngine,
  workspaceEngine: runtimeRepositoryWorkspacePatchEngine,
  artifactEngine: runtimeRepositoryArtifactEngine,
  reviewEngine: runtimeRepositoryReviewEngine,
  proposalEngine: runtimeRepositoryProposalEngine,
  applyEngine: runtimeRepositoryApplyEngine,
  knowledgeEngine: runtimeRepositoryKnowledgeEngine,
});

function objectPayload(payload: unknown, stage: WorkflowStage): JsonObject {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_request_invalid",
      `${stage} requires a structured existing-service request.`);
  }
  return payload as JsonObject;
}

function value(
  output: unknown,
  key: string,
): unknown {
  return output && typeof output === "object"
    ? (output as JsonObject)[key] : undefined;
}

function stringValue(output: unknown, keys: readonly string[]): string {
  for (const key of keys) {
    const candidate = value(output, key);
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    if (typeof candidate === "number") return String(candidate);
  }
  return "";
}

function stageResult(
  stage: WorkflowStage,
  output: unknown,
  overrides: Partial<WorkflowStageResult> = {},
): WorkflowStageResult {
  const referenceKeys: Readonly<Record<WorkflowStage, readonly string[]>> = {
    intelligence: ["intelligenceVersion", "repositoryId"],
    planning: ["planVersion"],
    execution: ["executionId"],
    agent_runtime: ["runtimeId"],
    tool_invocation: ["invocationId"],
    collaboration: ["collaborationId"],
    workspace: ["workspaceId"],
    patch: ["patchId", "workspaceId"],
    artifact: ["artifactId"],
    review: ["reviewId"],
    proposal: ["proposalId"],
    apply: ["transactionId"],
    knowledge: ["knowledgeId"],
  };
  const versionKeys: Readonly<Record<WorkflowStage, readonly string[]>> = {
    intelligence: ["intelligenceVersion", "repositoryRevision"],
    planning: ["planVersion"],
    execution: ["executionVersion"],
    agent_runtime: ["outputVersion", "agentVersion"],
    tool_invocation: ["toolVersion", "invocationVersion"],
    collaboration: ["collaborationVersion", "executionVersion"],
    workspace: ["persistenceVersion", "snapshotVersion"],
    patch: ["patchVersion"],
    artifact: ["artifactVersion"],
    review: ["reviewVersion"],
    proposal: ["proposalVersion"],
    apply: ["transactionVersion"],
    knowledge: ["version"],
  };
  const referenceId = overrides.referenceId ??
    stringValue(output, referenceKeys[stage]);
  const referenceVersion = overrides.referenceVersion ??
    stringValue(output, versionKeys[stage]);
  const status = overrides.status ??
    (stringValue(output, ["status", "lifecycle"]) || "validated");
  if (!referenceId || !referenceVersion) {
    throw new AutonomousWorkflowError(
      "autonomous_workflow_service_contract_invalid",
      `${stage} did not return a durable identity and version.`);
  }
  const defaultMetadata = Object.fromEntries(([
    ["repositoryId", stringValue(output, ["repositoryId"])],
    ["repositoryRevision", stringValue(output, ["repositoryRevision"])],
    ["executionId", stringValue(output, ["executionId"])],
    ["ownerId", stringValue(output, ["ownerId"])],
  ] as Array<[string, string]>).filter(([, item]) => item.length > 0));
  return {
    stage,
    referenceId,
    referenceVersion,
    status,
    outputHash: stableHash(output),
    metadata: overrides.metadata ?? defaultMetadata,
  };
}

function execution(
  stage: WorkflowStage,
  output: unknown,
  resultOutput: unknown = output,
  overrides: Partial<WorkflowStageResult> = {},
): WorkflowStageExecution {
  return {
    result: stageResult(stage, output, overrides),
    output: resultOutput,
  };
}

export class ExistingServicesWorkflowComposition
implements WorkflowServiceComposition {
  constructor(
    private readonly services: WorkflowServiceDependencies =
      runtimeWorkflowServiceDependencies,
  ) {}

  async execute(
    stage: WorkflowStage,
    payload: unknown,
  ): Promise<WorkflowStageExecution> {
    const request = objectPayload(payload, stage);
    switch (stage) {
      case "intelligence": {
        const repositoryId = String(request.repositoryId ?? "");
        const repositoryRevision = String(request.repositoryRevision ?? "");
        const output =
          await this.services.intelligenceService.getPublishedSnapshot(
            repositoryId, repositoryRevision);
        if (!output) {
          throw new AutonomousWorkflowError(
            "autonomous_workflow_intelligence_unpublished",
            "Published repository intelligence is unavailable.");
        }
        return execution(stage, output, output, {
          referenceId: repositoryId,
          referenceVersion: repositoryRevision,
          status: "published",
          metadata: {
            repositoryId,
            repositoryRevision,
          },
        });
      }
      case "planning": {
        const output = await this.services.planningService.createPlan(
          payload as RepositoryPlanningInput);
        return execution(stage, output);
      }
      case "execution": {
        const output = await this.services.executionOrchestrator.create(
          payload as ExecutionCreationInput);
        return execution(stage, output);
      }
      case "agent_runtime": {
        const output = await this.services.agentRuntimeScheduler.create(
          payload as CreateAgentRuntimeInput);
        return execution(stage, output);
      }
      case "tool_invocation": {
        const command = payload as unknown as WorkflowToolCommand;
        const output = await this.services.toolInvocationService.invoke(
          command.request, command.context);
        if (output.invocation.status !== "succeeded") {
          throw new AutonomousWorkflowError(
            "autonomous_workflow_tool_failed",
            "Existing tool invocation did not succeed.");
        }
        return execution(stage, output, output, {
          referenceId: output.invocation.invocationId,
          referenceVersion: output.invocation.toolVersion,
          status: output.invocation.status,
          metadata: {
            repositoryId: output.invocation.repositoryId,
            repositoryRevision: output.invocation.repositoryRevision,
            executionId: output.invocation.executionId,
          },
        });
      }
      case "collaboration": {
        const output = await this.services.collaborationEngine.create(
          payload as CreateCollaborationInput);
        return execution(stage, output);
      }
      case "workspace": {
        const command = payload as unknown as WorkflowWorkspaceCommand;
        let workspace =
          await this.services.workspaceEngine.create(command.create);
        workspace = await this.services.workspaceEngine.prepare(
          workspace.tenantId, workspace.workspaceId, workspace.ownerId);
        workspace = await this.services.workspaceEngine.markReady(
          workspace.tenantId, workspace.workspaceId, workspace.ownerId);
        const claim = await this.services.workspaceEngine.claim(
          workspace.tenantId, workspace.workspaceId, workspace.ownerId);
        workspace =
          await this.services.workspaceEngine.activate(claim);
        return execution(stage, workspace, { workspace, claim });
      }
      case "patch": {
        const input = payload as GeneratePatchInput;
        const patch =
          await this.services.workspaceEngine.generatePatch(input);
        const workspace = await this.services.workspaceEngine.get(
          input.claim.tenantId, patch.workspaceId);
        if (!workspace) {
          throw new AutonomousWorkflowError(
            "autonomous_workflow_workspace_unavailable",
            "Patched workspace is unavailable.");
        }
        return execution(stage, patch, { patch, workspace });
      }
      case "artifact": {
        const output = await this.services.artifactEngine.generate(
          payload as GenerateArtifactInput);
        return execution(stage, output);
      }
      case "review": {
        const command = payload as unknown as WorkflowReviewCommand;
        const pending = await this.services.reviewEngine.create(
          command.create);
        const review = await this.services.reviewEngine.decide({
          ...command.decision,
          reviewId: pending.reviewId,
          reviewVersion: pending.reviewVersion,
        });
        const artifact = await this.services.artifactEngine.review({
          ...command.artifactDecision,
          artifactId: command.create.artifact.artifactId,
          artifactVersion: command.create.artifact.artifactVersion,
        });
        if (review.lifecycle !== "approved" ||
            artifact.lifecycle !== "approved") {
          throw new AutonomousWorkflowError(
            "autonomous_workflow_review_not_approved",
            "Review stage must produce approved review and artifact records.");
        }
        return execution(stage, review, { review, artifact });
      }
      case "proposal": {
        const command = payload as unknown as WorkflowProposalCommand;
        const pending = await this.services.proposalEngine.assemble(
          command.assemble);
        const proposal = await this.services.proposalEngine.decide({
          ...command.decision,
          proposalId: pending.proposalId,
          proposalVersion: pending.proposalVersion,
        });
        if (proposal.lifecycle !== "approved") {
          throw new AutonomousWorkflowError(
            "autonomous_workflow_proposal_not_approved",
            "Proposal stage must produce an approved proposal.");
        }
        return execution(stage, proposal);
      }
      case "apply": {
        const command = payload as unknown as WorkflowApplyCommand;
        const pending = await this.services.applyEngine.prepare(
          command.prepare);
        const transaction = await this.services.applyEngine.confirm({
          ...command.confirmation,
          transactionId: pending.transactionId,
          transactionVersion: pending.transactionVersion,
        });
        if (transaction.lifecycle !== "ready") {
          throw new AutonomousWorkflowError(
            "autonomous_workflow_apply_not_ready",
            "Apply coordinator must produce a ready transaction.");
        }
        return execution(stage, transaction);
      }
      case "knowledge": {
        const output = await this.services.knowledgeEngine.create(
          payload as CreateKnowledgeInput);
        return execution(stage, output);
      }
    }
  }

  async approve(payload: unknown): Promise<void> {
    const command = payload as WorkflowExecutionApprovalCommand;
    if (!command || command.decision !== "approved" || !command.input) {
      throw new AutonomousWorkflowError(
        "autonomous_workflow_approval_invalid",
        "Execution approval command is malformed.");
    }
    await this.services.executionOrchestrator.approve(command.input);
  }

  async cancel(payload?: unknown): Promise<void> {
    if (payload === undefined) return;
    const command = payload as WorkflowExecutionCancellationCommand;
    await this.services.executionOrchestrator.cancel(
      command.ownerId,
      command.repositoryId,
      command.executionId,
      command.idempotencyKey,
    );
  }

  async recoverDependencies(): Promise<WorkflowDependencyRecovery> {
    const [
      intelligence, planning, executionCount, agentRuntime, toolInvocation,
      collaboration, workspace, artifact, review, proposal, apply, knowledge,
    ] = await Promise.all([
      this.services.intelligenceStore.recover(),
      this.services.planningStore.recover(),
      this.services.executionStore.recover(),
      this.services.agentRuntimeStore.recover(undefined, runtimeAgentQuotas),
      this.services.toolInvocationService.recover(),
      this.services.collaborationEngine.recover(),
      this.services.workspaceEngine.recover(),
      this.services.artifactEngine.recover(),
      this.services.reviewEngine.recover(),
      this.services.proposalEngine.recover(),
      this.services.applyEngine.recover(),
      this.services.knowledgeEngine.recover(),
    ]);
    return {
      intelligence,
      planning,
      execution: executionCount,
      agentRuntime,
      toolInvocation,
      collaboration,
      workspace,
      artifact,
      review,
      proposal,
      apply,
      knowledge,
    };
  }
}

export const runtimeWorkflowServiceComposition =
  new ExistingServicesWorkflowComposition();
