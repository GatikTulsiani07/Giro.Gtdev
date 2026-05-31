// Safely reads repository files into memory one at a time.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  shouldIgnoreFile,
  shouldIgnorePath,
  IGNORED_DIRS,
} from "../repository/ignore.js";
import { logger } from "../../lib/logger.js";
import type { ExtractedFile } from "./types.js";

const MAX_FILE_SIZE = 512 * 1024;

// Async generator keeps memory flat: one file in scope at a time.
export async function* extractFiles(
  repoPath: string,
): AsyncGenerator<ExtractedFile> {
  async function* walk(dir: string): AsyncGenerator<ExtractedFile> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoPath, full);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        yield* walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldIgnorePath(rel) || shouldIgnoreFile(entry.name)) continue;

      try {
        const info = await stat(full);
        if (info.size > MAX_FILE_SIZE) continue;
        const content = await readFile(full, "utf8");
        yield {
          relativePath: rel,
          extension: path.extname(entry.name).toLowerCase() || "none",
          size: info.size,
          content,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "read error";
        logger.warn("file_read_skipped", { file: rel, message });
      }
    }
  }

  yield* walk(repoPath);
}
