import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Hono } from "hono";
import { createLogger } from "../lib/logger.js";
import {
  createRequestContextMiddleware,
  type RequestContextVariables,
} from "../middleware/requestContext.js";
import {
  currentTraceContext,
  parseTraceparent,
  TRACEPARENT_HEADER,
} from "../observability/tracing.js";
import { MemoryIndexingJobStore } from "../services/indexing/jobs/memoryIndexingJobStore.js";
import { processNextIndexingJob } from "../services/indexing/jobs/indexingJobWorker.js";
import { setRepositoryOwner } from "../services/repository/ownershipStore.js";

const TRACE_ID = "11111111111111111111111111111111";
const PARENT_SPAN_ID = "2222222222222222";
const SERVER_SPAN_ID = "3333333333333333";
const NEW_TRACE_ID = "44444444444444444444444444444444";

function tracingApp(options: {
  generateTraceId?: () => string;
  generateSpanId?: () => string;
} = {}) {
  const app = new Hono<{ Variables: RequestContextVariables }>();
  app.use("*", createRequestContextMiddleware({
    generateRequestId: () => "request-1",
    generateTraceId: options.generateTraceId ?? (() => NEW_TRACE_ID),
    generateSpanId: options.generateSpanId ?? (() => SERVER_SPAN_ID),
    monotonicNow: () => 1,
    logger: { info: () => undefined, error: () => undefined },
  }));
  app.get("/trace", (c) => c.json({
    traceId: c.get("traceId"),
    spanId: c.get("spanId"),
    requestId: c.get("requestId"),
  }));
  return app;
}

test("incoming W3C traceparent reuses its trace and creates a server span", async () => {
  const response = await tracingApp().request("/trace", {
    headers: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` },
  });

  assert.deepEqual(await response.json(), {
    traceId: TRACE_ID,
    spanId: SERVER_SPAN_ID,
    requestId: "request-1",
  });
  assert.equal(
    response.headers.get(TRACEPARENT_HEADER),
    `00-${TRACE_ID}-${SERVER_SPAN_ID}-01`,
  );
});

test("missing trace context generates a new trace independent of request ID", async () => {
  const response = await tracingApp().request("/trace");
  assert.deepEqual(await response.json(), {
    traceId: NEW_TRACE_ID,
    spanId: SERVER_SPAN_ID,
    requestId: "request-1",
  });
  assert.equal(
    response.headers.get(TRACEPARENT_HEADER),
    `00-${NEW_TRACE_ID}-${SERVER_SPAN_ID}-01`,
  );
});

test("malformed traceparent values are rejected and replaced", async () => {
  for (const malformed of [
    "not-a-trace",
    `00-${"0".repeat(32)}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID}-${"0".repeat(16)}-01`,
    `ff-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID}-${PARENT_SPAN_ID}-01-extra`,
  ]) {
    assert.equal(parseTraceparent(malformed), null);
    const response = await tracingApp().request("/trace", {
      headers: { traceparent: malformed },
    });
    const body = await response.json() as { traceId: string };
    assert.equal(body.traceId, NEW_TRACE_ID);
  }
});

test("trace context propagates across middleware and repository-style async service work", async () => {
  const observed: Array<ReturnType<typeof currentTraceContext>> = [];
  const repositoryService = async () => {
    await Promise.resolve();
    observed.push(currentTraceContext());
  };
  const app = tracingApp();
  app.get("/service", async (c) => {
    await repositoryService();
    return c.text("ok");
  });

  await app.request("/service", {
    headers: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` },
  });
  assert.equal(observed[0]?.traceId, TRACE_ID);
  assert.equal(observed[0]?.spanId, SERVER_SPAN_ID);
});

test("structured logs automatically include traceId and spanId", async () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line), { level: "debug" });
  const app = new Hono<{ Variables: RequestContextVariables }>();
  app.use("*", createRequestContextMiddleware({
    logger,
    generateRequestId: () => "logged-request",
    generateTraceId: () => NEW_TRACE_ID,
    generateSpanId: () => SERVER_SPAN_ID,
    monotonicNow: () => 1,
  }));
  app.get("/work", (c) => {
    logger.info("repository_service_work");
    return c.text("ok");
  });

  await app.request("/work");
  const entry = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((candidate) => candidate.operation === "repository_service_work");
  assert.equal(entry?.requestId, "logged-request");
  assert.equal(entry?.traceId, NEW_TRACE_ID);
  assert.equal(entry?.spanId, SERVER_SPAN_ID);
});

test("indexing workers continue the queued trace with a new worker span", async () => {
  const store = new MemoryIndexingJobStore();
  await store.createJob({
    repositoryId: "acme/traced-worker",
    ownerUserId: "worker-user",
    repositoryOwner: "acme",
    repositoryName: "traced-worker",
    repositoryUrl: "https://github.com/acme/traced-worker",
    createdByRequestId: "origin-request",
    createdByTraceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
  });
  setRepositoryOwner("acme/traced-worker", "worker-user");
  let pipelineTrace: ReturnType<typeof currentTraceContext>;
  const logs: Array<Record<string, unknown> | undefined> = [];

  await processNextIndexingJob({
    workerId: "traced-worker-1",
    jobStore: store,
    executeIndexingPipeline: async () => {
      pipelineTrace = currentTraceContext();
      return {
        counts: {
          chunkCount: 0,
          fileCount: 0,
          symbolCount: 0,
          graphNodeCount: 0,
          graphEdgeCount: 0,
          summaryAvailable: false,
        },
      };
    },
    logger: {
      info: (_event, fields) => logs.push(fields),
      error: (_event, fields) => logs.push(fields),
    },
  });

  assert.equal(pipelineTrace?.traceId, TRACE_ID);
  assert.notEqual(pipelineTrace?.spanId, PARENT_SPAN_ID);
  assert.ok(logs.every((fields) => fields?.traceId === TRACE_ID));
  assert.ok(logs.every((fields) => fields?.spanId === pipelineTrace?.spanId));
  assert.ok(logs.every((fields) => fields?.requestId === "origin-request"));
});

test("concurrent requests keep trace context isolated", async () => {
  let nextSpan = 1;
  const app = new Hono<{ Variables: RequestContextVariables }>();
  app.use("*", createRequestContextMiddleware({
    generateRequestId: () => "generated-request",
    generateSpanId: () => (nextSpan++).toString(16).padStart(16, "0"),
    logger: { info: () => undefined, error: () => undefined },
  }));
  app.get("/isolated/:wait", async (c) => {
    const before = currentTraceContext();
    await delay(Number(c.req.param("wait")));
    const after = currentTraceContext();
    return c.json({ before, after });
  });

  const [first, second] = await Promise.all([
    app.request("/isolated/15", {
      headers: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` },
    }),
    app.request("/isolated/1", {
      headers: { traceparent: `00-${NEW_TRACE_ID}-${PARENT_SPAN_ID}-01` },
    }),
  ]);
  const firstBody = await first.json() as { before: { traceId: string }; after: { traceId: string } };
  const secondBody = await second.json() as { before: { traceId: string }; after: { traceId: string } };
  assert.equal(firstBody.before.traceId, TRACE_ID);
  assert.equal(firstBody.after.traceId, TRACE_ID);
  assert.equal(secondBody.before.traceId, NEW_TRACE_ID);
  assert.equal(secondBody.after.traceId, NEW_TRACE_ID);
});
