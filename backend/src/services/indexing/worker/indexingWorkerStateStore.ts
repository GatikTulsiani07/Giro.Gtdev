import type { SupabaseClient } from "@supabase/supabase-js";

export type IndexingWorkerShutdownState = "running" | "stopping" | "stopped";
export type IndexingWorkerLoopState =
  | "starting" | "recovering" | "polling" | "idle" | "processing"
  | "stopping" | "stopped" | "failed";

export interface IndexingWorkerHealthUpdate {
  workerId: string;
  state: IndexingWorkerShutdownState;
  loopState?: IndexingWorkerLoopState;
  functionalReady?: boolean;
  consecutiveDatabaseFailures?: number;
  activeJobId?: string | null;
  lastCompletedJobId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  loopObserved?: boolean;
  pollSucceeded?: boolean;
  claimSucceeded?: boolean;
  recoverySucceeded?: boolean;
  leaseHeartbeatSucceeded?: boolean;
}

export interface IndexingWorkerStateStore {
  record(update: IndexingWorkerHealthUpdate): Promise<void>;
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export class SupabaseIndexingWorkerStateStore implements IndexingWorkerStateStore {
  private readonly client: RpcClient;

  constructor(client: RpcClient | SupabaseClient) {
    this.client = client as RpcClient;
  }

  async record(update: IndexingWorkerHealthUpdate): Promise<void> {
    const { error } = await this.client.rpc("record_indexing_worker_state", {
      input_worker_id: update.workerId,
      input_shutdown_state: update.state,
      input_loop_state: update.loopState ?? "starting",
      input_functional_ready: update.functionalReady ?? false,
      input_consecutive_database_failures: update.consecutiveDatabaseFailures ?? 0,
      input_active_job_id: update.activeJobId ?? null,
      input_last_completed_job_id: update.lastCompletedJobId ?? null,
      input_last_error_code: update.lastErrorCode ?? null,
      input_last_error_message: update.lastErrorMessage ?? null,
      input_loop_observed: update.loopObserved ?? false,
      input_poll_succeeded: update.pollSucceeded ?? false,
      input_claim_succeeded: update.claimSucceeded ?? false,
      input_recovery_succeeded: update.recoverySucceeded ?? false,
      input_lease_heartbeat_succeeded: update.leaseHeartbeatSucceeded ?? false,
    });
    if (error) throw new Error("Indexing worker health persistence failed.");
  }
}
