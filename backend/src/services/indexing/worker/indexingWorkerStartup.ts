import type { IndexingJobWorkerLogger } from "../jobs/indexingJobWorker.js";
import type { IndexingWorkerStateStore } from "./indexingWorkerStateStore.js";
import type { ContinuousIndexingWorkerConfig } from "./continuousIndexingWorker.js";

export interface ValidateIndexingWorkerStartupInput {
  config: ContinuousIndexingWorkerConfig;
  stateStore: IndexingWorkerStateStore;
  contractValidator: IndexingWorkerContractValidator;
  logger: IndexingJobWorkerLogger;
}

export const INDEXING_WORKER_CONTRACT_VERSION =
  "20260802000000_add_worker_functional_readiness.sql";

const REQUIRED_OPERATIONS = [
  "claim", "recovery", "lease_heartbeat", "lease_fencing", "completion",
  "failure", "revision_publication", "artifact_publication", "repository_cas",
  "worker_state",
] as const;

export interface IndexingWorkerContractValidator {
  validate(): Promise<unknown>;
}

interface RpcClient {
  rpc(name: string, parameters?: Record<string, never>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export class SupabaseIndexingWorkerContractValidator implements IndexingWorkerContractValidator {
  constructor(private readonly client: RpcClient) {}

  async validate(): Promise<unknown> {
    const { data, error } = await this.client.rpc("validate_indexing_worker_contract", {});
    if (error) throw new Error(`Indexing worker database contract validation failed: ${error.message ?? "unknown error"}`);
    return data;
  }
}

function assertContractResult(data: unknown): void {
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object") {
    throw new Error("Indexing worker database contract returned an invalid shape.");
  }
  const row = result as Record<string, unknown>;
  const operations = Array.isArray(row.validated_operations)
    ? row.validated_operations.filter((value): value is string => typeof value === "string")
    : [];
  if (
    row.contract_valid !== true ||
    row.migration_version !== INDEXING_WORKER_CONTRACT_VERSION ||
    REQUIRED_OPERATIONS.some((operation) => !operations.includes(operation))
  ) {
    throw new Error("Indexing worker database contract version or return shape is invalid.");
  }
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
  assertContractResult(await input.contractValidator.validate());
  await input.stateStore.record({
    workerId: input.config.workerId,
    state: "running",
    loopState: "starting",
    functionalReady: false,
    consecutiveDatabaseFailures: 0,
    activeJobId: null,
  });
  input.logger.info("indexing_worker_startup_validated", {
    workerId: input.config.workerId,
    persistence: "supabase",
    migrationVersion: INDEXING_WORKER_CONTRACT_VERSION,
  });
}
