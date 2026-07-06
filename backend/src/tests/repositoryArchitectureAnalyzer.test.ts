import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  addDependency,
  addNode,
  clear,
  listEdges,
  listNodes,
} from "../services/repository/repositoryDependencyGraph.js";
import * as graph from "../services/repository/repositoryDependencyGraph.js";
import { analyzeRepositoryArchitecture } from "../services/repository/repositoryArchitectureAnalyzer.js";

beforeEach(() => {
  clear();
});

describe("repository architecture analyzer", () => {
  it("analyzes an empty graph", () => {
    assert.deepEqual(analyzeRepositoryArchitecture(graph), {
      totalFiles: 0,
      totalDependencies: 0,
      rootModules: [],
      leafModules: [],
      isolatedModules: [],
      averageDependencies: 0,
      averageDependents: 0,
      mostConnectedModules: [],
      circularDependencyCount: 0,
      hasCycles: false,
      architectureComplexityScore: 0,
    });
  });

  it("identifies isolated modules", () => {
    addNode("src/a.ts");
    addNode("src/b.ts");

    const analysis = analyzeRepositoryArchitecture(graph);

    assert.deepEqual(analysis.isolatedModules, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(analysis.rootModules, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(analysis.leafModules, ["src/a.ts", "src/b.ts"]);
  });

  it("identifies root modules", () => {
    addDependency("src/app.ts", "src/service.ts");
    addDependency("src/service.ts", "src/store.ts");

    assert.deepEqual(analyzeRepositoryArchitecture(graph).rootModules, [
      "src/app.ts",
    ]);
  });

  it("identifies leaf modules", () => {
    addDependency("src/app.ts", "src/service.ts");
    addDependency("src/service.ts", "src/store.ts");

    assert.deepEqual(analyzeRepositoryArchitecture(graph).leafModules, [
      "src/store.ts",
    ]);
  });

  it("calculates dependency counts and averages", () => {
    addDependency("src/app.ts", "src/service.ts");
    addDependency("src/app.ts", "src/store.ts");
    addDependency("src/service.ts", "src/store.ts");

    const analysis = analyzeRepositoryArchitecture(graph);

    assert.equal(analysis.totalFiles, 3);
    assert.equal(analysis.totalDependencies, 3);
    assert.equal(analysis.averageDependencies, 1);
    assert.equal(analysis.averageDependents, 1);
  });

  it("ranks connected modules deterministically", () => {
    addDependency("src/app.ts", "src/service.ts");
    addDependency("src/app.ts", "src/store.ts");
    addDependency("src/service.ts", "src/store.ts");

    assert.deepEqual(analyzeRepositoryArchitecture(graph).mostConnectedModules, [
      {
        filePath: "src/app.ts",
        dependencyCount: 2,
        dependentCount: 0,
        totalConnections: 2,
      },
      {
        filePath: "src/service.ts",
        dependencyCount: 1,
        dependentCount: 1,
        totalConnections: 2,
      },
      {
        filePath: "src/store.ts",
        dependencyCount: 0,
        dependentCount: 2,
        totalConnections: 2,
      },
    ]);
  });

  it("scores circular dependencies", () => {
    addDependency("src/a.ts", "src/b.ts");
    addDependency("src/b.ts", "src/c.ts");
    addDependency("src/c.ts", "src/a.ts");

    const analysis = analyzeRepositoryArchitecture(graph);

    assert.equal(analysis.hasCycles, true);
    assert.equal(analysis.circularDependencyCount, 1);
    assert.equal(analysis.architectureComplexityScore, 45);
  });

  it("scores acyclic complexity", () => {
    addDependency("src/app.ts", "src/service.ts");
    addDependency("src/app.ts", "src/store.ts");
    addNode("src/isolated.ts");

    const analysis = analyzeRepositoryArchitecture(graph);

    assert.equal(analysis.hasCycles, false);
    assert.equal(analysis.circularDependencyCount, 0);
    assert.equal(analysis.architectureComplexityScore, 15);
  });

  it("returns deterministic ordering", () => {
    addDependency("src/z.ts", "src/b.ts");
    addDependency("src/a.ts", "src/c.ts");
    addNode("src/isolated.ts");

    const first = analyzeRepositoryArchitecture(graph);
    const second = analyzeRepositoryArchitecture(graph);

    assert.deepEqual(first.rootModules, [
      "src/a.ts",
      "src/isolated.ts",
      "src/z.ts",
    ]);
    assert.deepEqual(first.leafModules, [
      "src/b.ts",
      "src/c.ts",
      "src/isolated.ts",
    ]);
    assert.deepEqual(second, first);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  });

  it("does not mutate the graph", () => {
    addDependency("src/app.ts", "src/service.ts");
    addNode("src/isolated.ts");
    const nodesBefore = listNodes();
    const edgesBefore = listEdges();

    const analysis = analyzeRepositoryArchitecture(graph);
    analysis.rootModules.push("src/mutated.ts");
    analysis.leafModules.push("src/mutated.ts");
    analysis.isolatedModules.push("src/mutated.ts");
    analysis.mostConnectedModules[0]!.filePath = "src/mutated.ts";

    assert.deepEqual(listNodes(), nodesBefore);
    assert.deepEqual(listEdges(), edgesBefore);
    assert.deepEqual(analyzeRepositoryArchitecture(graph).rootModules, [
      "src/app.ts",
      "src/isolated.ts",
    ]);
  });
});
