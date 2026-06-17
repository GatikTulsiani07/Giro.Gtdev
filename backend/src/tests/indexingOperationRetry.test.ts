// Operation-level retry-safe indexing tests. (Named distinctly to avoid
// clobbering the pre-existing file-level retrySafeIndexing.test.ts.)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  beginIndexingOperation,
  markStepCompleted,
  getIndexingOperation,
  clearIndexingOperations,
} from "../services/repository/indexingOperationStore.js";
import {
  planRetrySafeExecution,
  executeRetrySafeIndexing,
} from "../services/repository/retrySafeIndexingService.js";

beforeEach(() => {
  clearIndexingOperations();
});

test("1. beginIndexingOperation creates running op with sorted-unique totalSteps", () => {
  beginIndexingOperation("o/r", ["c", "a", "b", "a"]);
  const op = getIndexingOperation("o/r");
  assert.equal(op?.status, "running");
  assert.deepEqual(op?.totalSteps, ["a", "b", "c"]);
  assert.deepEqual(op?.completedSteps, []);
});

test("2. markStepCompleted is idempotent and ignores unknown steps", () => {
  beginIndexingOperation("o/r", ["a", "b"]);
  markStepCompleted("o/r", "a");
  markStepCompleted("o/r", "a"); // duplicate
  markStepCompleted("o/r", "zzz"); // not in totalSteps
  const op = getIndexingOperation("o/r");
  assert.deepEqual(op?.completedSteps, ["a"]);
});

test("3. planRetrySafeExecution resumable for running/failed; not absent/completed", () => {
  // absent
  assert.deepEqual(planRetrySafeExecution("o/missing"), {
    resumable: false,
    remainingSteps: [],
    completedSteps: [],
  });

  // running
  beginIndexingOperation("o/r", ["a", "b", "c"]);
  markStepCompleted("o/r", "a");
  const running = planRetrySafeExecution("o/r");
  assert.equal(running.resumable, true);
  assert.deepEqual(running.remainingSteps, ["b", "c"]);
  assert.deepEqual(running.completedSteps, ["a"]);

  // completed -> not resumable
  executeRetrySafeIndexing("o/r", () => {});
  assert.equal(getIndexingOperation("o/r")?.status, "completed");
  assert.deepEqual(planRetrySafeExecution("o/r"), {
    resumable: false,
    remainingSteps: [],
    completedSteps: [],
  });
});

test("4. partial-execution: throw marks failed; later run resumes remaining", () => {
  beginIndexingOperation("o/r", ["a", "b", "c"]);
  const calls: string[] = [];
  // throw on "b"
  executeRetrySafeIndexing("o/r", (step) => {
    if (step === "b") throw new Error("boom");
    calls.push(step);
  });
  let op = getIndexingOperation("o/r");
  assert.equal(op?.status, "failed");
  assert.deepEqual(op?.completedSteps, ["a"]); // a done, b failed before completion
  assert.deepEqual(calls, ["a"]);

  // retry: resume only b, c
  const resumeCalls: string[] = [];
  executeRetrySafeIndexing("o/r", (step) => resumeCalls.push(step));
  op = getIndexingOperation("o/r");
  assert.equal(op?.status, "completed");
  assert.deepEqual(resumeCalls, ["b", "c"]); // a NOT reprocessed
  assert.deepEqual(op?.completedSteps, ["a", "b", "c"]);
});

test("5. duplicate side-effect prevention: completed steps never re-run", () => {
  beginIndexingOperation("o/r", ["a", "b"]);
  markStepCompleted("o/r", "a");
  const calls: string[] = [];
  executeRetrySafeIndexing("o/r", (step) => calls.push(step));
  assert.deepEqual(calls, ["b"]); // "a" already completed
});

test("6. successful full execution -> completed, one call per step", () => {
  beginIndexingOperation("o/r", ["a", "b", "c"]);
  const calls: string[] = [];
  executeRetrySafeIndexing("o/r", (step) => calls.push(step));
  const op = getIndexingOperation("o/r");
  assert.equal(op?.status, "completed");
  assert.deepEqual(op?.completedSteps, ["a", "b", "c"]);
  assert.deepEqual(calls, ["a", "b", "c"]);
});

test("7. idempotency: re-run after completion is a no-op", () => {
  beginIndexingOperation("o/r", ["a", "b"]);
  executeRetrySafeIndexing("o/r", () => {});
  const before = getIndexingOperation("o/r");
  const calls: string[] = [];
  executeRetrySafeIndexing("o/r", (step) => calls.push(step));
  assert.deepEqual(calls, []);
  assert.deepEqual(getIndexingOperation("o/r"), before);
});

test("8. determinism: identical sequences yield deepEqual final state; sorted order", () => {
  const run = (repoId: string) => {
    beginIndexingOperation(repoId, ["c", "a", "b"]);
    const calls: string[] = [];
    executeRetrySafeIndexing(repoId, (step) => calls.push(step));
    return { op: getIndexingOperation(repoId), calls };
  };
  const a = run("o/a");
  const b = run("o/b");
  assert.deepEqual(a.calls, ["a", "b", "c"]); // sorted order
  assert.deepEqual(a.op?.completedSteps, b.op?.completedSteps);
  assert.deepEqual(a.op?.totalSteps, b.op?.totalSteps);
  assert.equal(a.op?.status, b.op?.status);
});

test("9. ownership isolation: operations for repoA never affect repoB", () => {
  beginIndexingOperation("o/a", ["a1", "a2"]);
  beginIndexingOperation("o/b", ["b1"]);
  const bBefore = getIndexingOperation("o/b");
  executeRetrySafeIndexing("o/a", () => {});
  assert.deepEqual(getIndexingOperation("o/b"), bBefore);
  assert.equal(getIndexingOperation("o/a")?.status, "completed");
});

test("10. empty totalSteps -> immediately completable, no runStep calls", () => {
  beginIndexingOperation("o/r", []);
  const calls: string[] = [];
  executeRetrySafeIndexing("o/r", (step) => calls.push(step));
  assert.deepEqual(calls, []);
  const op = getIndexingOperation("o/r");
  assert.equal(op?.status, "completed");
  assert.deepEqual(op?.completedSteps, []);
});

test("11. executeRetrySafeIndexing on absent operation is a safe no-op", () => {
  const calls: string[] = [];
  assert.doesNotThrow(() => executeRetrySafeIndexing("o/ghost", (s) => calls.push(s)));
  assert.deepEqual(calls, []);
  assert.equal(getIndexingOperation("o/ghost"), null);
});
