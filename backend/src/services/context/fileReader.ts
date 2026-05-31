// Reads readable source files from a cloned repository.
// Uses an explicit stack (no recursion) to stay safe on deeply nested repos.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { shouldIgnorePath, shouldIgnoreFile } from "../repository/ignore.js";
import { detectLanguageFromExtension } from "./language.js";
import type { SourceFile } from "./types.js";

const MAX_FILE_SIZE = 512 * 1024; // 512KB

export async function readSourceFiles(clonePath: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const dirs: string[] = [clonePath];

  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir === undefined) break;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path
        .relative(clonePath, absolutePath)
        .split(path.sep)
        .join("/");

      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        if (shouldIgnorePath(relativePath)) continue;
        dirs.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldIgnorePath(relativePath)) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (shouldIgnoreFile(entry.name)) continue;

      let sizeBytes: number;
      try {
        sizeBytes = (await stat(absolutePath)).size;
      } catch {
        continue;
      }
      if (sizeBytes > MAX_FILE_SIZE) continue;

      let content: string;
      try {
        content = await readFile(absolutePath, "utf8");
      } catch {
        continue;
      }
      if (content.trim() === "") continue;

      files.push({
        filePath: relativePath,
        absolutePath,
        extension,
        language: detectLanguageFromExtension(extension),
        sizeBytes,
        content,
      });
    }
  }

  return files;
}
