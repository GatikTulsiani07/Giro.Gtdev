// Builds the full chunk set for a cloned repository.

import { readSourceFiles } from "./fileReader.js";
import { chunkSourceFile } from "./chunker.js";
import type { ContextBuildResult } from "./types.js";

export async function buildRepositoryContext(
  clonePath: string,
): Promise<ContextBuildResult> {
  const files = await readSourceFiles(clonePath);
  const chunks = files.flatMap((file) => chunkSourceFile(file));
  return {
    totalFilesRead: files.length,
    totalChunks: chunks.length,
    chunks,
  };
}
