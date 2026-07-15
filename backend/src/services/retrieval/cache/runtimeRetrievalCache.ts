import { env } from "../../../config/env.js";
import { logger } from "../../../lib/logger.js";
import { runtimeMetrics } from "../../../observability/metrics.js";
import { runtimeIndexingJobStore } from "../../indexing/jobs/runtimeIndexingJobStore.js";
import { RetrievalCache } from "./retrievalCache.js";

export const runtimeRetrievalCache = new RetrievalCache({
  ttlMs: env.RETRIEVAL_CACHE_TTL_MS,
  maxEntries: env.RETRIEVAL_CACHE_MAX_ENTRIES,
  metrics: runtimeMetrics,
  logger,
  versionProvider: async (repositoryId) => {
    const job = await runtimeIndexingJobStore.getLatestRepositoryJob(repositoryId);
    if (!job) return "unversioned";
    return [job.jobId, job.attempt, job.status, job.currentStage, job.progress].join(":");
  },
});
