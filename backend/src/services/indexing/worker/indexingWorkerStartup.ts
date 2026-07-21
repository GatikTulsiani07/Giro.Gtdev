import type { IndexingJobWorkerLogger } from "../jobs/indexingJobWorker.js";
import type { IndexingWorkerStateStore } from "./indexingWorkerStateStore.js";
import type { ContinuousIndexingWorkerConfig } from "./continuousIndexingWorker.js";

export interface ValidateIndexingWorkerStartupInput {
  config: ContinuousIndexingWorkerConfig;
  stateStore: IndexingWorkerStateStore;
  logger: IndexingJobWorkerLogger;
}

/**
 * Validates the durable worker schema and database connection before the first
 * claim attempt. record_indexing_worker_state is service-role-only and is
 * installed by the supervised-worker migration, so a successful call proves
 * both connectivity and that the required worker migration is present.
 */
export async function validateIndexingWorkerStartup(
  input: ValidateIndexingWorkerStartupInput,
): Promise<void> {
  await input.stateStore.record({
    workerId: input.config.workerId,
    state: "running",
    activeJobId: null,
  });
  input.logger.info("indexing_worker_startup_validated", {
    workerId: input.config.workerId,
    persistence: "supabase",
  });
}
