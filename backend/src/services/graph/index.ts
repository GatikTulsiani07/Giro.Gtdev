// Orchestrates repository dependency analysis. Read-only, deterministic.

import { existsSync } from "node:fs";
import { logger } from "../../lib/logger.js";
import { repoClonePath } from "../repository/clone.js";
import { extractRepoSymbols } from "./symbolExtractor.js";
import {
  buildDependencyGraph,
  computeStats,
  detectInsights,
} from "./graphBuilder.js";
import type { DependencyGraph } from "./types.js";

export async function analyzeRepoDependencies(
  owner: string,
  repo: string,
): Promise<DependencyGraph> {
  const clonePath = repoClonePath(owner, repo);
  if (!existsSync(clonePath)) {
    throw new Error("Repository not connected");
  }

  const symbolMaps = await extractRepoSymbols(clonePath);
  const { nodes, edges } = buildDependencyGraph(symbolMaps);
  const stats = computeStats(nodes, edges);
  const insights = detectInsights(nodes, edges);

  logger.info("dependency_graph_complete", {
    owner,
    repo,
    totalNodes: stats.totalNodes,
    totalEdges: stats.totalEdges,
  });

  return { nodes, edges, stats, insights };
}
