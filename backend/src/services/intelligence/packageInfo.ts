// Reads package.json signals needed for intelligence analysis. Pure I/O, no throw.

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PackageInfo {
  deps: Set<string>;
  hasBin: boolean;
  isLibrary: boolean;
}

export async function readPackageInfo(clonePath: string): Promise<PackageInfo> {
  try {
    const raw = await readFile(path.join(clonePath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      bin?: unknown;
      main?: unknown;
      exports?: unknown;
      scripts?: Record<string, string>;
    };
    const deps = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const hasBin = pkg.bin !== undefined;
    const isLibrary = pkg.main !== undefined || pkg.exports !== undefined;
    return { deps, hasBin, isLibrary };
  } catch {
    return { deps: new Set(), hasBin: false, isLibrary: false };
  }
}
