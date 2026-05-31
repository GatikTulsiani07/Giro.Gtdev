// Centralized ignore rules shared by the scanner and context engine.

import path from "node:path";

export const IGNORED_DIRS = new Set<string>([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  "out",
]);

export const BINARY_EXTENSIONS = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".mp4",
  ".mp3",
  ".wav",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".bin",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export function shouldIgnorePath(relPath: string): boolean {
  return relPath
    .split(path.sep)
    .some((segment) => IGNORED_DIRS.has(segment));
}

export function shouldIgnoreFile(filename: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filename).toLowerCase());
}
