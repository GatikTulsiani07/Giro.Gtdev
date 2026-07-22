import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(new URL(
  "../../supabase/migrations/20260802000000_add_worker_functional_readiness.sql",
  import.meta.url,
), "utf8");

test("worker readiness migration validates every critical deployed database operation", () => {
  for (const contract of [
    "claim_next_indexing_job", "recover_stale_indexing_jobs", "heartbeat_indexing_job",
    "mark_indexing_job_running", "complete_indexing_job", "fail_indexing_job",
    "begin_repository_snapshot", "stage_repository_artifacts",
    "publish_repository_snapshot", "record_indexing_worker_state",
    "repositories_enforce_version_increment", "indexing_workers_functional_readiness_idx",
  ]) assert.match(migration, new RegExp(contract, "i"));
  assert.match(migration, /proc\.proargnames/);
  assert.match(migration, /oidvectortypes\(proc\.proargtypes\)/);
  assert.match(migration, /pg_get_function_result/);
  assert.match(migration, /has_function_privilege/);
});

test("worker state schema persists the functional readiness contract", () => {
  for (const field of [
    "last_successful_poll_at", "last_successful_claim_at",
    "last_successful_recovery_at", "last_successful_lease_heartbeat_at",
    "consecutive_database_failures", "loop_state", "functional_ready", "active_job_id",
  ]) assert.match(migration, new RegExp(field, "i"));
});
