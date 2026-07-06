import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  getFirstSnapshot,
  getHistorySummary,
  getHistoryWindow,
  getLatestSnapshot,
  getRepositoryHistory,
} from "../services/repository/repositoryAnalysisHistory.js";
import {
  clearSnapshotStore,
  registerSnapshot,
} from "../services/repository/repositorySnapshotStore.js";

interface AnalysisReport {
  overview: string;
  health: {
    score: number;
    findings: string[];
  };
}

function report(overview: string, score: number): AnalysisReport {
  return {
    overview,
    health: {
      score,
      findings: [`${overview}-finding`],
    },
  };
}

beforeEach(() => {
  clearSnapshotStore();
});

test("empty history returns empty read models", () => {
  assert.deepEqual(getRepositoryHistory("acme/demo"), []);
  assert.deepEqual(getHistoryWindow("acme/demo", 2), []);
  assert.equal(getFirstSnapshot("acme/demo"), null);
  assert.equal(getLatestSnapshot("acme/demo"), null);
  assert.deepEqual(getHistorySummary("acme/demo"), {
    totalSnapshots: 0,
    firstSnapshotId: null,
    latestSnapshotId: null,
    repositoryId: "acme/demo",
    latestSequence: null,
    hasHistory: false,
  });
});

test("single snapshot history exposes first latest and summary", () => {
  const snapshot = registerSnapshot("acme/demo", report("first", 80));

  assert.deepEqual(getRepositoryHistory("acme/demo"), [snapshot]);
  assert.deepEqual(getFirstSnapshot("acme/demo"), snapshot);
  assert.deepEqual(getLatestSnapshot("acme/demo"), snapshot);
  assert.deepEqual(getHistorySummary("acme/demo"), {
    totalSnapshots: 1,
    firstSnapshotId: "acme/demo#1",
    latestSnapshotId: "acme/demo#1",
    repositoryId: "acme/demo",
    latestSequence: 1,
    hasHistory: true,
  });
});

test("multiple snapshots are returned in deterministic sequence order", () => {
  const first = registerSnapshot("acme/demo", report("first", 80));
  registerSnapshot("beta/demo", report("other", 90));
  const second = registerSnapshot("acme/demo", report("second", 85));
  const third = registerSnapshot("acme/demo", report("third", 95));

  assert.deepEqual(getRepositoryHistory("acme/demo"), [first, second, third]);
});

test("history window returns the latest limited snapshots in sequence order", () => {
  const first = registerSnapshot("acme/demo", report("first", 80));
  const second = registerSnapshot("acme/demo", report("second", 85));
  const third = registerSnapshot("acme/demo", report("third", 95));
  registerSnapshot("beta/demo", report("other", 90));

  assert.deepEqual(getHistoryWindow("acme/demo", 2), [second, third]);
  assert.deepEqual(getHistoryWindow("acme/demo", 10), [first, second, third]);
  assert.deepEqual(getHistoryWindow("acme/demo", 0), []);
  assert.deepEqual(getHistoryWindow("acme/demo", -1), []);
});

test("summary tracks first latest total and repository identity", () => {
  registerSnapshot("acme/demo", report("first", 80));
  registerSnapshot("acme/demo", report("second", 85));
  registerSnapshot("acme/demo", report("third", 95));

  const summary = getHistorySummary("acme/demo");

  assert.deepEqual(summary, {
    totalSnapshots: 3,
    firstSnapshotId: "acme/demo#1",
    latestSnapshotId: "acme/demo#3",
    repositoryId: "acme/demo",
    latestSequence: 3,
    hasHistory: true,
  });
  assert.equal(Object.isFrozen(summary), true);
});

test("latest snapshot returns the newest repository snapshot", () => {
  registerSnapshot("acme/demo", report("first", 80));
  const latest = registerSnapshot("acme/demo", report("second", 85));
  registerSnapshot("beta/demo", report("other", 90));

  assert.deepEqual(getLatestSnapshot("acme/demo"), latest);
});

test("first snapshot returns the earliest repository snapshot", () => {
  const first = registerSnapshot("acme/demo", report("first", 80));
  registerSnapshot("acme/demo", report("second", 85));

  assert.deepEqual(getFirstSnapshot("acme/demo"), first);
});

test("history outputs are defensive immutable copies", () => {
  const snapshot = registerSnapshot("acme/demo", report("first", 80));
  const history = getRepositoryHistory<AnalysisReport>("acme/demo");

  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(history[0]), true);
  assert.equal(Object.isFrozen(history[0]?.report.health.findings), true);
  assert.throws(() => {
    (history as unknown[]).push(snapshot);
  }, TypeError);
  assert.throws(() => {
    (history[0]!.report.health.findings as string[]).push("mutated");
  }, TypeError);

  assert.deepEqual(getRepositoryHistory("acme/demo"), [snapshot]);
});

test("repeated reads produce deterministic output with isolated identities", () => {
  registerSnapshot("beta/demo", report("other", 90));
  registerSnapshot("acme/demo", report("first", 80));
  registerSnapshot("acme/demo", report("second", 85));

  const firstRead = getRepositoryHistory("acme/demo");
  const secondRead = getRepositoryHistory("acme/demo");

  assert.deepEqual(firstRead, secondRead);
  assert.notEqual(firstRead, secondRead);
  assert.notEqual(firstRead[0], secondRead[0]);
  assert.deepEqual(getHistoryWindow("acme/demo", 2), getHistoryWindow("acme/demo", 2));
  assert.deepEqual(getHistorySummary("acme/demo"), getHistorySummary("acme/demo"));
});
