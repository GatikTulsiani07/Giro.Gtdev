import type { RepositoryDependencyEdge } from "./repositoryDependencyGraph.js";

export interface RepositoryDependencyGraph {
  listNodes(): string[];
  listEdges(): RepositoryDependencyEdge[];
  getDependencies(filePath: string): string[];
  getDependents(filePath: string): string[];
  hasCycle(): boolean;
}

export interface RepositoryConnectedModule {
  filePath: string;
  dependencyCount: number;
  dependentCount: number;
  totalConnections: number;
}

export interface RepositoryArchitectureAnalysis {
  totalFiles: number;
  totalDependencies: number;
  rootModules: string[];
  leafModules: string[];
  isolatedModules: string[];
  averageDependencies: number;
  averageDependents: number;
  mostConnectedModules: RepositoryConnectedModule[];
  circularDependencyCount: number;
  hasCycles: boolean;
  architectureComplexityScore: number;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function countCircularComponents(
  nodes: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): number {
  let index = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let circularComponents = 0;

  function strongConnect(filePath: string): void {
    indexes.set(filePath, index);
    lowLinks.set(filePath, index);
    index += 1;
    stack.push(filePath);
    onStack.add(filePath);

    for (const dependency of adjacency.get(filePath) ?? []) {
      if (!indexes.has(dependency)) {
        strongConnect(dependency);
        lowLinks.set(
          filePath,
          Math.min(lowLinks.get(filePath)!, lowLinks.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          filePath,
          Math.min(lowLinks.get(filePath)!, indexes.get(dependency)!),
        );
      }
    }

    if (lowLinks.get(filePath) !== indexes.get(filePath)) return;

    let componentSize = 0;
    let current: string | undefined;
    do {
      current = stack.pop();
      if (current === undefined) break;
      onStack.delete(current);
      componentSize += 1;
    } while (current !== filePath);

    if (componentSize > 1) {
      circularComponents += 1;
    }
  }

  for (const filePath of nodes) {
    if (!indexes.has(filePath)) {
      strongConnect(filePath);
    }
  }

  return circularComponents;
}

function scoreComplexity(input: {
  totalFiles: number;
  totalDependencies: number;
  circularDependencyCount: number;
  isolatedModules: number;
}): number {
  if (input.totalFiles === 0) return 0;

  const density = input.totalDependencies / input.totalFiles;
  const cyclePenalty = input.circularDependencyCount * 20;
  const isolationPenalty = (input.isolatedModules / input.totalFiles) * 10;

  return Math.min(100, roundMetric(density * 25 + cyclePenalty + isolationPenalty));
}

export function analyzeRepositoryArchitecture(
  graph: RepositoryDependencyGraph,
): RepositoryArchitectureAnalysis {
  const nodes = sorted(graph.listNodes());
  const edges = graph
    .listEdges()
    .map((edge) => ({ from: edge.from, to: edge.to }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const adjacency = new Map<string, string[]>();
  for (const filePath of nodes) {
    adjacency.set(filePath, sorted(graph.getDependencies(filePath)));
  }

  const totalFiles = nodes.length;
  const totalDependencies = edges.length;
  const dependencyCounts = new Map<string, number>();
  const dependentCounts = new Map<string, number>();

  for (const filePath of nodes) {
    dependencyCounts.set(filePath, adjacency.get(filePath)?.length ?? 0);
    dependentCounts.set(filePath, graph.getDependents(filePath).length);
  }

  const rootModules = nodes.filter((filePath) => dependentCounts.get(filePath) === 0);
  const leafModules = nodes.filter((filePath) => dependencyCounts.get(filePath) === 0);
  const isolatedModules = nodes.filter(
    (filePath) =>
      dependencyCounts.get(filePath) === 0 && dependentCounts.get(filePath) === 0,
  );
  const mostConnectedModules = nodes
    .map((filePath) => {
      const dependencyCount = dependencyCounts.get(filePath) ?? 0;
      const dependentCount = dependentCounts.get(filePath) ?? 0;
      return {
        filePath,
        dependencyCount,
        dependentCount,
        totalConnections: dependencyCount + dependentCount,
      };
    })
    .filter((module) => module.totalConnections > 0)
    .sort(
      (a, b) =>
        b.totalConnections - a.totalConnections ||
        b.dependencyCount - a.dependencyCount ||
        a.filePath.localeCompare(b.filePath),
    );
  const circularDependencyCount = countCircularComponents(nodes, adjacency);
  const hasCycles = graph.hasCycle();

  return {
    totalFiles,
    totalDependencies,
    rootModules,
    leafModules,
    isolatedModules,
    averageDependencies:
      totalFiles === 0 ? 0 : roundMetric(totalDependencies / totalFiles),
    averageDependents:
      totalFiles === 0 ? 0 : roundMetric(totalDependencies / totalFiles),
    mostConnectedModules,
    circularDependencyCount,
    hasCycles,
    architectureComplexityScore: scoreComplexity({
      totalFiles,
      totalDependencies,
      circularDependencyCount,
      isolatedModules: isolatedModules.length,
    }),
  };
}
