import test from "node:test";
import assert from "node:assert/strict";
import { buildRepositoryArchitectureSummary } from "../services/repository/repositoryArchitectureSummary.js";
import type { DependencyGraph } from "../services/graph/types.js";

// Minimal valid DependencyGraph fixture. The summary reads only nodes/edges,
// so stats/insights are stubbed (cast through unknown — no `any`).
function graph(
  filePaths: string[],
  edges: Array<{ from: string; to: string }>,
): DependencyGraph {
  return {
    nodes: filePaths.map((filePath) => ({ filePath })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, importedSymbols: [] })),
    stats: {},
    insights: {},
  } as unknown as DependencyGraph;
}

// Build N edges that all reference the first two files (count is what matters).
function nEdges(n: number, from: string, to: string): Array<{ from: string; to: string }> {
  return Array.from({ length: n }, () => ({ from, to }));
}

function nFiles(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `src/f${i}.ts`);
}

test("1. empty graph -> all zeros, avg 0, complexity low", () => {
  const summary = buildRepositoryArchitectureSummary(graph([], []));
  assert.deepEqual(summary, {
    totalFiles: 0,
    totalDependencies: 0,
    averageDependenciesPerFile: 0,
    isolatedFiles: 0,
    connectedFiles: 0,
    architectureComplexity: "low",
  });
});

test("2. single-node graph with no edges", () => {
  const summary = buildRepositoryArchitectureSummary(graph(["src/a.ts"], []));
  assert.equal(summary.totalFiles, 1);
  assert.equal(summary.totalDependencies, 0);
  assert.equal(summary.averageDependenciesPerFile, 0);
  assert.equal(summary.connectedFiles, 0);
  assert.equal(summary.isolatedFiles, 1);
  assert.equal(summary.architectureComplexity, "low");
});

test("3. low-complexity graph", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(["a", "b", "c"], [{ from: "a", to: "b" }]),
  );
  assert.equal(summary.architectureComplexity, "low"); // 1/3 = 0.33
});

test("4. medium-complexity graph", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(nFiles(10), nEdges(30, "src/f0.ts", "src/f1.ts")),
  );
  assert.equal(summary.averageDependenciesPerFile, 3);
  assert.equal(summary.architectureComplexity, "medium");
});

test("5. high-complexity graph", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(nFiles(10), nEdges(60, "src/f0.ts", "src/f1.ts")),
  );
  assert.equal(summary.averageDependenciesPerFile, 6);
  assert.equal(summary.architectureComplexity, "high");
});

test("6. connected-file counting", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(["a", "b", "c"], [{ from: "a", to: "b" }]),
  );
  assert.equal(summary.connectedFiles, 2); // a and b participate
});

test("7. isolated-file counting", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(["a", "b", "c", "d"], [{ from: "a", to: "b" }]),
  );
  assert.equal(summary.connectedFiles, 2);
  assert.equal(summary.isolatedFiles, 2); // c and d isolated
});

test("8. average rounding: 1 edge / 3 files -> 0.33", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(["a", "b", "c"], [{ from: "a", to: "b" }]),
  );
  assert.equal(summary.averageDependenciesPerFile, 0.33);
});

test("9. determinism across repeated calls", () => {
  const g = graph(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]);
  assert.deepEqual(
    buildRepositoryArchitectureSummary(g),
    buildRepositoryArchitectureSummary(g),
  );
});

test("10. input immutability", () => {
  const g = graph(["b", "a"], [{ from: "a", to: "b" }]);
  const snapshot = JSON.parse(JSON.stringify(g));
  buildRepositoryArchitectureSummary(g);
  assert.deepEqual(g, snapshot);
});

test("11. large graph handling", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(nFiles(1000), nEdges(2500, "src/f0.ts", "src/f1.ts")),
  );
  assert.equal(summary.totalFiles, 1000);
  assert.equal(summary.totalDependencies, 2500);
  assert.equal(summary.averageDependenciesPerFile, 2.5);
  assert.equal(summary.architectureComplexity, "medium");
});

test("12. exact boundaries: 1.99->low, 2.00->medium, 4.99->medium, 5.00->high", () => {
  const at = (edges: number) =>
    buildRepositoryArchitectureSummary(graph(nFiles(100), nEdges(edges, "src/f0.ts", "src/f1.ts")));
  assert.equal(at(199).averageDependenciesPerFile, 1.99);
  assert.equal(at(199).architectureComplexity, "low");
  assert.equal(at(200).averageDependenciesPerFile, 2);
  assert.equal(at(200).architectureComplexity, "medium");
  assert.equal(at(499).averageDependenciesPerFile, 4.99);
  assert.equal(at(499).architectureComplexity, "medium");
  assert.equal(at(500).averageDependenciesPerFile, 5);
  assert.equal(at(500).architectureComplexity, "high");
});

test("13. edge endpoints missing from node set do not inflate connectedFiles", () => {
  const summary = buildRepositoryArchitectureSummary(
    graph(["a", "b"], [{ from: "a", to: "ghost" }, { from: "phantom", to: "void" }]),
  );
  // only "a" is both a node and an edge participant
  assert.equal(summary.connectedFiles, 1);
  assert.equal(summary.isolatedFiles, 1);
  assert.ok(summary.connectedFiles <= summary.totalFiles);
});

test("14. no NaN or Infinity values appear in output", () => {
  for (const g of [graph([], []), graph(["a"], []), graph(nFiles(3), nEdges(7, "src/f0.ts", "src/f1.ts"))]) {
    const summary = buildRepositoryArchitectureSummary(g);
    for (const v of Object.values(summary)) {
      if (typeof v === "number") {
        assert.ok(Number.isFinite(v), `non-finite value: ${v}`);
      }
    }
  }
});
