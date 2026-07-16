import type { FileSymbolMap } from "../graph/types.js";

export type RepositoryGraphNodeKind =
  | "class"
  | "interface"
  | "function"
  | "method"
  | "struct"
  | "enum"
  | "constant"
  | "exported_member"
  | "imported_member"
  | "namespace"
  | "module"
  | "type";

export type RepositoryGraphEdgeKind =
  | "imports"
  | "exports"
  | "extends"
  | "implements"
  | "calls"
  | "references"
  | "overrides"
  | "overriddenBy"
  | "parent"
  | "child";

export interface RepositoryGraphNode {
  symbolId: string;
  repositoryId: string;
  name: string;
  kind: RepositoryGraphNodeKind;
  language: string;
  file: string;
  line: number;
  repositoryVersion: string;
}

export interface RepositoryGraphEdge {
  fromSymbolId: string;
  toSymbolId: string;
  kind: RepositoryGraphEdgeKind;
}

export interface RepositorySymbolGraph {
  repositoryId: string;
  repositoryVersion: string;
  nodes: RepositoryGraphNode[];
  edges: RepositoryGraphEdge[];
}

export interface RepositoryGraphBuildInput {
  repositoryId: string;
  repositoryVersion: string;
  symbolMaps: readonly FileSymbolMap[];
}

export interface RepositoryGraphExpansionMetrics {
  incrementSymbolExpansion(count?: number): void;
  incrementSymbolExpansionBudgetDrop(count?: number): void;
}

export interface RepositoryGraphLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}
