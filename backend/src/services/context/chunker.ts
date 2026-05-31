// Splits file content into line-based chunks with overlap.

import { randomUUID } from "node:crypto";
import type { Chunk, ExtractedFile } from "./types.js";

const TARGET_LINES = 160; // within the 120-200 target band
const OVERLAP_LINES = 20;

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".json": "json",
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
};

function languageOf(ext: string): string {
  return LANG_BY_EXT[ext] ?? "text";
}

export function chunkFile(file: ExtractedFile): Chunk[] {
  const lines = file.content.split("\n");
  if (lines.length === 0) return [];

  const language = languageOf(file.extension);
  const chunks: Chunk[] = [];
  const step = Math.max(1, TARGET_LINES - OVERLAP_LINES);

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + TARGET_LINES, lines.length);
    const slice = lines.slice(start, end);
    if (slice.join("").trim().length === 0) {
      if (end >= lines.length) break;
      continue;
    }

    chunks.push({
      chunkId: randomUUID(),
      filePath: file.relativePath,
      startLine: start + 1,
      endLine: end,
      language,
      content: slice.join("\n"),
    });

    if (end >= lines.length) break;
  }

  return chunks;
}
