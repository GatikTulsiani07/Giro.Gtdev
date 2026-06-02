// Classifies the overall architecture type from boolean signals. Deterministic.

import type { ArchitectureType } from "./types.js";

export interface ArchitectureSignals {
  monorepo: boolean;
  hasBackend: boolean;
  hasFrontend: boolean;
  hasBin: boolean; // package.json "bin" field present
  isLibrary: boolean; // has "main"/"exports" but no app entrypoints
  entrypointCount: number;
}

export function classifyArchitecture(s: ArchitectureSignals): ArchitectureType {
  if (s.monorepo) return "monorepo";
  if (s.hasBackend && s.hasFrontend) return "fullstack";
  if (s.hasBin && s.entrypointCount > 0) return "cli";
  if (s.hasFrontend && !s.hasBackend) return "frontend";
  if (s.hasBackend && !s.hasFrontend) return "backend-api";
  if (s.isLibrary) return "library";
  return "unknown";
}
