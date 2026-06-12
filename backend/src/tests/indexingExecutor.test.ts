import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeIndexingPlan,
  selectFilesForIndexing,
} from "../services/repository/indexingExecutor.js";
import type { ScannedFile } from "../services/repository/scanner.js";
import type { RepositoryIndexingPlan } from "../services/repository/indexingPlan.js";

function makeFile(path: string): ScannedFile {
  return { filePath: path, size: 100, language: ".ts" };
}

function fullPlan(paths: string[]): RepositoryIndexingPlan {
  return {
    mode: "full",
    addedFiles: [...paths].sort(),
    removedFiles: [],
    unchangedFiles: [],
    totalChangedFiles: paths.length,
    reason: "no previous snapshot",
  };
}

function incrementalPlan(added: string[], unchanged: string[]): RepositoryIndexingPlan {
  return {
    mode: "incremental",
    addedFiles: [...added].sort(),
    removedFiles: [],
    unchangedFiles: [...unchanged].sort(),
    totalChangedFiles: added.length,
    reason: `incremental: ${added.length} file(s) changed`,
  };
}

describe("executeIndexingPlan", () => {
  it("full mode analyzes all files", async () => {
    const files = [makeFile("src/b.ts"), makeFile("src/a.ts"), makeFile("src/c.ts")];
    const analyzed: string[] = [];
    const exec = await executeIndexingPlan({
      plan: fullPlan(files.map((f) => f.filePath)),
      currentFiles: files,
      analyzeFile: (f) => {
        analyzed.push(f.filePath);
        return f.filePath;
      },
    });
    assert.equal(exec.mode, "full");
    assert.deepEqual(exec.analyzedFiles, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    assert.deepEqual(exec.skippedFiles, []);
    assert.deepEqual(analyzed, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    assert.deepEqual(exec.results, ["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("incremental mode analyzes only changed files, skips unchanged", async () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts"), makeFile("src/new.ts")];
    const analyzed: string[] = [];
    const exec = await executeIndexingPlan({
      plan: incrementalPlan(["src/new.ts"], ["src/a.ts", "src/b.ts"]),
      currentFiles: files,
      analyzeFile: (f) => {
        analyzed.push(f.filePath);
        return f.filePath;
      },
    });
    assert.equal(exec.mode, "incremental");
    assert.deepEqual(exec.analyzedFiles, ["src/new.ts"]);
    assert.deepEqual(exec.skippedFiles, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(analyzed, ["src/new.ts"]);
  });

  it("empty incremental plan analyzes nothing and does not crash", async () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    let calls = 0;
    const exec = await executeIndexingPlan({
      plan: incrementalPlan([], ["src/a.ts", "src/b.ts"]),
      currentFiles: files,
      analyzeFile: () => {
        calls += 1;
        return null;
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(exec.analyzedFiles, []);
    assert.deepEqual(exec.skippedFiles, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(exec.results, []);
  });

  it("execution is deterministic across repeated runs", async () => {
    const files = [makeFile("src/z.ts"), makeFile("src/a.ts"), makeFile("src/m.ts")];
    const plan = incrementalPlan(["src/z.ts", "src/a.ts"], ["src/m.ts"]);
    const first = await executeIndexingPlan({ plan, currentFiles: files, analyzeFile: (f) => f.filePath });
    const second = await executeIndexingPlan({ plan, currentFiles: files, analyzeFile: (f) => f.filePath });
    assert.deepEqual(first, second);
    assert.deepEqual(first.analyzedFiles, ["src/a.ts", "src/z.ts"]);
  });

  it("does not mutate inputs", async () => {
    const files = [makeFile("src/b.ts"), makeFile("src/a.ts")];
    const plan = incrementalPlan(["src/a.ts"], ["src/b.ts"]);
    const filesCopy = JSON.parse(JSON.stringify(files));
    const planCopy = JSON.parse(JSON.stringify(plan));
    await executeIndexingPlan({ plan, currentFiles: files, analyzeFile: (f) => f.filePath });
    assert.deepEqual(files, filesCopy);
    assert.deepEqual(plan, planCopy);
  });

  it("selectFilesForIndexing returns sorted full set for full mode", () => {
    const files = [makeFile("src/b.ts"), makeFile("src/a.ts")];
    const selected = selectFilesForIndexing(fullPlan(["src/a.ts", "src/b.ts"]), files);
    assert.deepEqual(selected.map((f) => f.filePath), ["src/a.ts", "src/b.ts"]);
  });
});
