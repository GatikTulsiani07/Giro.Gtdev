import { env } from "../../config/env.js";
import { RepositoryQuotaError } from "../repository/quotas/repositoryQuota.js";
import type {
  RepositoryGraphQuotas,
  RepositoryGraphValidation,
  RepositorySymbolGraph,
} from "./graphTypes.js";

export const runtimeRepositoryGraphQuotas: RepositoryGraphQuotas = Object.freeze({
  maxNodes: env.REPOSITORY_GRAPH_MAX_NODES,
  maxEdges: env.REPOSITORY_GRAPH_MAX_EDGES,
  maxDurationMs: env.REPOSITORY_GRAPH_MAX_DURATION_MS,
  maxBytes: env.REPOSITORY_GRAPH_MAX_BYTES,
  maxUnresolvedFileRatio: env.REPOSITORY_GRAPH_MAX_UNRESOLVED_RATIO,
  maxParserFailureRatio: env.REPOSITORY_GRAPH_MAX_PARSER_FAILURE_RATIO,
});

function duplicates(values: readonly string[]): number {
  return values.length - new Set(values).size;
}

export function validateRepositoryGraph(
  graph: RepositorySymbolGraph,
  options: {
    expectedRepositoryId: string;
    expectedRepositoryRevision: string;
    quotas?: RepositoryGraphQuotas;
    now?: () => Date;
  },
): RepositoryGraphValidation {
  const quotas = options.quotas ?? runtimeRepositoryGraphQuotas;
  if (
    graph.repositoryId !== options.expectedRepositoryId ||
    graph.repositoryRevision !== options.expectedRepositoryRevision
  ) {
    throw new Error("Repository graph revision mismatch.");
  }
  const nodeIds = graph.nodes.map((node) => node.nodeId);
  const edgeIds = graph.edges.map((edge) => edge.edgeId);
  const knownNodes = new Set(nodeIds);
  const duplicateNodeIdCount = duplicates(nodeIds);
  const duplicateEdgeIdCount = duplicates(edgeIds);
  const missingEndpointCount = graph.edges.filter((edge) =>
    !knownNodes.has(edge.fromNodeId) || !knownNodes.has(edge.toNodeId)).length;
  const impossibleSelfEdgeCount = graph.edges.filter((edge) =>
    edge.fromNodeId === edge.toNodeId && edge.kind !== "references").length;
  const graphBytes = Buffer.byteLength(JSON.stringify({
    nodes: graph.nodes,
    edges: graph.edges,
    diagnostics: graph.diagnostics,
  }), "utf8");

  if (graph.nodes.length > quotas.maxNodes) {
    throw new RepositoryQuotaError("graph_nodes", quotas.maxNodes, graph.nodes.length);
  }
  if (graph.edges.length > quotas.maxEdges) {
    throw new RepositoryQuotaError("graph_edges", quotas.maxEdges, graph.edges.length);
  }
  if (graph.diagnostics.durationMs > quotas.maxDurationMs) {
    throw new RepositoryQuotaError("graph_duration", quotas.maxDurationMs, graph.diagnostics.durationMs);
  }
  if (graphBytes > quotas.maxBytes) {
    throw new RepositoryQuotaError("graph_bytes", quotas.maxBytes, graphBytes);
  }

  const failures = [
    duplicateNodeIdCount > 0 ? "duplicate_node_ids" : null,
    duplicateEdgeIdCount > 0 ? "duplicate_edge_ids" : null,
    missingEndpointCount > 0 ? "missing_edge_endpoints" : null,
    impossibleSelfEdgeCount > 0 ? "impossible_self_edges" : null,
    graph.diagnostics.unresolvedFileRatio > quotas.maxUnresolvedFileRatio
      ? "unresolved_file_ratio"
      : null,
    graph.diagnostics.parserFailureRatio > quotas.maxParserFailureRatio
      ? "parser_failure_ratio"
      : null,
    graph.diagnostics.orphanSymbolCount > 0 ? "orphan_symbols" : null,
  ].filter((value): value is string => value !== null);

  return {
    ...structuredClone(graph.diagnostics),
    duplicateNodeIdCount,
    duplicateEdgeIdCount,
    missingEndpointCount,
    impossibleSelfEdgeCount,
    graphBytes,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    valid: failures.length === 0,
    validatedAt: (options.now?.() ?? new Date()).toISOString(),
    failures: [
      ...structuredClone(graph.diagnostics.failures),
      ...failures.map((code) => ({ code, message: code })),
    ],
  };
}
