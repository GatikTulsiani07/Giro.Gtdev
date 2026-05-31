// Orchestrates the context engine: extract -> chunk -> summarize -> tree.

import { extractFiles } from "./extractor.js";
import { chunkFile } from "./chunker.js";
import { buildSummary } from "./summary.js";
import { buildCompactTree } from "./tree.js";
import type { Chunk, ContextResult } from "./types.js";

export async function buildContext(repoPath: string): Promise<ContextResult> {
  const chunks: Chunk[] = [];

  // Stream files so we never hold the whole repo in memory at once.
  for await (const file of extractFiles(repoPath)) {
    for (const chunk of chunkFile(file)) {
      chunks.push(chunk);
    }
  }

  const [summary, tree] = await Promise.all([
    buildSummary(repoPath),
    buildCompactTree(repoPath),
  ]);

  return { summary, tree, chunks };
}
