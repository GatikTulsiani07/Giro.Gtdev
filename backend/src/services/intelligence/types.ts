// Types for the Repository Intelligence Engine V1 (heuristic, rule-based).

export type ArchitectureType =
  | "monorepo"
  | "fullstack"
  | "frontend"
  | "backend-api"
  | "library"
  | "cli"
  | "unknown";

export interface DirectoryScore {
  path: string;
  score: number;
  reason: string;
}

export interface SummaryMetrics {
  indexingDurationMs: number;
  analysisDurationMs: number;
  parsingFailures: number;
  detectedFrameworks: string[];
}

export interface RepositorySummary {
  repository: string;
  frameworks: string[];
  architectureType: ArchitectureType;
  primaryLanguage: string;
  packageManager: string;
  importantDirectories: DirectoryScore[];
  entrypoints: string[];
  dependencies: string[];
  separation: {
    hasBackend: boolean;
    hasFrontend: boolean;
    monorepo: boolean;
  };
  databaseLayer: string[];
  authLayer: string[];
  queueLayer: string[];
  testingFramework: string[];
  infrastructure: string[];
  metrics: SummaryMetrics;
}
