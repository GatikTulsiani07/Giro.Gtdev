import type { RepositorySymbolGraph } from "./graphTypes.js";

const store = new Map<string, RepositorySymbolGraph>();

function clone(graph: RepositorySymbolGraph): RepositorySymbolGraph {
  return structuredClone(graph);
}

export function saveRepositorySymbolGraph(graph: RepositorySymbolGraph): void {
  store.set(graph.repositoryId, clone(graph));
}

export function getRepositorySymbolGraph(repositoryId: string): RepositorySymbolGraph | null {
  const graph = store.get(repositoryId);
  return graph ? clone(graph) : null;
}

export function removeRepositorySymbolGraph(repositoryId: string): void {
  store.delete(repositoryId);
}

export function clearRepositorySymbolGraphs(): void {
  store.clear();
}
