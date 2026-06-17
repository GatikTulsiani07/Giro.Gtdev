import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGraphTraversalWeight,
  rankFilesByGraphTraversalWeight,
} from "../services/retrieval/graphTraversalWeighting.js";

type Edge = { from: string; to: string };

// Chain a-b-c-d-e-f (undirected) for distance testing.
const chain: Edge[] = [
  { from: "a", to: "b" },
  { from: "b", to: "c" },
  { from: "c", to: "d" },
  { from: "d", to: "e" },
  { from: "e", to: "f" },
];

function calc(filePath: string, seedFiles: string[], edges: Edge[]) {
  return calculateGraphTraversalWeight({ filePath, seedFiles, dependencyEdges: edges });
}

test("1. seed -> weight 1, distance 0", () => {
  const r = calc("a", ["a"], chain);
  assert.deepEqual(r, { filePath: "a", distance: 0, weight: 1, reason: "seed" });
});

test("2. direct neighbor -> weight 0.75, distance 1", () => {
  const r = calc("b", ["a"], chain);
  assert.equal(r.distance, 1);
  assert.equal(r.weight, 0.75);
  assert.equal(r.reason, "direct_neighbor");
});

test("3. distance 2 -> weight 0.5", () => {
  const r = calc("c", ["a"], chain);
  assert.equal(r.distance, 2);
  assert.equal(r.weight, 0.5);
  assert.equal(r.reason, "nearby_dependency");
});

test("4. distance 3 -> weight 0.5", () => {
  const r = calc("d", ["a"], chain);
  assert.equal(r.distance, 3);
  assert.equal(r.weight, 0.5);
  assert.equal(r.reason, "nearby_dependency");
});

test("5. unreachable -> weight 0, distance null, unrelated", () => {
  const r = calc("z", ["a"], chain);
  assert.deepEqual(r, { filePath: "z", distance: null, weight: 0, reason: "unrelated" });
});

test("6. far-but-reachable (distance >= 4) -> weight 0, unrelated, numeric distance", () => {
  const r = calc("e", ["a"], chain); // a-b-c-d-e = distance 4
  assert.equal(r.distance, 4);
  assert.equal(r.weight, 0);
  assert.equal(r.reason, "unrelated");

  const r2 = calc("f", ["a"], chain); // distance 5
  assert.equal(r2.distance, 5);
  assert.equal(r2.weight, 0);
});

test("7. graph treated as undirected (reverse-direction edge still connects)", () => {
  // edge points b->a, but seed a should still reach b at distance 1
  const r = calc("b", ["a"], [{ from: "b", to: "a" }]);
  assert.equal(r.distance, 1);
  assert.equal(r.weight, 0.75);
});

test("8. shortest path wins when multiple paths exist", () => {
  // a-b-c-d (dist 3) AND a-d direct (dist 1)
  const edges: Edge[] = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "a", to: "d" },
  ];
  const r = calc("d", ["a"], edges);
  assert.equal(r.distance, 1);
});

test("9. duplicate edges do not affect the result", () => {
  const edges: Edge[] = [
    { from: "a", to: "b" },
    { from: "a", to: "b" },
    { from: "b", to: "a" },
  ];
  const r = calc("b", ["a"], edges);
  assert.equal(r.distance, 1);
});

test("10. invalid/empty edges are ignored", () => {
  const edges: Edge[] = [
    { from: "", to: "b" },
    { from: "a", to: "" },
    { from: "a", to: "a" }, // self-loop
    { from: "a", to: "b" },
  ];
  const r = calc("b", ["a"], edges);
  assert.equal(r.distance, 1);
});

test("11. duplicate seed files handled (dedup)", () => {
  const r = calc("b", ["a", "a", "a"], chain);
  assert.equal(r.distance, 1);
  assert.equal(r.weight, 0.75);
});

test("12. rankFilesByGraphTraversalWeight sorts deterministically", () => {
  const ranked = rankFilesByGraphTraversalWeight(["f", "z", "c", "b", "a", "e"], ["a"], chain);
  assert.deepEqual(
    ranked.map((r) => r.filePath),
    // a(0,w1), b(1,w.75), c(2,w.5), then weight-0: e(4) and f(5) numeric before z(null)
    ["a", "b", "c", "e", "f", "z"],
  );
});

test("13. input arrays are not mutated", () => {
  const filePaths = ["b", "a"];
  const seeds = ["a", "a"];
  const edges: Edge[] = [{ from: "a", to: "b" }];
  const fpCopy = [...filePaths];
  const sCopy = [...seeds];
  const eCopy = JSON.parse(JSON.stringify(edges));
  rankFilesByGraphTraversalWeight(filePaths, seeds, edges);
  assert.deepEqual(filePaths, fpCopy);
  assert.deepEqual(seeds, sCopy);
  assert.deepEqual(edges, eCopy);
});

test("14. repeated calls return deepEqual results", () => {
  const first = rankFilesByGraphTraversalWeight(["a", "b", "c", "z"], ["a"], chain);
  const second = rankFilesByGraphTraversalWeight(["a", "b", "c", "z"], ["a"], chain);
  assert.deepEqual(first, second);
});

test("15. empty seedFiles -> all files unrelated", () => {
  const ranked = rankFilesByGraphTraversalWeight(["a", "b", "c"], [], chain);
  assert.ok(ranked.every((r) => r.weight === 0 && r.distance === null && r.reason === "unrelated"));
});

test("16. empty dependencyEdges -> only seeds get weight 1; all returned, seeds first", () => {
  const ranked = rankFilesByGraphTraversalWeight(["b", "a", "c"], ["a"], []);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0]?.filePath, "a");
  assert.equal(ranked[0]?.weight, 1);
  assert.ok(ranked.slice(1).every((r) => r.weight === 0 && r.reason === "unrelated"));
});
