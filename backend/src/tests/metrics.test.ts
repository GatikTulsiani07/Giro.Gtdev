import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createApp } from "../app.js";
import { createMetricsMiddleware } from "../middleware/metricsMiddleware.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { MemoryIndexingJobStore } from "../services/indexing/jobs/memoryIndexingJobStore.js";
import { processNextIndexingJob } from "../services/indexing/jobs/indexingJobWorker.js";
import { DeadlineExceededError } from "../runtime/deadline.js";
import { setRepositoryOwner } from "../services/repository/ownershipStore.js";

test("public metrics endpoint uses Prometheus content type and valid exposition", async () => {
  const metrics = new MetricsRegistry();
  const app = createApp({ metrics });
  await app.request("/health/live");
  const response = await app.request("/metrics");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; version=0.0.4");
  assert.match(body, /^# HELP giro_http_requests_total/m);
  assert.match(body, /^# TYPE giro_http_request_duration_seconds histogram$/m);
  assert.match(body, /giro_http_requests_total\{route="\/health\/live",method="GET",status_class="2xx"\} 1/);
  assert.match(body, /giro_http_request_duration_seconds_count\{route="\/health\/live",method="GET"\} 1/);
  assert.match(body, /giro_http_request_duration_seconds_bucket\{route="\/health\/live",method="GET",le="\+Inf"\} 1/);
});

test("repeated requests increment counters and histogram counts", async () => {
  const metrics = new MetricsRegistry({ durationBucketsSeconds: [0.1, 1] });
  const app = createApp({ metrics });
  await app.request("/health/live");
  await app.request("/health/live");
  const output = metrics.render();

  assert.match(output, /status_class="2xx"\} 2/);
  assert.match(output, /_count\{route="\/health\/live",method="GET"\} 2/);
  assert.match(output, /le="0.1"\} [0-2]/);
  assert.match(output, /giro_requests_total 2/);
  assert.match(output, /giro_requests_active 0/);
  assert.match(output, /giro_requests_completed_total 2/);
  assert.match(output, /giro_requests_failed_total 0/);
});

test("aggregate request counters distinguish completed and failed requests", async () => {
  const metrics = new MetricsRegistry();
  const app = new Hono();
  app.use("*", createMetricsMiddleware(metrics));
  app.get("/ok", (c) => c.text("ok"));
  app.get("/failed", (c) => c.text("failed", 500));

  await app.request("/ok");
  await app.request("/failed");
  const output = metrics.render();

  assert.match(output, /giro_requests_total 2/);
  assert.match(output, /giro_requests_completed_total 2/);
  assert.match(output, /giro_requests_failed_total 1/);
});

test("in-flight gauge is concurrency safe and returns to zero", async () => {
  const metrics = new MetricsRegistry();
  const app = new Hono();
  app.use("*", createMetricsMiddleware(metrics));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  app.get("/work", async (c) => {
    await blocked;
    return c.text("done");
  });

  const requests = [app.request("/work"), app.request("/work"), app.request("/work")];
  await Promise.resolve();
  assert.match(metrics.render(), /giro_http_requests_in_flight 3/);
  release();
  await Promise.all(requests);
  assert.match(metrics.render(), /giro_http_requests_in_flight 0/);
  assert.match(metrics.render(), /status_class="2xx"\} 3/);
  assert.match(metrics.render(), /giro_requests_total 3/);
  assert.match(metrics.render(), /giro_requests_completed_total 3/);
});

test("aggregate latency reports average, p50, p95, and p99", async () => {
  const metrics = new MetricsRegistry();
  const clock = [0, 10, 10, 30, 30, 60, 60, 100];
  const app = new Hono();
  app.use("*", createMetricsMiddleware(metrics, {
    monotonicNow: () => clock.shift() ?? 100,
  }));
  app.get("/work", (c) => c.text("ok"));

  await app.request("/work");
  await app.request("/work");
  await app.request("/work");
  await app.request("/work");
  const output = metrics.render();

  assert.match(output, /giro_request_duration_average_ms 25/);
  assert.match(output, /giro_request_duration_p50_ms 20/);
  assert.match(output, /giro_request_duration_p95_ms 40/);
  assert.match(output, /giro_request_duration_p99_ms 40/);
});

test("readiness gauge reflects ready, degraded, failure, and not-ready states", async () => {
  const readyMetrics = new MetricsRegistry();
  const readyApp = createApp({
    metrics: readyMetrics,
    readinessCheck: async () => ({ status: "ready", checks: [] }),
  });
  await readyApp.request("/health/ready");
  assert.match(readyMetrics.render(), /giro_health_readiness 1/);

  const degradedMetrics = new MetricsRegistry();
  const degradedApp = createApp({
    metrics: degradedMetrics,
    readinessCheck: async () => ({ status: "degraded", checks: [] }),
  });
  await degradedApp.request("/health/ready");
  assert.match(degradedMetrics.render(), /giro_health_readiness 1/);

  const unavailableMetrics = new MetricsRegistry();
  const unavailableApp = createApp({
    metrics: unavailableMetrics,
    readinessCheck: async () => ({ status: "not_ready", checks: [] }),
  });
  await unavailableApp.request("/health/ready");
  assert.match(unavailableMetrics.render(), /giro_health_readiness 0/);
});

test("rate limiter rejection counter increments only on rejected requests", async () => {
  const metrics = new MetricsRegistry();
  const app = new Hono();
  app.use("/limited", rateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    onRejected: () => metrics.incrementRateLimitRejections(),
  }));
  app.get("/limited", (c) => c.text("ok"));

  await app.request("/limited");
  await app.request("/limited");
  await app.request("/limited");
  assert.match(metrics.render(), /giro_rate_limit_rejections_total 2/);
  assert.match(metrics.render(), /giro_requests_rate_limited_total 2/);
});

test("request timeout counter has a dedicated operational metric", () => {
  const metrics = new MetricsRegistry();
  metrics.incrementTimeout("request");
  assert.match(metrics.render(), /giro_requests_timed_out_total 1/);
});

test("repository connect, Ask Giro, and retrieval route counters increment centrally", async () => {
  const metrics = new MetricsRegistry();
  const app = new Hono();
  app.use("*", createMetricsMiddleware(metrics));
  app.post("/repos/connect", (c) => c.text("ok"));
  app.post("/sessions/:id/ask", (c) => c.text("ok"));
  app.post("/retrieval/hybrid", (c) => c.text("ok"));

  await app.request("/repos/connect", { method: "POST" });
  await app.request("/sessions/session-1/ask", { method: "POST" });
  await app.request("/retrieval/hybrid", { method: "POST" });
  const output = metrics.render();

  assert.match(output, /giro_repository_connects_total 1/);
  assert.match(output, /giro_ask_giro_requests_total 1/);
  assert.match(output, /giro_retrieval_requests_total 1/);
});

test("indexing lifecycle counter records started, completed, and failed", async () => {
  const metrics = new MetricsRegistry();
  const store = new MemoryIndexingJobStore();
  const repositoryStore = {
    markIndexing: () => undefined,
    markIndexed: () => undefined,
    markFailed: () => undefined,
  };
  const jobInput = {
    repositoryId: "acme/demo",
    ownerUserId: "user-1",
    repositoryOwner: "acme",
    repositoryName: "demo",
    repositoryUrl: "https://github.com/acme/demo",
    branch: "main",
  };
  await store.createJob(jobInput);
  setRepositoryOwner("acme/demo", "user-1");
  await processNextIndexingJob({
    workerId: "worker-1",
    jobStore: store,
    repositoryStore,
    metrics,
    executeIndexingPipeline: async () => ({
      counts: {
        chunkCount: 0,
        fileCount: 0,
        symbolCount: 0,
        graphNodeCount: 0,
        graphEdgeCount: 0,
        summaryAvailable: false,
      },
    }),
  });
  await store.createJob({
    ...jobInput,
    repositoryId: "acme/failing",
    repositoryName: "failing",
    repositoryUrl: "https://github.com/acme/failing",
  });
  setRepositoryOwner("acme/failing", "user-1");
  await processNextIndexingJob({
    workerId: "worker-1",
    jobStore: store,
    repositoryStore,
    metrics,
    executeIndexingPipeline: async () => { throw new Error("failed"); },
  });

  const output = metrics.render();
  assert.match(output, /giro_repository_indexing_total\{status="started"\} 2/);
  assert.match(output, /giro_repository_indexing_total\{status="completed"\} 1/);
  assert.match(output, /giro_repository_indexing_total\{status="failed"\} 1/);
  assert.match(output, /giro_indexing_jobs_started_total 2/);
  assert.match(output, /giro_indexing_jobs_completed_total 1/);
  assert.match(output, /giro_indexing_jobs_failed_total 1/);
});

test("metrics response contract includes deterministic process metrics", async () => {
  const metrics = new MetricsRegistry({
    processStartTimeSeconds: 1_700_000_000,
    uptimeSeconds: () => 123.5,
    memoryUsage: () => ({
      rss: 1_000,
      heapTotal: 800,
      heapUsed: 600,
      external: 200,
    }),
  });
  const app = createApp({ metrics });
  const response = await app.request("/metrics");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; version=0.0.4");
  assert.match(body, /giro_process_uptime_seconds 123.5/);
  assert.match(body, /giro_process_start_time_seconds 1700000000/);
  assert.match(body, /giro_process_memory_rss_bytes 1000/);
  assert.match(body, /giro_process_memory_heap_total_bytes 800/);
  assert.match(body, /giro_process_memory_heap_used_bytes 600/);
  assert.match(body, /giro_process_memory_external_bytes 200/);
});

test("metrics output never includes request secrets or diagnostics", async () => {
  const secret = "sk-secret-Bearer-token-repository-source";
  const metrics = new MetricsRegistry();
  const app = new Hono();
  app.use("*", createMetricsMiddleware(metrics));
  await app.request(`/${secret}`);

  const output = metrics.render();
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("Bearer"), false);
  assert.equal(output.includes("repository-source"), false);
});

test("indexing deadline failure is retryable, never succeeds, and increments one timeout category", async () => {
  const metrics = new MetricsRegistry();
  const store = new MemoryIndexingJobStore();
  const job = await store.createJob({
    repositoryId: "acme/timeout",
    ownerUserId: "user-1",
    repositoryOwner: "acme",
    repositoryName: "timeout",
    repositoryUrl: "https://github.com/acme/timeout",
    branch: "main",
  });
  setRepositoryOwner("acme/timeout", "user-1");
  const events: string[] = [];
  const report = await processNextIndexingJob({
    workerId: "worker-1",
    jobStore: store,
    repositoryStore: {
      markIndexing: () => undefined,
      markIndexed: () => { throw new Error("must not succeed"); },
      markFailed: () => undefined,
    },
    metrics,
    logger: { info: () => undefined, error: (event) => events.push(event) },
    executeIndexingPipeline: async () => { throw new DeadlineExceededError(); },
  });
  assert.equal(report.status, "failed");
  assert.equal((await store.getJob(job.jobId))?.status, "failed");
  assert.equal(report.failure?.retryable, true);
  assert.deepEqual(events, ["indexing_stage_timeout", "indexing_job_failed"]);
  assert.match(metrics.render(), /giro_timeouts_total\{category="clone"\} 1/);
  assert.match(metrics.render(), /giro_timeouts_total\{category="indexing"\} 0/);
});

test("labels use route templates and never include request data", async () => {
  const metrics = new MetricsRegistry();
  const app = new Hono();
  app.use("*", createMetricsMiddleware(metrics, { monotonicNow: () => 1_000 }));
  app.get("/items/:id", (c) => c.text(c.req.param("id")));
  await app.request("/items/private-repository?query=secret");
  const output = metrics.render();

  assert.match(output, /route="\/items\/:id"/);
  assert.equal(output.includes("private-repository"), false);
  assert.equal(output.includes("secret"), false);
});

test("rejects unsafe histogram bucket configuration", () => {
  assert.throws(() => new MetricsRegistry({ durationBucketsSeconds: [] }));
  assert.throws(() => new MetricsRegistry({ durationBucketsSeconds: [1, 0.5] }));
  assert.throws(() => new MetricsRegistry({ durationBucketsSeconds: [Number.NaN] }));
});

test("circuit metrics expose one active state per dependency", () => {
  const metrics = new MetricsRegistry();
  metrics.setCircuitState("database", "open");
  metrics.incrementCircuitTransition("database", "closed", "open");
  metrics.incrementCircuitRejection("database");
  const output = metrics.render();
  assert.match(output, /giro_circuit_state\{dependency="database",state="closed"\} 0/);
  assert.match(output, /giro_circuit_state\{dependency="database",state="open"\} 1/);
  assert.match(output, /giro_circuit_state\{dependency="database",state="half_open"\} 0/);
  assert.match(output, /giro_circuit_transitions_total\{dependency="database",from="closed",to="open"\} 1/);
  assert.match(output, /giro_circuit_rejections_total\{dependency="database"\} 1/);
});

test("worker functional readiness metrics expose failures, timestamps, stall, and transitions", () => {
  const metrics = new MetricsRegistry();
  metrics.recordWorkerDatabaseFailure(2);
  metrics.recordWorkerDatabaseSuccess("poll", 1_700_000_000_000);
  metrics.recordWorkerDatabaseSuccess("claim", 1_700_000_001_000);
  metrics.setWorkerStalled(true);
  metrics.setReadiness(true);
  metrics.setReadiness(false);
  const output = metrics.render();

  assert.match(output, /giro_worker_database_failures_total 1/);
  assert.match(output, /giro_worker_consecutive_database_failures 0/);
  assert.match(output, /giro_worker_last_successful_poll_timestamp_seconds 1700000000/);
  assert.match(output, /giro_worker_last_successful_claim_timestamp_seconds 1700000001/);
  assert.match(output, /giro_worker_stalled 1/);
  assert.match(output, /giro_readiness_transitions_total 1/);
});
