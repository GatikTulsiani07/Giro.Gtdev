import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkIndexingWorkerReadiness } from "../services/health/runtimeProductionHealth.js";

function clientWithRows(rows: unknown[], error: unknown = null): SupabaseClient {
  const query = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit: async () => ({ data: rows, error }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

const now = Date.parse("2026-07-22T10:00:00.000Z");
const recent = "2026-07-22T09:59:59.000Z";

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    heartbeat_at: recent,
    last_loop_at: recent,
    last_successful_poll_at: recent,
    last_successful_claim_at: recent,
    last_successful_recovery_at: recent,
    last_successful_lease_heartbeat_at: recent,
    consecutive_database_failures: 0,
    functional_ready: true,
    loop_state: "idle",
    active_job_id: null,
    ...overrides,
  };
}

test("functional worker row satisfies required API readiness", async () => {
  await checkIndexingWorkerReadiness(clientWithRows([readyRow()]), {
    now: () => now, stallTimeoutMs: 5_000, maxConsecutiveFailures: 3,
  });
});

test("API readiness rejects failed heartbeat and repeated database failures", async () => {
  for (const row of [
    readyRow({ functional_ready: false, loop_state: "failed" }),
    readyRow({ consecutive_database_failures: 3 }),
  ]) {
    await assert.rejects(checkIndexingWorkerReadiness(clientWithRows([row]), {
      now: () => now, stallTimeoutMs: 5_000, maxConsecutiveFailures: 3,
    }), /functional readiness/);
  }
});

test("API readiness rejects a stalled worker loop", async () => {
  await assert.rejects(checkIndexingWorkerReadiness(clientWithRows([
    readyRow({ last_loop_at: "2026-07-22T09:59:00.000Z" }),
  ]), {
    now: () => now, stallTimeoutMs: 5_000, maxConsecutiveFailures: 3,
  }), /functional readiness/);
});
