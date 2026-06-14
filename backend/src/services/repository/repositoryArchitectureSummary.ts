// Deterministic repository architecture summary. NOT AI-generated — pure facts
// derived from a DependencyGraph's nodes/edges. Pure: no I/O, randomness,
// timestamps, or module state; never mutates the graph, nodes, or edges.

import type { DependencyGraph } from "../graph/types.js";

export interface RepositoryArchitectureSummary {
  totalFiles: number;
  totalDependencies: number;
  averageDependenciesPerFile: number;
  isolatedFiles: number;
  connectedFiles: number;
  architectureComplexity: "low" | "medium" | "high";
}

function classifyComplexity(avg: number): RepositoryArchitectureSummary["architectureComplexity"] {
  if (avg >= 5) return "high";
  if (avg >= 2) return "medium";
  return "low";
}

export function buildRepositoryArchitectureSummary(
  graph: DependencyGraph,
): RepositoryArchitectureSummary {
  const totalFiles = graph.nodes.length;
  const totalDependencies = graph.edges.length;

  // Zero-file guard: never emit NaN/Infinity.
  if (totalFiles === 0) {
    return {
      totalFiles: 0,
      totalDependencies,
      averageDependenciesPerFile: 0,
      isolatedFiles: 0,
      connectedFiles: 0,
      architectureComplexity: "low",
    };
  }

  const nodeFilePaths = new Set(graph.nodes.map((node) => node.filePath));
  const edgeParticipants = new Set<string>();
  for (const edge of graph.edges) {
    edgeParticipants.add(edge.from);
    edgeParticipants.add(edge.to);
  }

  // Only participants that are real nodes count, so connectedFiles <= totalFiles.
  let connectedFiles = 0;
  for (const participant of edgeParticipants) {
    if (nodeFilePaths.has(participant)) connectedFiles += 1;
  }
  const isolatedFiles = totalFiles - connectedFiles;

  const averageDependenciesPerFile = Number(
    (totalDependencies / totalFiles).toFixed(2),
  );

  return {
    totalFiles,
    totalDependencies,
    averageDependenciesPerFile,
    isolatedFiles,
    connectedFiles,
    architectureComplexity: classifyComplexity(averageDependenciesPerFile),
  };
}
