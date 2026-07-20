import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBackendShutdown,
  installShutdownSignalHandlers,
} from "../runtime/backendShutdown.js";
import type {
  ShutdownLogger,
  ShutdownResult,
  ShutdownSignal,
} from "../runtime/shutdownCoordinator.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function signalHarness() {
  const handlers = new Map<ShutdownSignal, () => void>();
  return {
    subscribe(signal: ShutdownSignal, handler: () => void) {
      handlers.set(signal, handler);
      return () => handlers.delete(signal);
    },
    send(signal: ShutdownSignal) {
      handlers.get(signal)?.();
    },
  };
}

function recordingLogger() {
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const record = (event: string, fields?: Record<string, unknown>) => {
    events.push({ event, fields });
  };
  const logger: ShutdownLogger = { info: record, warn: record, error: record };
  return { logger, events };
}

function installedRuntime(options: {
  signal?: ShutdownSignal;
  stopWorkers?: (signal: ShutdownSignal) => void | Promise<void>;
  closeDatabase?: () => void | Promise<void>;
  flushLogs?: () => void | Promise<void>;
  stopHttp?: () => void | Promise<void>;
  forceStop?: () => void | Promise<void>;
  setTimer?: (callback: () => void) => unknown;
}) {
  const signals = signalHarness();
  const exits: number[] = [];
  const forced: number[] = [];
  const { logger, events } = recordingLogger();
  let resolveResult!: (result: ShutdownResult) => void;
  const result = new Promise<ShutdownResult>((resolve) => { resolveResult = resolve; });
  const coordinator = createBackendShutdown({
    logger,
    timeoutMs: 5_000,
    stopAcceptingRequests: options.stopHttp ?? (() => undefined),
    stopIndexingWorkers: options.stopWorkers ?? (() => undefined),
    closeDatabase: options.closeDatabase ?? (() => undefined),
    flushLogs: options.flushLogs ?? (() => undefined),
    forceStop: options.forceStop,
    setTimer: options.setTimer,
    clearTimer: () => undefined,
  });
  const dispose = installShutdownSignalHandlers({
    coordinator,
    subscribe: signals.subscribe,
    setExitCode: (code) => exits.push(code),
    forceExit: (code) => forced.push(code),
    onResult: resolveResult,
  });
  if (options.signal) signals.send(options.signal);
  return { coordinator, dispose, events, exits, forced, result, signals };
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} runs HTTP, worker, database, and logger shutdown in order`, async () => {
    const order: string[] = [];
    const runtime = installedRuntime({
      signal,
      stopHttp: () => { order.push("http"); },
      stopWorkers: (received) => { order.push(`worker:${received}`); },
      closeDatabase: () => { order.push("database"); },
      flushLogs: () => { order.push("logs"); },
    });

    const result = await runtime.result;
    runtime.dispose();

    assert.deepEqual(order, ["http", `worker:${signal}`, "database", "logs", "logs"]);
    assert.deepEqual(result, { signal, outcome: "completed", exitCode: 0 });
    assert.deepEqual(runtime.exits, [0]);
    assert.deepEqual(runtime.forced, []);
    assert.equal(runtime.events.filter((entry) => entry.event === "shutdown_started").length, 1);
    assert.equal(runtime.events.filter((entry) => entry.event === "shutdown_completed").length, 1);
  });
}

test("multiple signals do not create concurrent shutdown executions", async () => {
  const active = deferred();
  let workerCalls = 0;
  const runtime = installedRuntime({
    stopWorkers: async () => {
      workerCalls += 1;
      await active.promise;
    },
  });

  runtime.signals.send("SIGINT");
  runtime.signals.send("SIGTERM");
  active.resolve();
  const result = await runtime.result;
  runtime.dispose();

  assert.equal(workerCalls, 1);
  assert.equal(result.signal, "SIGINT");
  assert.deepEqual(runtime.exits, [0]);
  assert.equal(runtime.events.filter((entry) => entry.event === "shutdown_already_in_progress").length, 1);
});

test("timeout force-closes resources, flushes logs, and exits one", async () => {
  const active = deferred();
  let timeout!: () => void;
  let forceCalls = 0;
  let flushCalls = 0;
  const runtime = installedRuntime({
    stopWorkers: () => active.promise,
    forceStop: () => { forceCalls += 1; },
    flushLogs: () => { flushCalls += 1; },
    setTimer: (callback) => {
      timeout = callback;
      return 1;
    },
  });

  runtime.signals.send("SIGTERM");
  timeout();
  const result = await runtime.result;
  active.resolve();
  runtime.dispose();

  assert.deepEqual(result, { signal: "SIGTERM", outcome: "timeout", exitCode: 1 });
  assert.equal(forceCalls, 1);
  assert.equal(flushCalls, 1);
  assert.deepEqual(runtime.exits, [1]);
  assert.deepEqual(runtime.forced, [1]);
  assert.equal(runtime.events.some((entry) => entry.event === "shutdown_forced_after_timeout"), true);
});

test("cleanup errors continue remaining cleanup and produce exit code one", async () => {
  let databaseCalls = 0;
  let flushCalls = 0;
  const runtime = installedRuntime({
    signal: "SIGINT",
    stopWorkers: () => { throw new Error("worker secret"); },
    closeDatabase: () => { databaseCalls += 1; },
    flushLogs: () => { flushCalls += 1; },
  });

  const result = await runtime.result;
  runtime.dispose();

  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 1);
  assert.equal(databaseCalls, 1);
  assert.equal(flushCalls, 2);
  assert.deepEqual(runtime.exits, [1]);
  assert.equal(runtime.events.some((entry) => entry.event === "shutdown_error"), true);
  assert.equal(JSON.stringify(runtime.events).includes("worker secret"), false);
});
