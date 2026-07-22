import { chmod, lstat, readdir, stat, utimes } from "node:fs/promises";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import {
  listRepositoryCheckoutRevisions,
  removeRepositoryCheckout,
  resolveRepositoryPath,
  validateRepositoryCheckout,
  type TrustedRepositoryCheckoutPath,
} from "../security/repositoryPaths.js";
import type { IndexingJobStore } from "../indexing/jobs/indexingJobStore.js";
import type { RepositoryStore } from "./store/repositoryStore.js";
import { repositoryStore as runtimeRepositoryStore } from "./store/runtimeRepositoryStore.js";

async function makeReadOnly(root: TrustedRepositoryCheckoutPath, relative = ""): Promise<void> {
  const directory = relative
    ? await resolveRepositoryPath(root, relative, { mustExist: true, requireDirectory: true })
    : root;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const info = await lstat(await resolveRepositoryPath(root, child, { mustExist: true }));
    if (info.isDirectory()) await makeReadOnly(root, child);
    else await chmod(await resolveRepositoryPath(root, child, { mustExist: true, requireFile: true }), 0o444);
  }
  await chmod(directory, 0o555);
}

async function makeWritable(root: TrustedRepositoryCheckoutPath, relative = ""): Promise<void> {
  const directory = relative
    ? await resolveRepositoryPath(root, relative, { mustExist: true, requireDirectory: true })
    : root;
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const target = await resolveRepositoryPath(root, child, { mustExist: true });
    const info = await lstat(target);
    if (info.isDirectory()) await makeWritable(root, child);
    else await chmod(target, 0o600);
  }
}

export async function sealRepositoryCheckout(checkout: TrustedRepositoryCheckoutPath): Promise<void> {
  await makeReadOnly(checkout);
}

export async function refreshPreviousCheckoutReadLease(
  repositoryId: string,
  store: RepositoryStore = runtimeRepositoryStore,
): Promise<void> {
  const metadata = await store.getRepository(repositoryId);
  if (!metadata?.previousRevision) return;
  const checkout = await validateRepositoryCheckout(repositoryId, {
    revision: metadata.previousRevision,
    mustExist: true,
  });
  const timestamp = new Date();
  await utimes(checkout, timestamp, timestamp);
}

export async function removeUnpublishedRepositoryCheckout(
  repositoryId: string,
  revision: string,
  store: RepositoryStore = runtimeRepositoryStore,
): Promise<boolean> {
  const metadata = await store.getRepository(repositoryId);
  if (!metadata || [metadata.currentRevision, metadata.publishingRevision, metadata.previousRevision].includes(revision)) return false;
  const checkout = await validateRepositoryCheckout(repositoryId, { revision, mustExist: true });
  const confirmed = await store.getRepository(repositoryId);
  if (!confirmed || [confirmed.currentRevision, confirmed.publishingRevision, confirmed.previousRevision].includes(revision)) return false;
  await makeWritable(checkout);
  return removeRepositoryCheckout(repositoryId, { revision });
}

export async function cleanupAbandonedRepositoryCheckouts(
  repositoryId: string,
  store: RepositoryStore = runtimeRepositoryStore,
  olderThanMs = env.REPOSITORY_QUOTA_MAX_INDEXING_DURATION_MS,
): Promise<number> {
  let removed = 0;
  for (const revision of await listRepositoryCheckoutRevisions(repositoryId)) {
    const metadata = await store.getRepository(repositoryId);
    if (!metadata) break;
    if ([metadata.currentRevision, metadata.publishingRevision, metadata.previousRevision].includes(revision)) continue;
    const checkout = await validateRepositoryCheckout(repositoryId, { revision, mustExist: true });
    if (Date.now() - (await stat(checkout)).mtimeMs < olderThanMs) continue;
    if (await removeUnpublishedRepositoryCheckout(repositoryId, revision, store)) removed += 1;
  }
  return removed;
}

export async function recoverAbandonedRepositoryCheckouts(
  repositoryId: string,
  store: RepositoryStore,
  jobStore: IndexingJobStore,
  olderThanMs = env.REPOSITORY_QUOTA_MAX_INDEXING_DURATION_MS,
): Promise<number> {
  const metadata = await store.getRepository(repositoryId);
  if (metadata?.publishingRevision) {
    const jobs = await jobStore.listRepositoryJobs(repositoryId);
    const hasActiveJob = jobs.some((job) =>
      job.status === "queued" || job.status === "claimed" || job.status === "running"
    );
    if (!hasActiveJob) {
      await store.markFailed(repositoryId, { reason: "abandoned_publication_recovered" });
    }
  }
  return cleanupAbandonedRepositoryCheckouts(repositoryId, store, olderThanMs);
}

/** Best-effort, concurrency-safe GC. Durable pointers are re-read before every deletion. */
export async function collectRepositoryCheckouts(
  repositoryId: string,
  store: RepositoryStore = runtimeRepositoryStore,
  retentionCount = env.REPOSITORY_CHECKOUT_RETENTION_COUNT,
): Promise<number> {
  const revisions = await listRepositoryCheckoutRevisions(repositoryId);
  const dated = await Promise.all(revisions.map(async (revision) => ({
    revision,
    modified: (await stat(await validateRepositoryCheckout(repositoryId, { revision, mustExist: true }))).mtimeMs,
  })));
  dated.sort((a, b) => b.modified - a.modified);
  const retained = new Set<string>();
  const initialMetadata = await store.getRepository(repositoryId);
  for (const protectedRevision of [
    initialMetadata?.currentRevision,
    initialMetadata?.publishingRevision,
    initialMetadata?.previousRevision,
  ]) if (protectedRevision) retained.add(protectedRevision);
  for (const { revision } of dated) {
    if (retained.size >= Math.max(1, retentionCount)) break;
    retained.add(revision);
  }
  let deleted = 0;
  for (const { revision, modified } of dated) {
    const metadata = await store.getRepository(repositoryId);
    if (!metadata) break;
    for (const protectedRevision of [metadata.currentRevision, metadata.publishingRevision, metadata.previousRevision]) {
      if (protectedRevision) retained.add(protectedRevision);
    }
    if (retained.has(revision) || Date.now() - modified <= env.REQUEST_TIMEOUT_MS) continue;
    try {
      const checkout = await validateRepositoryCheckout(repositoryId, { revision, mustExist: true });
      await makeWritable(checkout);
      if (await removeRepositoryCheckout(repositoryId, { revision })) deleted += 1;
    } catch (error) {
      logger.warn("repository_checkout_gc_failed", {
        repositoryId,
        revision,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return deleted;
}
