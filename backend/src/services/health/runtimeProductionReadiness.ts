import { constants } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  checkRepositoryStorageAccess,
  repositoryStorageRoot,
} from "../../config/repositoryStorage.js";
import { supabase } from "../../lib/supabase.js";
import {
  createProductionReadinessCheck,
  type ProductionReadinessCheck,
} from "./productionReadiness.js";
import {
  checkIndexingWorkerReadiness,
  checkSupabaseConnectivity,
} from "./runtimeProductionHealth.js";

export function createRuntimeProductionReadinessCheck(options: {
  client?: SupabaseClient;
  timeoutMs?: number;
  isStartupComplete?: () => boolean;
  isShuttingDown?: () => boolean;
  workerEnabled?: boolean;
} = {}): ProductionReadinessCheck {
  const client = options.client ?? supabase;
  return createProductionReadinessCheck({
    isStartupComplete: options.isStartupComplete ?? (() => true),
    checkSupabase: () => checkSupabaseConnectivity(client),
    checkEnvironment: () => {
      if (!Object.isFrozen(env)) throw new Error("Environment is not validated.");
    },
    checkStorage: () => checkRepositoryStorageAccess(
      repositoryStorageRoot,
      constants.F_OK | constants.W_OK,
    ),
    isShuttingDown: options.isShuttingDown ?? (() => false),
    workerEnabled: options.workerEnabled ?? env.INDEXING_WORKER_ENABLED,
    checkIndexingWorker: () => checkIndexingWorkerReadiness(client, {
      stallTimeoutMs: env.INDEXING_WORKER_STALL_TIMEOUT_MS,
      maxConsecutiveFailures: env.INDEXING_WORKER_MAX_CONSECUTIVE_DATABASE_FAILURES,
      setStalled: (stalled) => runtimeMetrics.setWorkerStalled(stalled),
    }),
  }, options.timeoutMs);
}
