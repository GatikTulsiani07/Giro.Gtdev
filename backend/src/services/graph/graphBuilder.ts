// Builds a deterministic dependency graph from extracted symbol maps.

import type {
  ArchitecturalInsight,
  DependencyStats,
  FileSymbolMap,
  GraphEdge,
  GraphNode,
} from "./types.js";

const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

function normalize(p: string): string {
  // Collapse "./" and "../" segments into a POSIX-style relative path.
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function dirname(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

function resolveImport(
  fromFile: string,
  source: string,
  known: Set<string>,
): string | null {
  const base = dirname(fromFile);
  const joined = normalize(base ? `${base}/${source}` : source);

  // Direct suffix resolution (extensionless or already-correct paths).
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = normalize(joined + suffix);
    if (known.has(candidate)) return candidate;
  }

  // TypeScript ESM pattern: imports reference ".js"/".jsx" but the source
  // file on disk is ".ts"/".tsx". Rewrite the extension and retry.
  const rewritten = joined.replace(/\.(js|jsx)$/, "");
  if (rewritten !== joined) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = normalize(rewritten + suffix);
      if (known.has(candidate)) return candidate;
    }
  }

  return null;
}

export function buildDependencyGraph(symbolMaps: FileSymbolMap[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const known = new Set(symbolMaps.map((m) => m.filePath));
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const edges: GraphEdge[] = [];

  for (const p of known) {
    inDegree.set(p, 0);
    outDegree.set(p, 0);
  }

  for (const map of symbolMaps) {
    for (const imp of map.imports) {
      if (!imp.isRelative) continue;
      const target = resolveImport(map.filePath, imp.source, known);
      if (!target || target === map.filePath) continue;
      edges.push({ from: map.filePath, to: target, importedSymbols: imp.specifiers });
      outDegree.set(map.filePath, (outDegree.get(map.filePath) ?? 0) + 1);
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }
  }

  let maxScore = 1;
  for (const map of symbolMaps) {
    const raw = (inDegree.get(map.filePath) ?? 0) * 2 + (outDegree.get(map.filePath) ?? 0);
    if (raw > maxScore) maxScore = raw;
  }

  const nodes: GraphNode[] = symbolMaps
    .map((map) => {
      const inD = inDegree.get(map.filePath) ?? 0;
      const outD = outDegree.get(map.filePath) ?? 0;
      return {
        filePath: map.filePath,
        language: map.language,
        inDegree: inD,
        outDegree: outD,
        centralityScore: Math.min(1, Math.max(0, (inD * 2 + outD) / maxScore)),
        symbols: map.symbols,
      };
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  edges.sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  return { nodes, edges };
}

export function computeStats(
  nodes: GraphNode[],
  edges: GraphEdge[],
): DependencyStats {
  const totalNodes = nodes.length;
  const totalEdges = edges.length;

  let maxIn = { file: "", count: 0 };
  let maxOut = { file: "", count: 0 };
  let sumIn = 0;
  let sumOut = 0;

  for (const n of nodes) {
    sumIn += n.inDegree;
    sumOut += n.outDegree;
    if (n.inDegree > maxIn.count) maxIn = { file: n.filePath, count: n.inDegree };
    if (n.outDegree > maxOut.count) maxOut = { file: n.filePath, count: n.outDegree };
  }

  return {
    totalNodes,
    totalEdges,
    avgInDegree: totalNodes === 0 ? 0 : sumIn / totalNodes,
    avgOutDegree: totalNodes === 0 ? 0 : sumOut / totalNodes,
    maxInDegree: maxIn,
    maxOutDegree: maxOut,
  };
}

function findCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.filePath, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);
  for (const list of adj.values()) list.sort((a, b) => a.localeCompare(b));

  const cycles: string[][] = [];
  const seen = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (cycles.length >= 10) return;
    inStack.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      if (cycles.length >= 10) break;
      if (inStack.has(next)) {
        const start = stack.indexOf(next);
        if (start !== -1) {
          const cycle = stack.slice(start);
          const key = [...cycle].sort((a, b) => a.localeCompare(b)).join("|");
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push([...cycle, next]);
          }
        }
      } else if (!stack.includes(next)) {
        dfs(next);
      }
    }
    inStack.delete(node);
    stack.pop();
  }

  for (const n of nodes) {
    if (cycles.length >= 10) break;
    dfs(n.filePath);
  }

  return cycles;
}

export function detectInsights(
  nodes: GraphNode[],
  edges: GraphEdge[],
): ArchitecturalInsight {
  const stats = computeStats(nodes, edges);

  const centralModules = [...nodes]
    .sort((a, b) => b.centralityScore - a.centralityScore || a.filePath.localeCompare(b.filePath))
    .slice(0, 5)
    .map((n) => n.filePath);

  const dependencyHotspots = nodes
    .filter((n) => n.inDegree > 2 * stats.avgInDegree && n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree || a.filePath.localeCompare(b.filePath))
    .map((n) => n.filePath);

  const isolatedModules = nodes
    .filter((n) => n.inDegree === 0 && n.outDegree === 0)
    .map((n) => n.filePath)
    .sort((a, b) => a.localeCompare(b));

  return {
    centralModules,
    dependencyHotspots,
    isolatedModules,
    circularDependencies: findCycles(nodes, edges),
  };
}
