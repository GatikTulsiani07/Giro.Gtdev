import { buildRepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import type { RepositoryDashboardSummary } from "./repositoryDashboardSummary.js";
import { executeRepositoryCleanupPlan } from "./repositoryCleanupExecutor.js";
import { buildRepositoryCleanupPlan } from "./repositoryCleanupPlanner.js";
import { buildRepositoryCleanupReport } from "./repositoryCleanupReport.js";
import type { RepositoryCleanupReport } from "./repositoryCleanupReport.js";
import { recordRepositoryLifecycleEvent } from "./repositoryLifecycleEvents.js";
import { flatMapMaybePromise } from "../../lib/maybePromise.js";

export interface RepositoryLifecycleReference {
  owner: string;
  repo: string;
  repoId: string;
}

export interface RepositoryLifecycleInput {
  owner: string;
  repo: string;
}

export interface ConnectRepositoryInput<TIndexResult>
  extends RepositoryLifecycleInput {
  indexRepository: () => Promise<TIndexResult>;
}

export interface ConnectRepositoryResult<TIndexResult> {
  repository: RepositoryLifecycleReference;
  indexResult: TIndexResult;
  summary: RepositoryDashboardSummary;
}

function repositoryReference(
  input: RepositoryLifecycleInput,
): RepositoryLifecycleReference {
  return {
    owner: input.owner,
    repo: input.repo,
    repoId: `${input.owner}/${input.repo}`,
  };
}

export async function connectRepository<TIndexResult>(
  input: ConnectRepositoryInput<TIndexResult>,
): Promise<ConnectRepositoryResult<TIndexResult>> {
  const indexResult = await input.indexRepository();

  return {
    repository: repositoryReference(input),
    indexResult,
    summary: await buildRepositoryDashboardSummary(input.owner, input.repo),
  };
}

export function cleanupRepository(
  input: RepositoryLifecycleInput,
): RepositoryCleanupReport {
  const repository = repositoryReference(input);

  try {
    const plan = buildRepositoryCleanupPlan(input.owner, input.repo);
    recordRepositoryLifecycleEvent({
      repositoryId: repository.repoId,
      type: "repository_cleanup_planned",
      message: "Repository cleanup plan built.",
      metadata: {
        cleanupRequired: plan.cleanupRequired,
        totalResources: plan.totalResources,
      },
    });

    const execution = executeRepositoryCleanupPlan(plan);
    recordRepositoryLifecycleEvent({
      repositoryId: repository.repoId,
      type: "repository_cleanup_executed",
      message: "Repository cleanup plan executed.",
      metadata: {
        totalExecuted: execution.totalExecuted,
        totalSkipped: execution.totalSkipped,
      },
    });

    const report = buildRepositoryCleanupReport(execution);
    recordRepositoryLifecycleEvent({
      repositoryId: repository.repoId,
      type: "repository_cleanup_reported",
      message: "Repository cleanup report built.",
      metadata: {
        success: report.success,
        totalExecuted: report.summary.totalExecuted,
        totalSkipped: report.summary.totalSkipped,
      },
    });

    return report;
  } catch (err) {
    recordRepositoryLifecycleEvent({
      repositoryId: repository.repoId,
      type: "repository_cleanup_failed",
      message: "Repository cleanup failed.",
      metadata: {
        error: err instanceof Error ? err.message : "unknown error",
      },
    });
    throw err;
  }
}

export function getRepositorySummary(
  input: RepositoryLifecycleInput,
  history?: { ownerId: string; repositoryRevision?: string | null; requestId?: string; traceId?: string },
): RepositoryDashboardSummary;
export function getRepositorySummary(
  input: RepositoryLifecycleInput,
  history?: { ownerId: string; repositoryRevision?: string | null; requestId?: string; traceId?: string },
): RepositoryDashboardSummary | Promise<RepositoryDashboardSummary> {
  const built = buildRepositoryDashboardSummary(input.owner, input.repo);
  const record = (summary: RepositoryDashboardSummary) => {
    return flatMapMaybePromise(recordRepositoryLifecycleEvent({
      repositoryId: `${input.owner}/${input.repo}`,
      ownerId: history?.ownerId,
      repositoryRevision: history?.repositoryRevision,
      requestId: history?.requestId,
      traceId: history?.traceId,
      idempotencyKey: history?.requestId ? `dashboard:${history.requestId}` : undefined,
      type: "repository_dashboard_viewed",
      message: "Repository dashboard summary viewed.",
      metadata: {
        files: summary.metrics.files,
        chunks: summary.metrics.chunks,
        symbols: summary.metrics.symbols,
        status: summary.status.health.status,
      },
    }), () => summary);
  };
  return flatMapMaybePromise(built, record);
}
