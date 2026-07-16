import { logger as runtimeLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import type { RetrievalCandidate } from "../retrieval/candidateFilter.js";
import type {
  RepositoryGraphExpansionMetrics,
  RepositoryGraphLogger,
  RepositoryGraphNode,
  RepositorySymbolGraph,
} from "./graphTypes.js";
import { getRepositorySymbolGraph } from "./runtimeRepositoryGraph.js";

export interface SymbolExpansionOptions {
  repositoryId: string;
  repositoryVersion?: string;
  maxCharacters: number;
  metrics?: RepositoryGraphExpansionMetrics;
  logger?: RepositoryGraphLogger;
}

function candidateLocationKey(candidate: RetrievalCandidate): string {
  return [
    candidate.filePath,
    candidate.startLine ?? 1,
    candidate.endLine ?? candidate.startLine ?? 1,
    candidate.symbol ?? "",
  ].join("\u0000");
}

function nodeCandidateKey(node: RepositoryGraphNode): string {
  return [node.file, node.line, node.line, node.name].join("\u0000");
}

function primarySymbolNodes(
  graph: RepositorySymbolGraph,
  candidates: readonly RetrievalCandidate[],
): RepositoryGraphNode[] {
  const nodes: RepositoryGraphNode[] = [];
  for (const candidate of candidates) {
    const match = graph.nodes.find((node) => {
      if (node.kind === "module" || node.kind === "imported_member") return false;
      if (node.file !== candidate.filePath) return false;
      if (candidate.symbol && node.name === candidate.symbol) return true;
      const start = candidate.startLine ?? 1;
      const end = candidate.endLine ?? start;
      return node.line >= start && node.line <= end;
    });
    if (match) nodes.push(match);
  }
  return nodes.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.name.localeCompare(b.name),
  );
}

function relatedNodes(graph: RepositorySymbolGraph, roots: readonly RepositoryGraphNode[]): RepositoryGraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.symbolId, node]));
  const rootIds = new Set(roots.map((node) => node.symbolId));
  const related = new Map<string, RepositoryGraphNode>();
  const allowed = new Set(["extends", "implements", "references", "parent", "child", "imports", "exports"]);
  const parentModules = new Set<string>();

  for (const edge of graph.edges) {
    if (!allowed.has(edge.kind)) continue;
    const touchesRoot = rootIds.has(edge.fromSymbolId) || rootIds.has(edge.toSymbolId);
    if (!touchesRoot) continue;
    const otherId = rootIds.has(edge.fromSymbolId) ? edge.toSymbolId : edge.fromSymbolId;
    if (rootIds.has(otherId)) continue;
    const node = byId.get(otherId);
    if (!node || node.kind === "imported_member") continue;
    related.set(node.symbolId, node);
    if (node.kind === "module") parentModules.add(node.symbolId);
  }

  for (const edge of graph.edges) {
    if (edge.kind !== "child" || !parentModules.has(edge.fromSymbolId)) continue;
    if (rootIds.has(edge.toSymbolId)) continue;
    const node = byId.get(edge.toSymbolId);
    if (!node || node.kind === "imported_member" || node.kind === "module") continue;
    related.set(node.symbolId, node);
  }

  return [...related.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name),
  );
}

function toExpansionCandidate(node: RepositoryGraphNode): RetrievalCandidate {
  return {
    filePath: node.file,
    content: `${node.kind} ${node.name} at ${node.file}:${node.line}`,
    score: 0,
    language: node.language,
    startLine: node.line,
    endLine: node.line,
    symbol: node.name,
    repositoryVersion: node.repositoryVersion,
    expansion: true,
  };
}

export function expandRetrievalCandidatesWithRepositoryGraph(
  candidates: readonly RetrievalCandidate[],
  options: SymbolExpansionOptions,
): RetrievalCandidate[] {
  const graph = getRepositorySymbolGraph(options.repositoryId);
  if (!graph) return candidates.map((candidate) => ({ ...candidate }));
  if (options.repositoryVersion && graph.repositoryVersion !== options.repositoryVersion) {
    return candidates.map((candidate) => ({ ...candidate }));
  }

  const metrics = options.metrics ?? runtimeMetrics;
  const expansionLogger = options.logger ?? runtimeLogger;
  const primaries = candidates.map((candidate) => ({ ...candidate }));
  const used = primaries.reduce((sum, candidate) => sum + candidate.content.length, 0);
  let remaining = Math.max(0, options.maxCharacters - used);
  const existingLocations = new Set(primaries.map(candidateLocationKey));

  const roots = primarySymbolNodes(graph, primaries);
  expansionLogger.info("symbol_expansion_started", {
    repositoryId: options.repositoryId,
    repositoryVersion: graph.repositoryVersion,
    primarySymbols: roots.length,
    remainingBudget: remaining,
  });

  const expanded: RetrievalCandidate[] = [];
  let dropped = 0;
  for (const node of relatedNodes(graph, roots)) {
    if (existingLocations.has(nodeCandidateKey(node))) continue;
    const candidate = toExpansionCandidate(node);
    const size = candidate.content.length;
    if (size > remaining) {
      dropped += 1;
      continue;
    }
    remaining -= size;
    expanded.push(candidate);
    existingLocations.add(candidateLocationKey(candidate));
  }

  if (expanded.length > 0) metrics.incrementSymbolExpansion(expanded.length);
  if (dropped > 0) {
    metrics.incrementSymbolExpansionBudgetDrop(dropped);
    expansionLogger.info("symbol_expansion_trimmed", {
      repositoryId: options.repositoryId,
      dropped,
      remainingBudget: remaining,
    });
  }
  expansionLogger.info("symbol_expansion_completed", {
    repositoryId: options.repositoryId,
    expansions: expanded.length,
    budgetDrops: dropped,
  });

  return [...primaries, ...expanded];
}
