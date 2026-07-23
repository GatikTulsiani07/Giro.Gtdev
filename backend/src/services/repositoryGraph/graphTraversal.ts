import type { RetrievalResult } from "../retrieval/types.js";
import type {
  RepositoryGraphEdgeKind,
  RepositoryGraphNode,
  RepositorySymbolGraph,
} from "./graphTypes.js";

export interface RepositoryGraphTraversalWeights {
  directRelationship: number;
  callEdge: number;
  importEdge: number;
  inheritance: number;
  implementation: number;
  referenceCount: number;
  centrality: number;
  distancePenalty: number;
}

export interface RepositoryGraphTraversalOptions {
  repositoryId: string;
  repositoryRevision: string;
  maxDepth: number;
  maxCandidates: number;
  weights: RepositoryGraphTraversalWeights;
}

export interface GraphExpandedCandidate {
  result: RetrievalResult;
  nodeId: string;
  rootNodeId: string;
  edgeKind: RepositoryGraphEdgeKind;
  distance: number;
  score: number;
  centrality: number;
  referenceCount: number;
}

function edgeWeight(kind: RepositoryGraphEdgeKind, weights: RepositoryGraphTraversalWeights): number {
  if (kind === "calls") return weights.callEdge;
  if (kind === "imports" || kind === "re_exports" || kind === "resolves_to") return weights.importEdge;
  if (kind === "extends" || kind === "overrides" || kind === "overriddenBy") return weights.inheritance;
  if (kind === "implements") return weights.implementation;
  return weights.directRelationship;
}

function rootNodes(
  graph: RepositorySymbolGraph,
  candidates: readonly RetrievalResult[],
): RepositoryGraphNode[] {
  const roots = new Map<string, RepositoryGraphNode>();
  for (const candidate of candidates) {
    for (const node of graph.nodes) {
      if (node.kind === "repository" || node.kind === "file") continue;
      if (node.file !== candidate.filePath) continue;
      const symbolMatch = candidate.symbol && (
        node.name === candidate.symbol || node.qualifiedName === candidate.symbol
      );
      const locationMatch =
        node.line <= candidate.endLine &&
        node.endLine >= candidate.startLine;
      if (symbolMatch || locationMatch || node.kind === "module") roots.set(node.nodeId, node);
    }
  }
  return [...roots.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export function expandPublishedRepositoryGraph(
  graph: RepositorySymbolGraph | null,
  candidates: readonly RetrievalResult[],
  options: RepositoryGraphTraversalOptions,
): GraphExpandedCandidate[] {
  if (
    !graph ||
    graph.status !== "published" ||
    graph.repositoryId !== options.repositoryId ||
    graph.repositoryRevision !== options.repositoryRevision ||
    options.maxDepth <= 0 ||
    options.maxCandidates <= 0
  ) return [];

  const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const adjacency = new Map<string, Array<{ nodeId: string; kind: RepositoryGraphEdgeKind }>>();
  const degree = new Map<string, number>();
  const referenceCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    const from = adjacency.get(edge.fromNodeId) ?? [];
    from.push({ nodeId: edge.toNodeId, kind: edge.kind });
    adjacency.set(edge.fromNodeId, from);
    const reverse = adjacency.get(edge.toNodeId) ?? [];
    reverse.push({ nodeId: edge.fromNodeId, kind: edge.kind });
    adjacency.set(edge.toNodeId, reverse);
    degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
    if (edge.kind === "references") {
      referenceCounts.set(edge.toNodeId, (referenceCounts.get(edge.toNodeId) ?? 0) + 1);
    }
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.nodeId.localeCompare(right.nodeId));
  }
  const maximumDegree = Math.max(1, ...degree.values());
  const maximumReferences = Math.max(1, ...referenceCounts.values());
  const roots = rootNodes(graph, candidates);
  const rootIds = new Set(roots.map((node) => node.nodeId));
  const visited = new Set(rootIds);
  const queue = roots.map((root) => ({
    nodeId: root.nodeId,
    rootNodeId: root.nodeId,
    distance: 0,
    edgeKind: "contains" as RepositoryGraphEdgeKind,
  }));
  const expanded: GraphExpandedCandidate[] = [];
  while (queue.length > 0 && expanded.length < options.maxCandidates) {
    const current = queue.shift()!;
    if (current.distance >= options.maxDepth) continue;
    for (const neighbor of adjacency.get(current.nodeId) ?? []) {
      if (visited.has(neighbor.nodeId)) continue;
      visited.add(neighbor.nodeId);
      const node = byId.get(neighbor.nodeId);
      if (!node) continue;
      const distance = current.distance + 1;
      queue.push({
        nodeId: neighbor.nodeId,
        rootNodeId: current.rootNodeId,
        distance,
        edgeKind: neighbor.kind,
      });
      if (
        rootIds.has(node.nodeId) ||
        ["repository", "file", "module", "imported_member"].includes(node.kind)
      ) continue;
      const centrality = (degree.get(node.nodeId) ?? 0) / maximumDegree;
      const referenceCount = (referenceCounts.get(node.nodeId) ?? 0) / maximumReferences;
      const distanceMultiplier = Math.max(
        0,
        1 - options.weights.distancePenalty * Math.max(0, distance - 1),
      );
      const score = Math.max(0, Math.min(1,
        (
          edgeWeight(neighbor.kind, options.weights) +
          referenceCount * options.weights.referenceCount +
          centrality * options.weights.centrality
        ) * distanceMultiplier,
      ));
      expanded.push({
        nodeId: node.nodeId,
        rootNodeId: current.rootNodeId,
        edgeKind: neighbor.kind,
        distance,
        score,
        centrality,
        referenceCount,
        result: {
          repository: graph.repositoryId,
          filePath: node.file,
          language: node.language,
          content: `${node.kind} ${node.qualifiedName} at ${node.file}:${node.line}`,
          startLine: node.line,
          endLine: node.endLine,
          score,
          source: "graph",
          signals: { graph: score },
          chunkId: `graph:${graph.graphVersion}:${node.nodeId}`,
          symbol: node.qualifiedName,
        },
      });
      if (expanded.length >= options.maxCandidates) break;
    }
  }
  return expanded.sort((left, right) =>
    right.score - left.score ||
    left.distance - right.distance ||
    left.result.filePath.localeCompare(right.result.filePath) ||
    left.result.startLine - right.result.startLine ||
    left.nodeId.localeCompare(right.nodeId));
}
