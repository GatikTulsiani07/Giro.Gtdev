import fs from "node:fs";
import path from "node:path";

export function scanRepositoryFiles(
  rootDirectory: string,
): string[] {
  const results: string[] = [];

  function walk(currentDirectory: string): void {
    const entries = fs.readdirSync(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(
        currentDirectory,
        entry.name,
      );

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      results.push(fullPath);
    }
  }

  walk(rootDirectory);

  return results;
}