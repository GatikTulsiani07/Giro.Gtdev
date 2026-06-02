// Types for the repository dependency graph + symbol intelligence engine.

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "enum";

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  line: number;
}

export interface FileImport {
  source: string;
  specifiers: string[];
  isRelative: boolean;
}

export interface FileSymbolMap {
  filePath: string;
  language: "typescript" | "javascript";
  symbols: ExtractedSymbol[];
  imports: FileImport[];
}

export interface GraphNode {
  filePath: string;
  language: string;
  inDegree: number;
  outDegree: number;
  centralityScore: number;
  symbols: ExtractedSymbol[];
}

export interface GraphEdge {
  from: string;
  to: string;
  importedSymbols: string[];
}

export interface DependencyStats {
  totalNodes: number;
  totalEdges: number;
  avgInDegree: number;
  avgOutDegree: number;
  maxInDegree: {
    file: string;
    count: number;
  };
  maxOutDegree: {
    file: string;
    count: number;
  };
}

export interface ArchitecturalInsight {
  centralModules: string[];
  dependencyHotspots: string[];
  isolatedModules: string[];
  circularDependencies: string[][];
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: DependencyStats;
  insights: ArchitecturalInsight;
}
