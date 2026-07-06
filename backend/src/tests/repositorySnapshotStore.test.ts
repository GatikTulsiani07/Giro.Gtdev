import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  clearSnapshotStore,
  compareLatestSnapshots,
  getLatestSnapshot,
  getSnapshot,
  listAllSnapshots,
  listSnapshots,
  registerSnapshot,
  removeSnapshots,
} from "../services/repository/repositorySnapshotStore.js";

interface TestReport {
  summary: string;
  metrics: {
    score: number;
    tags: string[];
  };
}

function report(summary: string, score: number): TestReport {
  return {
    summary,
    metrics: {
      score,
      tags: ["typescript", summary],
    },
  };
}

beforeEach(() => {
  clearSnapshotStore();
});

test("empty store returns nulls and empty lists", () => {
  assert.equal(getSnapshot("missing#1"), null);
  assert.equal(getLatestSnapshot("acme/demo"), null);
  assert.equal(compareLatestSnapshots("acme/demo"), null);
  assert.deepEqual(listSnapshots("acme/demo"), []);
  assert.deepEqual(listAllSnapshots(), []);
});

test("register snapshot returns deterministic immutable model", () => {
  const snapshot = registerSnapshot("acme/demo", report("first", 80));

  assert.deepEqual(snapshot, {
    snapshotId: "acme/demo#1",
    repositoryId: "acme/demo",
    sequence: 1,
    report: {
      summary: "first",
      metrics: {
        score: 80,
        tags: ["typescript", "first"],
      },
    },
    createdOrder: 1,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.report), true);
  assert.equal(Object.isFrozen(snapshot.report.metrics.tags), true);
});

test("sequence increments per repository", () => {
  const first = registerSnapshot("acme/demo", report("first", 80));
  const second = registerSnapshot("acme/demo", report("second", 85));
  const other = registerSnapshot("beta/demo", report("other", 90));

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(other.sequence, 1);
  assert.equal(second.snapshotId, "acme/demo#2");
  assert.equal(other.snapshotId, "beta/demo#1");
  assert.equal(other.createdOrder, 3);
});

test("get snapshot returns snapshot by id", () => {
  const registered = registerSnapshot("acme/demo", report("first", 80));

  assert.deepEqual(getSnapshot(registered.snapshotId), registered);
  assert.equal(getSnapshot("acme/demo#2"), null);
});

test("latest snapshot returns highest sequence for repository", () => {
  registerSnapshot("acme/demo", report("first", 80));
  const latest = registerSnapshot("acme/demo", report("second", 85));
  registerSnapshot("beta/demo", report("other", 90));

  assert.deepEqual(getLatestSnapshot("acme/demo"), latest);
});

test("list by repository returns sequence order only for that repository", () => {
  const first = registerSnapshot("acme/demo", report("first", 80));
  registerSnapshot("beta/demo", report("other", 90));
  const second = registerSnapshot("acme/demo", report("second", 85));

  assert.deepEqual(listSnapshots("acme/demo"), [first, second]);
});

test("list all snapshots is sorted by repositoryId then sequence", () => {
  const betaFirst = registerSnapshot("beta/demo", report("beta first", 90));
  const acmeFirst = registerSnapshot("acme/demo", report("acme first", 80));
  const betaSecond = registerSnapshot("beta/demo", report("beta second", 95));
  const acmeSecond = registerSnapshot("acme/demo", report("acme second", 85));

  assert.deepEqual(listAllSnapshots(), [
    acmeFirst,
    acmeSecond,
    betaFirst,
    betaSecond,
  ]);
});

test("compare latest two snapshots returns previous and current", () => {
  registerSnapshot("acme/demo", report("first", 80));
  const previous = registerSnapshot("acme/demo", report("second", 85));
  const current = registerSnapshot("acme/demo", report("third", 90));

  assert.deepEqual(compareLatestSnapshots("acme/demo"), {
    previous,
    current,
  });
});

test("compare latest snapshots returns null when fewer than two exist", () => {
  registerSnapshot("acme/demo", report("first", 80));

  assert.equal(compareLatestSnapshots("acme/demo"), null);
});

test("remove snapshots removes one repository and leaves others intact", () => {
  registerSnapshot("acme/demo", report("first", 80));
  const other = registerSnapshot("beta/demo", report("other", 90));

  removeSnapshots("acme/demo");

  assert.deepEqual(listSnapshots("acme/demo"), []);
  assert.deepEqual(listAllSnapshots(), [other]);
});

test("remove unknown repository does not throw", () => {
  const snapshot = registerSnapshot("acme/demo", report("first", 80));

  assert.doesNotThrow(() => removeSnapshots("unknown/repo"));
  assert.deepEqual(listAllSnapshots(), [snapshot]);
});

test("clear store removes snapshots and resets deterministic counters", () => {
  registerSnapshot("acme/demo", report("first", 80));
  registerSnapshot("beta/demo", report("other", 90));

  clearSnapshotStore();

  assert.deepEqual(listAllSnapshots(), []);
  assert.deepEqual(registerSnapshot("acme/demo", report("first", 80)), {
    snapshotId: "acme/demo#1",
    repositoryId: "acme/demo",
    sequence: 1,
    report: report("first", 80),
    createdOrder: 1,
  });
});

test("defensive copy protects stored reports from input and returned mutations", () => {
  const input = report("first", 80);
  const snapshot = registerSnapshot("acme/demo", input);

  input.summary = "mutated input";
  input.metrics.score = 0;
  input.metrics.tags.push("mutated");

  assert.throws(() => {
    (snapshot.report as TestReport).summary = "mutated return";
  }, TypeError);
  assert.throws(() => {
    (snapshot.report.metrics.tags as string[]).push("mutated return");
  }, TypeError);

  assert.deepEqual(getSnapshot(snapshot.snapshotId)?.report, report("first", 80));
});

test("repeated reads produce stable output and isolated object identities", () => {
  registerSnapshot("beta/demo", report("beta first", 90));
  registerSnapshot("acme/demo", report("acme first", 80));
  registerSnapshot("acme/demo", report("acme second", 85));

  const firstRead = listAllSnapshots();
  const secondRead = listAllSnapshots();

  assert.deepEqual(firstRead, secondRead);
  assert.notEqual(firstRead, secondRead);
  assert.notEqual(firstRead[0], secondRead[0]);
  assert.deepEqual(listSnapshots("acme/demo"), listSnapshots("acme/demo"));
  assert.deepEqual(getLatestSnapshot("acme/demo"), getLatestSnapshot("acme/demo"));
});
