// Shallow-clones a GitHub repository into local storage.

import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { env } from "../../config/env.js";
import { createDeadline, type Deadline } from "../../runtime/deadline.js";
import { retry, isTransientTransportError, type RetryRuntimeOptions } from "../../runtime/retry.js";
import { classifyCloneFailure } from "./cloneFailureClassifier.js";
import { createRetryObservability, type RetryLogger, type RetryMetrics } from "../../observability/retryObservability.js";
import { logger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import type { CircuitBreaker } from "../../runtime/circuitBreaker.js";
import { runtimeDependencyCircuitBreakers } from "../../runtime/dependencyCircuitBreakers.js";

const STORAGE_ROOT = path.join(process.cwd(), ".storage", "repos");
export type CloneExecutor = (repoUrl: string, clonePath: string, timeoutMs: number) => Promise<void>;

const defaultCloneExecutor: CloneExecutor = async (repoUrl, clonePath, timeoutMs) => {
  await simpleGit({ timeout: { block: timeoutMs } }).clone(repoUrl, clonePath, ["--depth", "1"]);
};

export function repoClonePath(owner: string, repo: string): string {
  return path.join(STORAGE_ROOT, `${owner}--${repo}`);
}

export function isTransientCloneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (classifyCloneFailure(message) !== "unknown_clone_failure" &&
      classifyCloneFailure(message) !== "clone_timeout") return false;
  const normalized = message.toLowerCase();
  return classifyCloneFailure(message) === "clone_timeout" ||
    isTransientTransportError(error) ||
    ["could not resolve host", "connection reset", "early eof", "rpc failed", "remote end hung up", "tls connection"].some(
      (fragment) => normalized.includes(fragment),
    );
}

export async function cloneRepo(
  owner: string,
  repo: string,
  options: {
    deadline?: Deadline;
    executeClone?: CloneExecutor;
    requestId?: string;
    jobId?: string;
    logger?: RetryLogger;
    metrics?: RetryMetrics;
    retryRuntime?: RetryRuntimeOptions;
    circuitBreaker?: CircuitBreaker;
  } = {},
): Promise<{ clonePath: string; alreadyExisted: boolean }> {
  const clonePath = repoClonePath(owner, repo);
  const deadline = options.deadline ?? createDeadline(env.REPOSITORY_CLONE_TIMEOUT_MS);
  const ownsDeadline = options.deadline === undefined;
  try {
    return await (options.circuitBreaker ?? runtimeDependencyCircuitBreakers.clone).execute(
      async () => {
        await mkdir(STORAGE_ROOT, { recursive: true });
        if (existsSync(clonePath)) {
          const entries = await readdir(clonePath);
          if (entries.length > 0) return { clonePath, alreadyExisted: true };
        }
        const repoUrl = `https://github.com/${owner}/${repo}.git`;
        try {
          deadline.throwIfExpired();
          const observability = createRetryObservability({
            category: "clone",
            operation: "repository_clone",
            logger: options.logger ?? logger,
            metrics: options.metrics ?? runtimeMetrics,
            fields: {
              requestId: options.requestId,
              jobId: options.jobId,
              repositoryId: `${owner}/${repo}`,
            },
          });
          await retry(
            async (attempt) => {
              if (attempt > 1) await rm(clonePath, { recursive: true, force: true });
              const attemptsRemaining = env.CLONE_MAX_RETRIES + 2 - attempt;
              const attemptTimeoutMs = Math.max(1, Math.floor(deadline.remainingMs() / attemptsRemaining));
              await (options.executeClone ?? defaultCloneExecutor)(repoUrl, clonePath, attemptTimeoutMs);
            },
            {
              maxAttempts: env.CLONE_MAX_RETRIES + 1,
              baseDelayMs: env.CLONE_RETRY_BASE_MS,
              maxDelayMs: 5_000,
              deadline,
              isRetryable: isTransientCloneError,
              ...observability,
              ...options.retryRuntime,
            },
          );
          deadline.throwIfExpired();
          return { clonePath, alreadyExisted: false };
        } catch (err) {
          await rm(clonePath, { recursive: true, force: true });
          const message = err instanceof Error ? err.message : "unknown error";
          throw new Error(`Clone failed: ${message}`);
        }
      },
      {
        requestId: options.requestId,
        jobId: options.jobId,
        repositoryId: `${owner}/${repo}`,
        signal: deadline.signal,
      },
    );
  } finally {
    if (ownsDeadline) deadline.dispose();
  }
}
