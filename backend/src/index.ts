// Process entrypoint. Boots the HTTP server using @hono/node-server.

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { env } from "./config/env.js";
import { flushLogs, logger } from "./lib/logger.js";
import { closeSupabaseConnections } from "./lib/supabase.js";
import { createApp } from "./app.js";
import {
  createBackendShutdown,
  installShutdownSignalHandlers,
} from "./runtime/backendShutdown.js";
import {
  forceCloseHttpServer,
  stopHttpServer,
} from "./runtime/httpServerShutdown.js";
import { stopRegisteredIndexingWorkers } from "./runtime/indexingWorkerShutdown.js";
import { runtimeIndexingJobStore } from "./services/indexing/jobs/runtimeIndexingJobStore.js";
import { recoverIndexingJobsOnStartup } from "./services/indexing/jobs/indexingJobStartupRecovery.js";
import { runtimeRepositoryDeletionService } from "./services/repository/repositoryDeletionService.js";
import { rateLimitBackend, runtimeRateLimitStore } from "./services/rateLimit/runtimeRateLimitStore.js";
import { recoverAbandonedRepositoryCheckouts } from "./services/repository/revisionCheckouts.js";
import { repositoryStore } from "./services/repository/store/runtimeRepositoryStore.js";
import { runtimeRepositoryConnectionStore } from "./services/repository/connection/runtimeRepositoryConnectionStore.js";
import { sessionStore } from "./services/sessions/store.js";
import { repositoryHistoryStore } from "./services/repository/history/runtimeRepositoryHistoryStore.js";
import { runtimeEmbeddingIndexStore } from "./services/embeddings/indexStore.js";
import {
  runtimeHybridRetrievalV2Config,
  validateHybridRetrievalV2Config,
} from "./services/retrieval/hybridV2/config.js";
import { runtimeCrossEncoder } from "./services/retrieval/hybridV2/crossEncoder.js";
import { runtimeRepositoryGraphStore } from "./services/repositoryGraph/graphStore.js";
import { runtimeRepositoryIntelligenceStore } from "./services/repositoryIntelligence/store.js";
import { runtimeRepositoryPlanningStore } from "./services/repositoryPlanning/store.js";
import { runtimeRepositoryExecutionStore } from "./services/repositoryExecution/store.js";
import { runtimeAgentRuntimeStore } from "./services/agentRuntime/store.js";
import { runtimeToolInvocationService } from "./services/toolInvocation/service.js";
import { runtimeMultiAgentCollaborationEngine } from "./services/multiAgentCollaboration/service.js";
import { runtimeRepositoryWorkspacePatchEngine } from "./services/repositoryWorkspace/service.js";
import { runtimeRepositorySandboxService } from "./services/repositorySandbox/service.js";
import { runtimeSemanticCodeIntelligenceService } from "./services/semanticCodeIntelligence/service.js";
import { runtimeFeatureIntelligenceService } from "./services/featureIntelligence/service.js";
import { runtimeChangeIntelligenceService } from "./services/changeIntelligence/service.js";
import { runtimeRepositoryArtifactEngine } from "./services/repositoryArtifact/service.js";
import { runtimeRepositoryReviewEngine } from "./services/repositoryReview/service.js";
import { runtimeRepositoryProposalEngine } from "./services/repositoryProposal/service.js";
import { runtimeRepositoryApplyEngine } from "./services/repositoryApply/service.js";
import { runtimeRepositoryKnowledgeEngine } from "./services/repositoryKnowledge/service.js";
import { runtimeAutonomousWorkflowOrchestrator } from "./services/autonomousWorkflow/service.js";
import { runtimeRepositoryQueryEngine } from "./services/repositoryQuery/service.js";
import { runtimeRepositoryInsightEngine } from "./services/repositoryInsight/service.js";
import { runtimeRepositoryEvolutionIntelligenceEngine } from "./services/repositoryEvolution/service.js";
import { runtimeRepositoryTaskPlanner } from "./services/repositoryTaskPlanner/service.js";
import { runtimeRepositorySpecificationEngine } from "./services/repositorySpecification/service.js";
import { runtimeRepositoryExecutionCoordinator } from "./services/repositoryExecutionCoordinator/service.js";
import { runtimeEngineeringPlatformApiService } from "./services/engineeringPlatformApi/service.js";
import { verifyEngineeringPlatformApiContracts } from "./services/engineeringPlatformApi/openapi.js";
import { runtimeAgentQuotas } from "./services/agentRuntime/service.js";
import { runtimeRepositoryApiGateway } from "./services/repositoryApiGateway/service.js";

let server: ServerType;
let startupCompleted = false;
const coordinator = createBackendShutdown({
  logger,
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  stopAcceptingRequests: () => stopHttpServer(server),
  stopIndexingWorkers: stopRegisteredIndexingWorkers,
  closeDatabase: closeSupabaseConnections,
  flushLogs,
  forceStop: () => forceCloseHttpServer(server),
});
const app = createApp({
  isShuttingDown: coordinator.isShuttingDown,
  isStartupComplete: () => startupCompleted,
});

try {
  await runtimeRateLimitStore.verify();
  logger.info("rate_limit_backend_verified", { backend: rateLimitBackend });
} catch {
  logger.error("rate_limit_backend_verification_failed", {
    source: "backend_startup",
    backend: rateLimitBackend,
    reasonCode: "rate_limit_backend_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryConnectionStore.verify();
  const removed = await runtimeRepositoryConnectionStore.cleanupExpired();
  logger.info("repository_connection_idempotency_verified", {
    source: "backend_startup",
    expiredRecordsRemoved: removed,
  });
} catch {
  logger.error("repository_connection_idempotency_verification_failed", {
    source: "backend_startup",
    reasonCode: "idempotency_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await sessionStore.verifyTurnPersistence();
  const removed = await sessionStore.cleanupExpiredTurnIdempotency();
  logger.info("session_persistence_contract_verified", {
    source: "backend_startup",
    expiredTurnRecordsRemoved: removed,
  });
} catch {
  logger.error("session_persistence_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "session_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await repositoryHistoryStore.verifyPersistence();
  const removed = await repositoryHistoryStore.cleanup({
    maxRecordsPerType: env.REPOSITORY_HISTORY_MAX_RECORDS_PER_TYPE,
    maxAgeMs: env.REPOSITORY_HISTORY_MAX_AGE_MS,
  });
  logger.info("repository_history_contract_verified", {
    source: "backend_startup",
    expiredOrExcessRecordsRemoved: removed,
  });
} catch {
  logger.error("repository_history_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_history_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await recoverIndexingJobsOnStartup({
    jobStore: runtimeIndexingJobStore,
    logger,
    leaseDurationMs: env.INDEXING_WORKER_STALE_CLAIM_MS,
    retryDelayMs: env.INDEXING_WORKER_RETRY_BASE_MS,
  });
} catch {
  logger.error("indexing_recovery_failed", {
    source: "backend_startup",
    reasonCode: "durable_recovery_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeEmbeddingIndexStore.verify();
  const cleanedVersionCount = await runtimeEmbeddingIndexStore.recover();
  logger.info("embedding_index_contract_verified", {
    source: "backend_startup",
    cleanedVersionCount,
  });
} catch {
  logger.error("embedding_index_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "embedding_index_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryGraphStore.verify();
  const cleanedVersionCount = await runtimeRepositoryGraphStore.recover();
  logger.info("repository_graph_contract_verified", {
    source: "backend_startup",
    parserVersion: "typescript-compiler-v1",
    cleanedVersionCount,
  });
} catch {
  logger.error("repository_graph_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_graph_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryIntelligenceStore.verify();
  const cleanedVersionCount = await runtimeRepositoryIntelligenceStore.recover();
  logger.info("repository_intelligence_contract_verified", {
    source: "backend_startup",
    analysisVersion: "repository-intelligence-v1",
    cleanedVersionCount,
  });
} catch {
  logger.error("repository_intelligence_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_intelligence_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryPlanningStore.verify();
  const recoveredPlanCount = await runtimeRepositoryPlanningStore.recover();
  logger.info("repository_planning_contract_verified", {
    source: "backend_startup",
    plannerVersion: "repository-planner-v1",
    recoveredPlanCount,
  });
} catch {
  logger.error("repository_planning_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_planning_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryExecutionStore.verify();
  const recoveredLeaseCount = await runtimeRepositoryExecutionStore.recover();
  logger.info("repository_execution_contract_verified", {
    source: "backend_startup",
    orchestratorVersion: "repository-execution-v1",
    guardedExecutionEnabled: env.GUARDED_EXECUTION_ENABLED,
    recoveredLeaseCount,
  });
} catch {
  logger.error("repository_execution_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_execution_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeAgentRuntimeStore.verify();
  const recoveredRuntimeCount = await runtimeAgentRuntimeStore.recover(undefined, runtimeAgentQuotas);
  logger.info("agent_runtime_contract_verified", {
    source: "backend_startup",
    runtimeVersion: "agent-runtime-v1",
    recoveredRuntimeCount,
  });
} catch {
  logger.error("agent_runtime_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "agent_runtime_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeToolInvocationService.verify();
  const recoveredToolInvocationCount = await runtimeToolInvocationService.recover();
  logger.info("tool_invocation_contract_verified", {
    source: "backend_startup",
    frameworkVersion: "tool-invocation-v1",
    recoveredToolInvocationCount,
  });
} catch {
  logger.error("tool_invocation_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "tool_invocation_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeMultiAgentCollaborationEngine.verify();
  const recoveredCollaborationCount = await runtimeMultiAgentCollaborationEngine.recover();
  logger.info("multi_agent_collaboration_contract_verified", {
    source: "backend_startup",
    engineVersion: "multi-agent-collaboration-v1",
    recoveredCollaborationCount,
  });
} catch {
  logger.error("multi_agent_collaboration_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "collaboration_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryWorkspacePatchEngine.verify();
  const recoveredWorkspaceCount = await runtimeRepositoryWorkspacePatchEngine.recover();
  logger.info("repository_workspace_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-workspace-patch-v1",
    recoveredWorkspaceCount,
  });
} catch {
  logger.error("repository_workspace_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_workspace_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositorySandboxService.verify();
  const recoveredSandboxCount = await runtimeRepositorySandboxService.recover();
  logger.info("repository_sandbox_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-sandbox-v1",
    recoveredSandboxCount,
  });
} catch {
  logger.error("repository_sandbox_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_sandbox_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeSemanticCodeIntelligenceService.verify();
  const recoveredSemanticGraphCount =
    await runtimeSemanticCodeIntelligenceService.recover();
  logger.info("semantic_code_intelligence_contract_verified", {
    source: "backend_startup",
    engineVersion: "semantic-code-intelligence-v1",
    recoveredSemanticGraphCount,
  });
} catch {
  logger.error("semantic_code_intelligence_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "semantic_code_graph_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeFeatureIntelligenceService.verify();
  const recoveredFeatureGraphCount =
    await runtimeFeatureIntelligenceService.recover();
  logger.info("feature_intelligence_contract_verified", {
    source: "backend_startup",
    engineVersion: "feature-intelligence-v1",
    recoveredFeatureGraphCount,
  });
} catch {
  logger.error("feature_intelligence_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "feature_intelligence_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeChangeIntelligenceService.verify();
  const recoveredChangeAnalysisCount =
    await runtimeChangeIntelligenceService.recover();
  logger.info("change_intelligence_contract_verified", {
    source: "backend_startup",
    engineVersion: "change-intelligence-v1",
    recoveredChangeAnalysisCount,
  });
} catch {
  logger.error("change_intelligence_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "change_intelligence_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryArtifactEngine.verify();
  const recoveredArtifactCount = await runtimeRepositoryArtifactEngine.recover();
  logger.info("repository_artifact_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-artifact-engine-v1",
    recoveredArtifactCount,
  });
} catch {
  logger.error("repository_artifact_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_artifact_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryReviewEngine.verify();
  const recoveredReviewCount = await runtimeRepositoryReviewEngine.recover();
  logger.info("repository_review_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-review-engine-v1",
    recoveredReviewCount,
  });
} catch {
  logger.error("repository_review_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_review_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryProposalEngine.verify();
  const recoveredProposalCount = await runtimeRepositoryProposalEngine.recover();
  logger.info("repository_proposal_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-proposal-engine-v1",
    recoveredProposalCount,
  });
} catch {
  logger.error("repository_proposal_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_proposal_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryApplyEngine.verify();
  const recoveredApplyCount = await runtimeRepositoryApplyEngine.recover();
  logger.info("repository_apply_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-apply-engine-v1",
    recoveredApplyCount,
  });
} catch {
  logger.error("repository_apply_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_apply_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryKnowledgeEngine.verify();
  const recoveredKnowledgeCount =
    await runtimeRepositoryKnowledgeEngine.recover();
  logger.info("repository_knowledge_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-knowledge-engine-v1",
    recoveredKnowledgeCount,
  });
} catch {
  logger.error("repository_knowledge_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_knowledge_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeAutonomousWorkflowOrchestrator.verify();
  const workflowRecovery =
    await runtimeAutonomousWorkflowOrchestrator.recover();
  logger.info("autonomous_workflow_contract_verified", {
    source: "backend_startup",
    engineVersion: "autonomous-workflow-orchestrator-v1",
    workflowRecovery,
  });
} catch {
  logger.error("autonomous_workflow_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "autonomous_workflow_database_objects_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryQueryEngine.verify();
  const recoveredRepositoryQueryCount =
    await runtimeRepositoryQueryEngine.recover();
  logger.info("repository_query_engine_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-query-engine-v1",
    recoveredRepositoryQueryCount,
  });
} catch {
  logger.error("repository_query_engine_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_query_or_intelligence_engines_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryInsightEngine.verify();
  const recoveredRepositoryInsightCount =
    await runtimeRepositoryInsightEngine.recover();
  logger.info("repository_insight_engine_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-insight-engine-v1",
    recoveredRepositoryInsightCount,
  });
} catch {
  logger.error("repository_insight_engine_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_insight_or_source_engines_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryEvolutionIntelligenceEngine.verify();
  const recoveredRepositoryEvolutionCount =
    await runtimeRepositoryEvolutionIntelligenceEngine.recover();
  logger.info("repository_evolution_engine_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-evolution-intelligence-v1",
    recoveredRepositoryEvolutionCount,
  });
} catch {
  logger.error("repository_evolution_engine_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_evolution_or_source_engines_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryTaskPlanner.verify();
  const recoveredRepositoryTaskPlanCount =
    await runtimeRepositoryTaskPlanner.recover();
  logger.info("repository_task_planner_contract_verified", {
    source: "backend_startup",
    plannerVersion: "repository-task-planner-v1",
    recoveredRepositoryTaskPlanCount,
  });
} catch {
  logger.error("repository_task_planner_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_task_planner_or_intelligence_engines_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositorySpecificationEngine.verify();
  const recoveredRepositorySpecificationCount =
    await runtimeRepositorySpecificationEngine.recover();
  logger.info("repository_specification_engine_contract_verified", {
    source: "backend_startup",
    engineVersion: "repository-specification-engine-v1",
    recoveredRepositorySpecificationCount,
  });
} catch {
  logger.error("repository_specification_engine_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_specification_or_task_planner_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryExecutionCoordinator.verify();
  const recoveredRepositoryExecutionCoordinationCount =
    await runtimeRepositoryExecutionCoordinator.recover();
  logger.info("repository_execution_coordinator_contract_verified", {
    source: "backend_startup",
    coordinatorVersion: "repository-execution-coordinator-v1",
    recoveredRepositoryExecutionCoordinationCount,
  });
} catch {
  logger.error("repository_execution_coordinator_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_execution_coordinator_dependencies_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  verifyEngineeringPlatformApiContracts();
  await runtimeEngineeringPlatformApiService.verify();
  logger.info("engineering_platform_api_contract_verified", {
    source: "backend_startup",
    apiVersion: "v1",
  });
} catch {
  logger.error("engineering_platform_api_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "engineering_platform_api_dependencies_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryApiGateway.verify();
  const recoveredRepositoryGatewayCacheCount =
    await runtimeRepositoryApiGateway.recover();
  logger.info("repository_api_gateway_contract_verified", {
    source: "backend_startup",
    gatewayVersion: "repository-api-gateway-v1",
    recoveredRepositoryGatewayCacheCount,
  });
} catch {
  logger.error("repository_api_gateway_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "repository_api_gateway_contract_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  validateHybridRetrievalV2Config(runtimeHybridRetrievalV2Config);
  await runtimeCrossEncoder.verify();
  logger.info("hybrid_retrieval_v2_contract_verified", {
    source: "backend_startup",
    rerankerProvider: runtimeCrossEncoder.name,
    maximumTokenBudget: runtimeHybridRetrievalV2Config.maxTokens,
  });
} catch {
  logger.error("hybrid_retrieval_v2_contract_verification_failed", {
    source: "backend_startup",
    reasonCode: "retrieval_configuration_or_reranker_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  await runtimeRepositoryDeletionService.recoverPendingFilesystemCleanup();
} catch {
  logger.error("repository_deletion_recovery_failed", {
    source: "backend_startup",
    reasonCode: "durable_cleanup_recovery_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

try {
  for (const repository of await repositoryStore.listRepositories()) {
    await recoverAbandonedRepositoryCheckouts(
      repository.repositoryId,
      repositoryStore,
      runtimeIndexingJobStore,
    );
  }
} catch {
  logger.error("repository_quota_cleanup_recovery_failed", {
    source: "backend_startup",
    reasonCode: "abandoned_checkout_cleanup_unavailable",
  });
  await flushLogs();
  process.exit(1);
}

server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    startupCompleted = true;
    logger.info("server_started", {
      port: info.port,
      env: env.NODE_ENV,
    });
  },
);

installShutdownSignalHandlers({
  coordinator,
  subscribe: (signal, handler) => {
    process.on(signal, handler);
    return () => process.off(signal, handler);
  },
  setExitCode: (code) => {
    const existingFailure = process.exitCode !== undefined && process.exitCode !== 0;
    process.exitCode = existingFailure ? 1 : code;
  },
  forceExit: (code) => process.exit(code),
});
