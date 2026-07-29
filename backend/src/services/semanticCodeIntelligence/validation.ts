import type { SemanticAdapterRegistry } from "./adapter.js";
import {
  SEMANTIC_SCHEMA_VERSION,
  SemanticCodeIntelligenceError,
  type SemanticGraph,
} from "./types.js";

export function validateSemanticGraph(graph: SemanticGraph): void {
  const symbolIds = new Set(graph.symbols.map((item) => item.symbolId));
  const edgeIds = new Set(graph.relationships.map((item) => item.relationshipId));
  if (graph.schemaVersion !== SEMANTIC_SCHEMA_VERSION ||
      graph.repositoryRevision.length !== 40 ||
      symbolIds.size !== graph.symbols.length ||
      edgeIds.size !== graph.relationships.length ||
      graph.symbols.some((symbol) =>
        symbol.graphVersion !== graph.graphVersion ||
        symbol.tenantId !== graph.tenantId ||
        symbol.repositoryId !== graph.repositoryId ||
        symbol.repositoryRevision !== graph.repositoryRevision) ||
      graph.relationships.some((edge) =>
        edge.graphVersion !== graph.graphVersion ||
        edge.tenantId !== graph.tenantId ||
        edge.repositoryId !== graph.repositoryId ||
        edge.repositoryRevision !== graph.repositoryRevision ||
        !symbolIds.has(edge.fromSymbolId) ||
        !symbolIds.has(edge.toSymbolId) ||
        edge.fromSymbolId === edge.toSymbolId)) {
    throw new SemanticCodeIntelligenceError(
      "semantic_graph_integrity_invalid",
      "Semantic graph integrity validation failed.",
    );
  }
  const files = new Set(graph.fileAnalyses.map((item) => item.file));
  if (graph.symbols.some((symbol) => !files.has(symbol.file))) {
    throw new SemanticCodeIntelligenceError(
      "semantic_orphan_symbol",
      "Semantic graph contains symbols outside its immutable snapshot.",
    );
  }
}

export function verifySemanticAdapters(registry: SemanticAdapterRegistry): void {
  try {
    registry.verify();
  } catch (error) {
    throw new SemanticCodeIntelligenceError(
      "semantic_adapter_incompatible",
      "Semantic language adapter validation failed.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function cloneSemanticGraph(graph: SemanticGraph): SemanticGraph {
  return structuredClone(graph);
}
