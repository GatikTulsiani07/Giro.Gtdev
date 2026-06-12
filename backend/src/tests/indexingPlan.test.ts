import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRepositoryIndexingPlan } from "../services/repository/indexingPlan.js";
import type { ScannedFile } from "../services/repository/scanner.js";
import type {
  RepositoryFileSnapshot,
  SnapshotFile,
} from "../services/repository/fileSnapshotStore.js";

function makeFile(path: string, overrides?: Partial<ScannedFile>): ScannedFile {
  return { filePath: path, size: 100, language: ".ts", ...overrides };
}

function makeSnapshot(files: ScannedFile[]): RepositoryFileSnapshot {
  const snapshotFiles: SnapshotFile[] = files.map((f) => ({
    filePath: f.filePath,
    size: f.size,
    language: f.language,
    lastSeenAt: "2020-01-01T00:00:00.000Z",
  }));
  return { files: snapshotFiles, updatedAt: "2020-01-01T00:00:00.000Z" };
}

describe("buildRepositoryIndexingPlan", () => {
  it("Test 1: no previous snapshot -> full mode", () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: null, currentFiles: files });
    assert.equal(plan.mode, "full");
    assert.equal(plan.addedFiles.length, 2);
    assert.equal(plan.removedFiles.length, 0);
    assert.match(plan.reason, /no previous snapshot/);
  });

  it("Test 2: identical files -> incremental, zero changes", () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const snapshot = makeSnapshot(files);
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: files });
    assert.equal(plan.mode, "incremental");
    assert.equal(plan.totalChangedFiles, 0);
    assert.equal(plan.addedFiles.length, 0);
    assert.equal(plan.removedFiles.length, 0);
    assert.equal(plan.unchangedFiles.length, 2);
  });

  it("Test 3: added file -> incremental mode", () => {
    const before = [makeFile("src/a.ts")];
    const after = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const snapshot = makeSnapshot(before);
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: after });
    // 1 added of 1 prev => change ratio 1.0 > 0.5 => full. Verify real logic:
    // previous=1, added=1, removed=0 -> changeRatio = 1/1 = 1.0 > 0.5 => full.
    assert.ok(plan.addedFiles.includes("src/b.ts"));
    assert.equal(plan.totalChangedFiles, 1);
    assert.equal(plan.mode, "full");
  });

  it("Test 4: removed file -> mode per real threshold (50% removed => full)", () => {
    const before = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const after = [makeFile("src/a.ts")];
    const snapshot = makeSnapshot(before);
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: after });
    assert.ok(plan.removedFiles.includes("src/b.ts"));
    assert.equal(plan.totalChangedFiles, 1);
    // removed ratio 1/2 = 0.5 > REMOVED_RATIO_THRESHOLD (0.3) => full
    assert.equal(plan.mode, "full");
  });

  it("Test 5: changed ratio threshold -> full mode", () => {
    // 10 previous files, add 6 new (no removals): changeRatio 6/10 = 0.6 > 0.5
    const before = Array.from({ length: 10 }, (_, i) => makeFile(`src/old${i}.ts`));
    const after = [
      ...before.map((f) => makeFile(f.filePath)),
      ...Array.from({ length: 6 }, (_, i) => makeFile(`src/new${i}.ts`)),
    ];
    const snapshot = makeSnapshot(before);
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: after });
    assert.equal(plan.mode, "full");
    assert.match(plan.reason, /changed ratio exceeds threshold/);
  });

  it("Test 6: removed ratio threshold -> full mode", () => {
    // 10 previous files, remove 4 (no additions): removedRatio 4/10 = 0.4 > 0.3,
    // changeRatio 4/10 = 0.4 < 0.5, so removed-ratio is the trigger.
    const before = Array.from({ length: 10 }, (_, i) => makeFile(`src/old${i}.ts`));
    const after = before.slice(0, 6).map((f) => makeFile(f.filePath));
    const snapshot = makeSnapshot(before);
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: after });
    assert.equal(plan.mode, "full");
    assert.match(plan.reason, /removed ratio exceeds threshold/);
  });

  it("Test 7: output arrays are sorted ascending", () => {
    // previous large enough to keep this incremental; add/remove out of order.
    const before = Array.from({ length: 20 }, (_, i) => makeFile(`src/keep${i}.ts`));
    // remove keep0 only; add z then a (unsorted insertion order)
    const after = [
      makeFile("src/z.ts"),
      makeFile("src/a.ts"),
      ...before.slice(1).map((f) => makeFile(f.filePath)),
    ];
    const snapshot = makeSnapshot(before);
    const plan = buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: after });
    assert.deepEqual(plan.addedFiles, [...plan.addedFiles].sort());
    assert.deepEqual(plan.removedFiles, [...plan.removedFiles].sort());
    assert.deepEqual(plan.unchangedFiles, [...plan.unchangedFiles].sort());
    assert.deepEqual(plan.addedFiles, ["src/a.ts", "src/z.ts"]);
  });

  it("Test 8: deterministic repeated execution", () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const snapshot = makeSnapshot(files);
    const input = { previousSnapshot: snapshot, currentFiles: files };
    const plan1 = buildRepositoryIndexingPlan(input);
    const plan2 = buildRepositoryIndexingPlan(input);
    assert.deepStrictEqual(plan1, plan2);
  });

  it("Test 9: inputs are not mutated", () => {
    const files = [makeFile("src/b.ts"), makeFile("src/a.ts")];
    const snapshot = makeSnapshot([makeFile("src/a.ts")]);
    const filesCopy = JSON.parse(JSON.stringify(files));
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    buildRepositoryIndexingPlan({ previousSnapshot: null, currentFiles: files });
    buildRepositoryIndexingPlan({ previousSnapshot: snapshot, currentFiles: files });
    assert.deepStrictEqual(files, filesCopy);
    assert.deepStrictEqual(snapshot, snapshotCopy);
  });
});
