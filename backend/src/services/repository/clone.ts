// Shallow-clones a GitHub repository into local storage.

import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

const STORAGE_ROOT = path.join(process.cwd(), ".storage", "repos");
const CLONE_TIMEOUT_MS = 60_000;

export function repoClonePath(owner: string, repo: string): string {
  return path.join(STORAGE_ROOT, `${owner}--${repo}`);
}

export async function cloneRepo(
  owner: string,
  repo: string,
): Promise<{ clonePath: string; alreadyExisted: boolean }> {
  await mkdir(STORAGE_ROOT, { recursive: true });

  const clonePath = repoClonePath(owner, repo);

  if (existsSync(clonePath)) {
    const entries = await readdir(clonePath);
    if (entries.length > 0) {
      return { clonePath, alreadyExisted: true };
    }
  }

  const repoUrl = `https://github.com/${owner}/${repo}.git`;

  try {
    await simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } }).clone(
      repoUrl,
      clonePath,
      ["--depth", "1"],
    );
  } catch (err) {
    await rm(clonePath, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`Clone failed: ${message}`);
  }

  return { clonePath, alreadyExisted: false };
}
