import type {
    ArchitectureInternalDependency,
  } from "./architectureInternalDependencyFilter.js";
  
  export interface ArchitectureInternalDependencyGraph {
    nodes: readonly string[];
    edges: readonly ArchitectureInternalDependency[];
  }
  
  export function buildInternalDependencyGraph(
    dependencies: readonly ArchitectureInternalDependency[],
  ): ArchitectureInternalDependencyGraph {
    const nodes = new Set<string>();
  
    for (const dependency of dependencies) {
      nodes.add(dependency.sourceFile);
      nodes.add(dependency.targetFile);
    }
  
    return {
      nodes: [...nodes].sort(),
      edges: [...dependencies],
    };
  }