import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneRepo } from "../services/repository/clone.js";
import { MetricsRegistry } from "../observability/metrics.js";

test("clone uses the bounded remaining deadline and preserves timeout classification", async () => {
  const receivedTimeouts: number[] = [];
  await assert.rejects(
    cloneRepo("timeout-test-owner", "timeout-test-repo", {
      deadline: {
        signal: new AbortController().signal,
        remainingMs: () => 1_234,
        throwIfExpired: () => undefined,
        dispose: () => undefined,
      },
      executeClone: async (_url, _path, timeoutMs) => {
        receivedTimeouts.push(timeoutMs);
        throw new Error("operation timed out");
      },
      logger: { info: () => undefined },
      metrics: new MetricsRegistry(),
      retryRuntime: {
        random: () => 0.5,
        setTimer: (callback) => { callback(); return 1; },
        clearTimer: () => undefined,
      },
    }),
    /Clone failed: operation timed out/,
  );
  assert.deepEqual(receivedTimeouts, [617, 1_234]);
});
