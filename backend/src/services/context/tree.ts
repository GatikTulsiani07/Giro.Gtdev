// Builds a compact, AI-friendly file tree (max depth 4, max 300 nodes).

import { readdir } from "node:fs/promises";
import path from "node:path";
import { IGNORED_DIRS } from "../repository/ignore.js";

const MAX_DEPTH = 4;
const MAX_NODES = 300;

export async function buildCompactTree(repoPath: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_NODES) return;

    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => !IGNORED_DIRS.has(e.name) && e.name !== ".git")
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (out.length >= MAX_NODES) return;
      const indent = "  ".repeat(depth);
      if (entry.isDirectory()) {
        out.push(`${indent}${entry.name}/`);
        await walk(path.join(dir, entry.name), depth + 1);
      } else {
        out.push(`${indent}${entry.name}`);
      }
    }
  }

  await walk(repoPath, 0);
  return out;
}
