import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { validateIndexingWorkerStartup } from "../services/indexing/worker/indexingWorkerStartup.js";

const backendRoot = process.cwd();
const compiledWorker = path.join(backendRoot, "dist/commands/runIndexingWorker.js");

test("build emits the production worker entrypoint", () => {
  assert.equal(existsSync(compiledWorker), true, "run pnpm build before production smoke tests");
  const source = readFileSync(compiledWorker, "utf8");
  assert.match(source, /runIndexingWorker/);
  assert.doesNotMatch(source, /from ["']tsx["']|--import["', ]+tsx/);
});

test("production package scripts execute dist JavaScript without tsx", () => {
  const manifest = JSON.parse(readFileSync(path.join(backendRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(manifest.scripts["indexing:worker"], "node dist/commands/runIndexingWorker.js");
  assert.equal(manifest.scripts["start:worker"], "node dist/commands/runIndexingWorker.js");
  assert.match(manifest.scripts["indexing:worker:dev"] ?? "", /^tsx /);
  assert.equal(manifest.dependencies.tsx, undefined);
  assert.equal(typeof manifest.devDependencies.tsx, "string");
});

test("startup validation connects to the migrated worker state contract before polling", async () => {
  const events: string[] = [];
  await validateIndexingWorkerStartup({
    config: {
      workerId: "production-worker-1",
      pollIntervalMs: 100,
      idleBackoffMs: 100,
      maxPollIntervalMs: 200,
      staleClaimMs: 10_000,
      heartbeatMs: 1_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      shutdownTimeoutMs: 1_000,
    },
    stateStore: {
      record: async (update) => {
        events.push(`migration:${update.workerId}:${update.state}`);
      },
    },
    logger: {
      info: (event) => events.push(event),
      error: () => undefined,
    },
  });
  assert.deepEqual(events, [
    "migration:production-worker-1:running",
    "indexing_worker_startup_validated",
  ]);
});

test("startup validation fails closed when the worker migration is unavailable", async () => {
  let logged = false;
  await assert.rejects(validateIndexingWorkerStartup({
    config: {
      workerId: "production-worker-1",
      pollIntervalMs: 100,
      idleBackoffMs: 100,
      maxPollIntervalMs: 200,
      staleClaimMs: 10_000,
      heartbeatMs: 1_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      shutdownTimeoutMs: 1_000,
    },
    stateStore: {
      record: async () => { throw new Error("worker migration unavailable"); },
    },
    logger: {
      info: () => { logged = true; },
      error: () => undefined,
    },
  }), /worker migration unavailable/);
  assert.equal(logged, false);
});

test("compiled production worker starts and exits cleanly after configuration preflight", async () => {
  const child = spawn(process.execPath, [compiledWorker, "--validate-config"], {
    cwd: backendRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      SUPABASE_URL: "https://production-smoke.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "production-smoke-service-role-key",
      SUPABASE_ANON_KEY: "",
      OPENAI_API_KEY: "sk-production-smoke-openai-key",
      JWT_SECRET: "production-smoke-jwt-secret",
      INDEXING_WORKER_ID: "compiled-smoke-worker",
      REPOSITORY_STORAGE_ROOT: "/tmp/giro-production-worker-smoke",
    },
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const timeoutHandle = setTimeout(() => {
    child.kill("SIGKILL");
  }, 10_000);
  try {
    const result = await exitPromise;
    assert.deepEqual(result, { code: 0, signal: null });
  } finally {
    clearTimeout(timeoutHandle);
  }
  assert.match(stderr, /"operation":"indexing_worker_config_validated"/);
  assert.match(stderr, /"entrypoint":"compiled"/);
  assert.doesNotMatch(stderr, /indexing_worker_started|claim_next_indexing_job/);
});
