import type { IndexingJob, SupervisedIndexingJobStore } from "../jobs/indexingJobStore.js";
import type {
  IndexingJobExecutionReport,
  IndexingJobWorkerLogger,
  ProcessNextIndexingJobInput,
} from "../jobs/indexingJobWorker.js";
import type { IndexingWorkerLoopState, IndexingWorkerStateStore } from "./indexingWorkerStateStore.js";
import type { MetricsRegistry } from "../../../observability/metrics.js";
import { parseTraceparent } from "../../../observability/tracing.js";
import { INDEXING_JOB_LEASE_CONFLICT, indexingJobClaim } from "../jobs/indexingJobStore.js";

export interface ContinuousIndexingWorkerConfig {
  workerId: string;
  pollIntervalMs: number;
  idleBackoffMs: number;
  maxPollIntervalMs: number;
  staleClaimMs: number;
  heartbeatMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  shutdownTimeoutMs: number;
  maxConsecutiveDatabaseFailures: number;
  stallTimeoutMs: number;
}

export type ExecuteNextIndexingJob = (
  input: Pick<ProcessNextIndexingJobInput, "signal" | "observer">,
) => Promise<IndexingJobExecutionReport>;

export interface ContinuousIndexingWorkerOptions {
  config: ContinuousIndexingWorkerConfig;
  jobStore: SupervisedIndexingJobStore;
  stateStore: IndexingWorkerStateStore;
  executeNext: ExecuteNextIndexingJob;
  logger: IndexingJobWorkerLogger;
  metrics?: MetricsRegistry;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onShutdownTimeout?: () => void;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function retryDelayMs(
  attempt: number,
  baseMs: number,
  maximumMs: number,
): number {
  return Math.min(maximumMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function traceFields(job: IndexingJob | null | undefined): Record<string, string> {
  const trace = parseTraceparent(job?.createdByTraceparent);
  return trace ? { traceId: trace.traceId } : {};
}

export class ContinuousIndexingWorker {
  private readonly config: ContinuousIndexingWorkerConfig;
  private readonly jobStore: SupervisedIndexingJobStore;
  private readonly stateStore: IndexingWorkerStateStore;
  private readonly executeNext: ExecuteNextIndexingJob;
  private readonly logger: IndexingJobWorkerLogger;
  private readonly metrics?: MetricsRegistry;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly onShutdownTimeout: () => void;
  private readonly pollController = new AbortController();
  private activeController: AbortController | null = null;
  private activeJob: IndexingJob | null = null;
  private activeHeartbeatFailed = false;
  private stopping = false;
  private shutdownTimedOut = false;
  private pollDelayMs: number;
  private lastRecoveryAt = 0;
  private lastLoopAt = 0;
  private consecutiveDatabaseFailures = 0;
  private functionalReady = false;
  private loopState: IndexingWorkerLoopState = "starting";

  constructor(options: ContinuousIndexingWorkerOptions) {
    this.config = options.config;
    this.jobStore = options.jobStore;
    this.stateStore = options.stateStore;
    this.executeNext = options.executeNext;
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.onShutdownTimeout = options.onShutdownTimeout ?? (() => undefined);
    this.pollDelayMs = this.config.pollIntervalMs;
  }

  async run(): Promise<0 | 1> {
    const startedAtMs = this.now();
    this.logger.info("indexing_worker_started", this.safeFields());
    this.observeLoop("starting");
    await this.recordHealth({ state: "running", loopObserved: true });
    await this.recoverStaleJobs();

    try {
      while (!this.stopping) {
        const report = await this.pollOnce();
        if (this.stopping) break;
        this.pollDelayMs = report?.processed
          ? this.config.pollIntervalMs
          : Math.min(
              this.config.maxPollIntervalMs,
              this.pollDelayMs + this.config.idleBackoffMs,
            );
        await this.sleep(this.pollDelayMs, this.pollController.signal);
      }
      return this.shutdownTimedOut ? 1 : 0;
    } finally {
      this.functionalReady = false;
      this.loopState = "stopped";
      await this.recordHealth({ state: "stopped", activeJobId: null, loopObserved: true });
      this.logger.info("indexing_worker_finished", {
        workerId: this.config.workerId,
        timedOut: this.shutdownTimedOut,
        durationMs: Math.max(0, this.now() - startedAtMs),
      });
    }
  }

  async pollOnce(): Promise<IndexingJobExecutionReport | null> {
    if (this.stopping) return null;
    this.observeLoop("polling");
    await this.recordHealth({ state: "running", loopObserved: true });
    const now = this.now();
    if (now - this.lastRecoveryAt >= this.config.staleClaimMs) {
      await this.recoverStaleJobs();
    }
    const activeController = new AbortController();
    this.activeController = activeController;
    this.activeHeartbeatFailed = false;
    const heartbeat = { stop: null as (() => void) | null };
    try {
      const report = await this.executeNext({
        signal: activeController.signal,
        observer: {
          onClaimed: async (job) => {
            this.activeJob = job;
            this.loopState = "processing";
            await this.recordHealth({ state: "running", activeJobId: job.jobId, loopObserved: true });
            heartbeat.stop = this.startHeartbeat(job);
          },
        },
      });
      if (!this.activeHeartbeatFailed) {
        this.noteDatabaseSuccess("poll");
        this.noteDatabaseSuccess("claim");
      }
      this.loopState = report.processed ? "processing" : "idle";
      await this.recordHealth({
        state: this.stopping ? "stopping" : "running",
        activeJobId: this.activeJob?.jobId ?? null,
        loopObserved: true,
        pollSucceeded: true,
        claimSucceeded: true,
      });

      if (report.status === "succeeded" && report.jobId) {
        await this.recordHealth({
          state: this.stopping ? "stopping" : "running",
          activeJobId: null,
          lastCompletedJobId: report.jobId,
        });
      } else if (report.status === "failed" && report.jobId && report.failure) {
        const claimed = this.activeJob;
        if (report.failure.retryable && claimed && claimed.attempt < claimed.maxAttempts) {
          const delay = retryDelayMs(
            claimed.attempt,
            this.config.retryBaseMs,
            this.config.retryMaxMs,
          );
          const retried = await this.jobStore.scheduleRetry(
            report.jobId,
            indexingJobClaim(claimed),
            report.failure,
            delay,
          );
          if (retried) {
            this.logger.info("indexing_job_retry", {
              workerId: this.config.workerId,
              jobId: report.jobId,
              repositoryId: report.repositoryId,
              attempt: retried.attempt,
              retryDelayMs: delay,
              ...traceFields(retried),
            });
          }
        } else {
          this.logger.error("indexing_job_permanent_failure", {
            workerId: this.config.workerId,
            jobId: report.jobId,
            repositoryId: report.repositoryId,
            attempt: claimed?.attempt,
            failureCode: report.failure.code,
            ...traceFields(claimed),
          });
        }
        await this.recordHealth({
          state: this.stopping ? "stopping" : "running",
          activeJobId: null,
          lastErrorCode: report.failure.code,
          lastErrorMessage: report.failure.message,
        });
        if (report.failure.code === "internal_error") {
          this.noteDatabaseFailure(true);
          await this.recordHealth({
            state: this.stopping ? "stopping" : "running",
            activeJobId: null,
            lastErrorCode: "publication_dependency_failed",
            lastErrorMessage: "An indexing publication dependency failed.",
          });
        }
      }
      return report;
    } catch {
      this.noteDatabaseFailure();
      this.logger.error("indexing_worker_poll_failed", { workerId: this.config.workerId });
      await this.recordHealth({
        state: this.stopping ? "stopping" : "running",
        activeJobId: null,
        lastErrorCode: "poll_failed",
        lastErrorMessage: "Indexing worker poll failed.",
      });
      return null;
    } finally {
      heartbeat.stop?.();
      this.activeJob = null;
      this.activeController = null;
    }
  }

  requestShutdown(signal: "SIGINT" | "SIGTERM"): void {
    if (this.stopping) return;
    this.stopping = true;
    this.pollController.abort();
    this.logger.info("indexing_worker_shutdown_requested", {
      workerId: this.config.workerId,
      signal,
      activeJobId: this.activeJob?.jobId ?? null,
    });
    void this.recordHealth({ state: "stopping", activeJobId: this.activeJob?.jobId ?? null });
    if (this.activeController) {
      const controller = this.activeController;
      setTimeout(() => {
        if (this.activeController === controller) {
          this.shutdownTimedOut = true;
          this.logger.error("indexing_worker_shutdown_timeout", {
            workerId: this.config.workerId,
            jobId: this.activeJob?.jobId ?? null,
          });
          controller.abort(new Error("Indexing worker shutdown timeout exceeded."));
          this.onShutdownTimeout();
        }
      }, this.config.shutdownTimeoutMs).unref();
    }
  }

  private startHeartbeat(job: IndexingJob): () => void {
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        await defaultSleep(this.config.heartbeatMs, controller.signal);
        if (controller.signal.aborted) break;
        try {
          const renewed = await this.jobStore.heartbeatJob(
            job.jobId,
            indexingJobClaim(job),
            this.config.staleClaimMs,
          );
          if (!renewed) {
            this.activeHeartbeatFailed = true;
            this.noteDatabaseFailure(true);
            this.logger.error("indexing_job_lease_lost", {
              workerId: this.config.workerId,
              jobId: job.jobId,
              repositoryId: job.repositoryId,
              attempt: job.attempt,
            });
            this.activeController?.abort(new Error("Indexing job lease was lost."));
            await this.recordHealth({
              state: this.stopping ? "stopping" : "running",
              activeJobId: job.jobId,
              lastErrorCode: "lease_renewal_failed",
              lastErrorMessage: "Indexing job lease renewal failed.",
            });
            break;
          }
          this.noteDatabaseSuccess();
          this.observeLoop("processing");
          await this.recordHealth({
            state: this.stopping ? "stopping" : "running",
            activeJobId: job.jobId,
            leaseHeartbeatSucceeded: true,
            loopObserved: true,
          });
        } catch (error) {
          if (
            error && typeof error === "object" &&
            (error as { code?: unknown }).code === INDEXING_JOB_LEASE_CONFLICT
          ) {
            this.activeHeartbeatFailed = true;
            this.noteDatabaseFailure(true);
            this.logger.error("indexing_job_lease_lost", {
              workerId: this.config.workerId,
              jobId: job.jobId,
              repositoryId: job.repositoryId,
              attempt: job.attempt,
            });
            this.activeController?.abort(new Error("Indexing job lease was lost."));
            await this.recordHealth({
              state: this.stopping ? "stopping" : "running",
              activeJobId: job.jobId,
              lastErrorCode: "lease_fence_failed",
              lastErrorMessage: "Indexing job lease authority was lost.",
            });
            break;
          }
          this.activeHeartbeatFailed = true;
          this.noteDatabaseFailure(true);
          this.logger.error("indexing_job_heartbeat_failed", {
            workerId: this.config.workerId,
            jobId: job.jobId,
            repositoryId: job.repositoryId,
            attempt: job.attempt,
          });
          await this.recordHealth({
            state: this.stopping ? "stopping" : "running",
            activeJobId: job.jobId,
            lastErrorCode: "lease_heartbeat_failed",
            lastErrorMessage: "Indexing job heartbeat failed.",
          });
          this.activeController?.abort(new Error("Indexing job heartbeat failed."));
          break;
        }
      }
    })();
    return () => controller.abort();
  }

  private async recoverStaleJobs(): Promise<void> {
    this.lastRecoveryAt = this.now();
    this.loopState = "recovering";
    const startedAt = this.now();
    this.logger.info("indexing_recovery_started", {
      workerId: this.config.workerId,
      leaseExpiresBefore: new Date(this.now()).toISOString(),
    });
    try {
      const jobs = await this.jobStore.recoverStaleJobs({
        staleBefore: new Date(this.now() - this.config.staleClaimMs).toISOString(),
        leaseExpiresBefore: new Date(this.now()).toISOString(),
        retryDelayMs: this.config.retryBaseMs,
      });
      this.noteDatabaseSuccess();
      await this.recordHealth({
        state: this.stopping ? "stopping" : "running",
        recoverySucceeded: true,
        loopObserved: true,
      });
      for (const job of jobs) {
        this.logger.info("indexing_abandoned_lease_recovered", {
          workerId: this.config.workerId,
          jobId: job.jobId,
          repositoryId: job.repositoryId,
          attempt: job.attempt,
          status: job.status,
          ...traceFields(job),
        });
        if (job.status === "queued") {
          this.logger.info("indexing_job_retry", {
            workerId: this.config.workerId,
            jobId: job.jobId,
            repositoryId: job.repositoryId,
            attempt: job.attempt,
            retryDelayMs: this.config.retryBaseMs,
            reason: "abandoned_lease",
            ...traceFields(job),
          });
        } else {
          this.logger.error("indexing_job_permanent_failure", {
            workerId: this.config.workerId,
            jobId: job.jobId,
            repositoryId: job.repositoryId,
            attempt: job.attempt,
            failureCode: job.failure?.code ?? "abandoned_lease",
            ...traceFields(job),
          });
        }
      }
      this.logger.info("indexing_recovery_completed", {
        workerId: this.config.workerId,
        recoveredJobs: jobs.length,
        durationMs: Math.max(0, this.now() - startedAt),
      });
    } catch {
      this.noteDatabaseFailure();
      this.logger.error("indexing_stale_recovery_failed", { workerId: this.config.workerId });
      await this.recordHealth({
        state: this.stopping ? "stopping" : "running",
        lastErrorCode: "recovery_failed",
        lastErrorMessage: "Indexing stale job recovery failed.",
      });
    }
  }

  private async recordHealth(update: Omit<Parameters<IndexingWorkerStateStore["record"]>[0], "workerId">): Promise<void> {
    try {
      await this.stateStore.record({
        workerId: this.config.workerId,
        loopState: this.loopState,
        functionalReady: this.isReady(),
        consecutiveDatabaseFailures: this.consecutiveDatabaseFailures,
        ...update,
      });
    } catch {
      this.noteDatabaseFailure(true);
      this.logger.error("indexing_worker_health_persist_failed", { workerId: this.config.workerId });
    }
  }

  isReady(): boolean {
    const stalled = this.lastLoopAt > 0 && this.now() - this.lastLoopAt > this.config.stallTimeoutMs;
    this.metrics?.setWorkerStalled(stalled);
    return this.functionalReady && !stalled &&
      this.consecutiveDatabaseFailures < this.config.maxConsecutiveDatabaseFailures &&
      !this.stopping;
  }

  private observeLoop(state: IndexingWorkerLoopState): void {
    this.loopState = state;
    this.lastLoopAt = this.now();
    this.metrics?.setWorkerStalled(false);
  }

  private noteDatabaseSuccess(kind?: "poll" | "claim"): void {
    this.consecutiveDatabaseFailures = 0;
    this.functionalReady = true;
    if (kind) this.metrics?.recordWorkerDatabaseSuccess(kind, this.now());
  }

  private noteDatabaseFailure(forceUnready = false): void {
    this.consecutiveDatabaseFailures += 1;
    if (
      forceUnready ||
      this.consecutiveDatabaseFailures >= this.config.maxConsecutiveDatabaseFailures
    ) this.functionalReady = false;
    this.metrics?.recordWorkerDatabaseFailure(this.consecutiveDatabaseFailures);
  }

  private safeFields(): Record<string, unknown> {
    return {
      workerId: this.config.workerId,
      pollIntervalMs: this.config.pollIntervalMs,
      maxPollIntervalMs: this.config.maxPollIntervalMs,
      staleClaimMs: this.config.staleClaimMs,
      heartbeatMs: this.config.heartbeatMs,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      maxConsecutiveDatabaseFailures: this.config.maxConsecutiveDatabaseFailures,
      stallTimeoutMs: this.config.stallTimeoutMs,
    };
  }
}
