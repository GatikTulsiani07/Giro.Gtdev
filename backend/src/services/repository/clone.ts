// Shallow-clones a GitHub repository into local storage.

import { readdir, realpath } from "node:fs/promises";
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
import {
  ensureRepositoryStorageRoot,
  ensureRepositoryRevisionRoot,
  removeRepositoryCheckout,
  repositoryCheckoutPath,
  resolveRepositoryPath,
  validateRepositoryCheckout,
  type TrustedRepositoryCheckoutPath,
} from "../security/repositoryPaths.js";
import { normalizeRepositoryParts } from "../security/repositoryIdentity.js";
import { repositoryStorageRoot } from "../../config/repositoryStorage.js";
import { scanRepositoryQuota } from "./quotas/repositoryQuotaScanner.js";
import { isRepositoryQuotaError, runtimeRepositoryQuotas, type RepositoryQuotas } from "./quotas/repositoryQuota.js";

export type CloneExecutor = (repoUrl: string, clonePath: string, timeoutMs: number) => Promise<void>;
export type RevisionResolver = (repoUrl: string, branch: string | null, timeoutMs: number) => Promise<string>;
export interface SnapshotCheckoutResult {
  commitSha: string;
  branch: string | null;
}
export type SnapshotCheckoutExecutor = (input: {
  clonePath: string;
  branch: string | null;
  reusedClone: boolean;
  timeoutMs: number;
}) => Promise<SnapshotCheckoutResult>;

const defaultCloneExecutor: CloneExecutor = async (repoUrl, clonePath, timeoutMs) => {
  await simpleGit({ timeout: { block: timeoutMs } }).clone(repoUrl, clonePath, ["--depth", "1"]);
};

const defaultRevisionResolver: RevisionResolver = async (repoUrl, branch, timeoutMs) => {
  const output = await simpleGit({ timeout: { block: timeoutMs } }).listRemote([
    repoUrl,
    branch ? `refs/heads/${branch}` : "HEAD",
  ]);
  const revision = output.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Repository revision could not be resolved.");
  return revision;
};

const defaultSnapshotCheckoutExecutor: SnapshotCheckoutExecutor = async (input) => {
  const checkout = await validateGitWorkingDirectory(input.clonePath);
  const git = simpleGit(checkout, { timeout: { block: input.timeoutMs } });
  let resolvedBranch = input.branch;
  if (!resolvedBranch) {
    try {
      const localBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
      if (localBranch && localBranch !== "HEAD") resolvedBranch = localBranch;
    } catch {
      // A reused detached checkout resolves its branch from origin below.
    }
  }
  if (!resolvedBranch) {
    try {
      const remoteHead = (await git.raw([
        "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD",
      ])).trim();
      resolvedBranch = remoteHead.replace(/^origin\//, "") || null;
    } catch {
      // Some remotes do not advertise a symbolic default branch.
    }
  }
  if (input.reusedClone || resolvedBranch) {
    const ref = resolvedBranch ?? "HEAD";
    await git.fetch(["origin", ref, "--depth", "1", "--force"]);
  }
  const target = input.reusedClone || resolvedBranch ? "FETCH_HEAD" : "HEAD";
  const revision = (await git.revparse([target])).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Repository revision could not be resolved.");
  }
  await git.checkout(["--detach", revision]);
  await git.reset(["--hard", revision]);
  await git.clean("f", ["-d"]);
  const checkedOutRevision = (await git.revparse(["HEAD"])).trim().toLowerCase();
  if (checkedOutRevision !== revision) {
    throw new Error("Repository checkout does not match the resolved revision.");
  }
  return { commitSha: revision, branch: resolvedBranch };
};

export function repoClonePath(owner: string, repo: string, revision?: string): TrustedRepositoryCheckoutPath {
  return repositoryCheckoutPath(normalizeRepositoryParts(owner, repo).repositoryId, revision);
}

export async function validateGitWorkingDirectory(
  checkoutPath: string,
  timeoutMs = env.REPOSITORY_CLONE_TIMEOUT_MS,
  storageRoot = repositoryStorageRoot,
): Promise<TrustedRepositoryCheckoutPath> {
  const checkoutParent = path.dirname(checkoutPath);
  const repositoryDirectory = path.dirname(checkoutParent);
  const isLegacy = checkoutParent === storageRoot && /^repo-[0-9a-f]{64}$/.test(path.basename(checkoutPath));
  const isRevision = repositoryDirectory === storageRoot &&
    /^repo-[0-9a-f]{64}$/.test(path.basename(checkoutParent)) &&
    /^[0-9a-f]{40}$/.test(path.basename(checkoutPath));
  if (!isLegacy && !isRevision) {
    throw new Error("Git working directory is not an authorized checkout.");
  }
  // Recover the trusted type only after runtime checkout and symlink validation.
  const checkout = checkoutPath as TrustedRepositoryCheckoutPath;
  await resolveRepositoryPath(checkout, ".git", { mustExist: true });
  const git = simpleGit(checkout, { timeout: { block: timeoutMs } });
  const topLevel = await realpath((await git.revparse(["--show-toplevel"])).trim());
  const canonicalCheckout = await realpath(checkout);
  if (topLevel !== canonicalCheckout) {
    throw new Error("Git top-level does not match the authorized checkout.");
  }
  const rawGitDirectory = (await git.revparse(["--git-dir"])).trim();
  const gitDirectory = await realpath(path.isAbsolute(rawGitDirectory)
    ? rawGitDirectory
    : path.resolve(checkout, rawGitDirectory));
  const relativeGitDirectory = path.relative(canonicalCheckout, gitDirectory);
  if (relativeGitDirectory === ".." || relativeGitDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeGitDirectory)) {
    throw new Error("Git directory escapes the authorized checkout.");
  }
  for (const key of ["core.worktree", "core.fsmonitor", "core.sshCommand"] as const) {
    try {
      const configured = (await git.raw(["config", "--local", "--get", key])).trim();
      if (configured) throw new Error("Repository Git configuration is unsafe.");
    } catch (error) {
      if (error instanceof Error && error.message === "Repository Git configuration is unsafe.") throw error;
    }
  }
  try {
    const unsafeConfig = (await git.raw([
      "config", "--local", "--get-regexp",
      "^(filter\\..*\\.(clean|smudge|process)|submodule\\..*\\.update|core\\.hooksPath)$",
    ])).trim();
    if (unsafeConfig) throw new Error("Repository Git configuration is unsafe.");
  } catch (error) {
    if (error instanceof Error && error.message === "Repository Git configuration is unsafe.") throw error;
  }
  return checkout;
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
    branch?: string | null;
    checkoutSnapshot?: SnapshotCheckoutExecutor;
    resolveRevision?: RevisionResolver;
    quotas?: RepositoryQuotas;
  } = {},
): Promise<{
  clonePath: TrustedRepositoryCheckoutPath;
  alreadyExisted: boolean;
  commitSha: string;
  branch: string | null;
}> {
  const deadline = options.deadline ?? createDeadline(env.REPOSITORY_CLONE_TIMEOUT_MS);
  const ownsDeadline = options.deadline === undefined;
  try {
    return await (options.circuitBreaker ?? runtimeDependencyCircuitBreakers.clone).execute(
      async () => {
        await ensureRepositoryStorageRoot();
        const repoUrl = `https://github.com/${owner}/${repo}.git`;
        // Test adapters predating revision directories can still exercise retry behavior;
        // production always resolves the immutable destination before cloning.
        const legacyAdapter = Boolean(options.executeClone && !options.resolveRevision);
        if (legacyAdapter && existsSync(repoClonePath(owner, repo))) {
          await removeRepositoryCheckout(`${owner}/${repo}`);
        }
        const resolvedRevision = legacyAdapter ? null : await (options.resolveRevision ?? defaultRevisionResolver)(
          repoUrl,
          options.branch ?? null,
          Math.max(1, Math.floor(deadline.remainingMs())),
        );
        await ensureRepositoryRevisionRoot(`${owner}/${repo}`);
        const clonePath = repoClonePath(owner, repo, resolvedRevision ?? undefined);
        let alreadyExisted = false;
        if (existsSync(clonePath)) {
          try {
            await validateRepositoryCheckout(`${owner}/${repo}`, { revision: resolvedRevision, mustExist: true });
            const entries = await readdir(clonePath);
            alreadyExisted = entries.length > 0;
            if (alreadyExisted) {
              const checkout = await validateGitWorkingDirectory(clonePath);
              if (resolvedRevision) {
                const head = (await simpleGit(checkout).revparse(["HEAD"])).trim().toLowerCase();
                if (head !== resolvedRevision) throw new Error("Repository checkout does not match its revision directory.");
                await scanRepositoryQuota(checkout, options.quotas ?? runtimeRepositoryQuotas, deadline.signal);
                return {
                  clonePath,
                  alreadyExisted: true,
                  commitSha: resolvedRevision,
                  branch: options.branch ?? null,
                };
              }
            }
          } catch (error) {
            if (!resolvedRevision) throw error;
            await removeRepositoryCheckout(`${owner}/${repo}`, { revision: resolvedRevision });
            alreadyExisted = false;
          }
        }
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
          if (!alreadyExisted) await retry(
            async (attempt) => {
              if (attempt > 1) await removeRepositoryCheckout(`${owner}/${repo}`, {
                ...(resolvedRevision ? { revision: resolvedRevision } : {}),
              });
              const attemptsRemaining = env.CLONE_MAX_RETRIES + 2 - attempt;
              const attemptTimeoutMs = Math.max(1, Math.floor(deadline.remainingMs() / attemptsRemaining));
              await (options.executeClone ?? defaultCloneExecutor)(repoUrl, clonePath, attemptTimeoutMs);
              await validateRepositoryCheckout(`${owner}/${repo}`, { revision: resolvedRevision, mustExist: true });
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
          const snapshot = await (options.checkoutSnapshot ?? defaultSnapshotCheckoutExecutor)({
            clonePath,
            branch: options.branch ?? null,
            reusedClone: alreadyExisted,
            timeoutMs: Math.max(1, Math.floor(deadline.remainingMs())),
          });
          deadline.throwIfExpired();
          if (resolvedRevision && snapshot.commitSha !== resolvedRevision) {
            throw new Error("Repository checkout does not match its revision directory.");
          }
          await scanRepositoryQuota(clonePath, options.quotas ?? runtimeRepositoryQuotas, deadline.signal);
          return {
            clonePath,
            alreadyExisted,
            commitSha: snapshot.commitSha,
            branch: snapshot.branch,
          };
        } catch (err) {
          try {
            await removeRepositoryCheckout(`${owner}/${repo}`, {
              ...(resolvedRevision ? { revision: resolvedRevision } : {}),
            });
          } catch {
            logger.error("repository_cleanup_rejected", {
              requestId: options.requestId,
              repositoryId: `${owner}/${repo}`,
              operation: "clone_failure_cleanup",
              reasonCode: "unsafe_cleanup_rejection",
            });
          }
          if (isRepositoryQuotaError(err)) throw err;
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
