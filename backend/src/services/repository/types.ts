// Shared types for the repository ingestion layer.

export interface ScanResult {
  owner: string;
  repo: string;
  clonePath: string;
  totalFiles: number;
  totalDirectories: number;
  languages: Record<string, number>;
  tree: string[];
  alreadyExisted: boolean;
}
