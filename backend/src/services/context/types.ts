// Types for the repository context-extraction engine.

export interface ExtractedFile {
  relativePath: string;
  extension: string;
  size: number;
  content: string;
}

export interface Chunk {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  content: string;
}

export interface RepoSummary {
  packageManagers: string[];
  frameworks: string[];
  buildSystems: string[];
  testFrameworks: string[];
  configFiles: string[];
  envFiles: string[];
  ciFiles: string[];
  usesDocker: boolean;
  isMonorepo: boolean;
  backendDirs: string[];
  frontendDirs: string[];
}

export interface ContextResult {
  summary: RepoSummary;
  tree: string[];
  chunks: Chunk[];
}
