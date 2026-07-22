import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase.js";
import { env } from "../../config/env.js";
import {
  createProductionHealthCheck,
  type ProductionHealthCheck,
} from "./productionHealth.js";

type ProbeResult = { data: unknown; error: unknown };

export async function checkSupabaseConnectivity(client: SupabaseClient): Promise<void> {
  const result = await client
    .from("repositories")
    .select("repository_id")
    .limit(1) as ProbeResult;
  if (result.error) throw new Error("Supabase health check failed.");
}

export async function checkIndexingWorkerLiveness(client: SupabaseClient): Promise<void> {
  const result = await client
    .from("indexing_workers")
    .select("heartbeat_at")
    .eq("shutdown_state", "running")
    .order("heartbeat_at", { ascending: false })
    .limit(1) as ProbeResult;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  const heartbeat = row && typeof row === "object"
    ? (row as { heartbeat_at?: unknown }).heartbeat_at
    : null;
  const heartbeatMs = typeof heartbeat === "string" ? Date.parse(heartbeat) : Number.NaN;
  if (
    result.error ||
    !Number.isFinite(heartbeatMs) ||
    Date.now() - heartbeatMs > env.INDEXING_WORKER_STALE_CLAIM_MS
  ) {
    throw new Error("Indexing worker health check failed.");
  }
}

export async function checkIndexingWorkerReadiness(
  client: SupabaseClient,
  options: {
    now?: () => number;
    stallTimeoutMs?: number;
    maxConsecutiveFailures?: number;
    setStalled?: (stalled: boolean) => void;
  } = {},
): Promise<void> {
  const result = await client
    .from("indexing_workers")
    .select("heartbeat_at,last_loop_at,last_successful_poll_at,last_successful_claim_at,last_successful_recovery_at,last_successful_lease_heartbeat_at,consecutive_database_failures,functional_ready,loop_state,active_job_id")
    .eq("shutdown_state", "running")
    .order("heartbeat_at", { ascending: false })
    .limit(20) as ProbeResult;
  const now = options.now?.() ?? Date.now();
  const stallTimeoutMs = options.stallTimeoutMs ?? env.INDEXING_WORKER_STALL_TIMEOUT_MS;
  const maximumFailures = options.maxConsecutiveFailures ??
    env.INDEXING_WORKER_MAX_CONSECUTIVE_DATABASE_FAILURES;
  const rows = Array.isArray(result.data) ? result.data : [];
  const hasRecentLoop = rows.some((value) => {
    if (!value || typeof value !== "object") return false;
    const loop = (value as Record<string, unknown>).last_loop_at;
    const loopAt = typeof loop === "string" ? Date.parse(loop) : Number.NaN;
    return Number.isFinite(loopAt) && now - loopAt <= stallTimeoutMs;
  });
  options.setStalled?.(!hasRecentLoop);
  const ready = rows.some((value) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    const heartbeatAt = typeof row.heartbeat_at === "string" ? Date.parse(row.heartbeat_at) : Number.NaN;
    const loopAt = typeof row.last_loop_at === "string" ? Date.parse(row.last_loop_at) : Number.NaN;
    const pollAt = typeof row.last_successful_poll_at === "string"
      ? Date.parse(row.last_successful_poll_at) : Number.NaN;
    const claimAt = typeof row.last_successful_claim_at === "string"
      ? Date.parse(row.last_successful_claim_at) : Number.NaN;
    const failures = Number(row.consecutive_database_failures);
    return row.functional_ready === true &&
      Number.isFinite(heartbeatAt) && now - heartbeatAt <= stallTimeoutMs &&
      Number.isFinite(loopAt) && now - loopAt <= stallTimeoutMs &&
      Number.isFinite(pollAt) && now - pollAt <= stallTimeoutMs &&
      Number.isFinite(claimAt) && now - claimAt <= stallTimeoutMs &&
      Number.isInteger(failures) && failures < maximumFailures &&
      row.loop_state !== "failed" && row.loop_state !== "stopping" && row.loop_state !== "stopped";
  });
  if (result.error || !ready) throw new Error("Indexing worker functional readiness check failed.");
}

export function createRuntimeProductionHealthCheck(options: {
  client?: SupabaseClient;
  timeoutMs?: number;
} = {}): ProductionHealthCheck {
  const client = options.client ?? supabase;
  return createProductionHealthCheck({
    checkSupabase: () => checkSupabaseConnectivity(client),
    checkIndexingWorker: () => checkIndexingWorkerLiveness(client),
  }, options.timeoutMs);
}
