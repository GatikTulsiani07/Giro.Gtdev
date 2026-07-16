import type { ExtractedSymbol, FileSymbolMap, SymbolKind } from "../graph/types.js";
import type {
  RepositoryGraphBuildInput,
  RepositoryGraphEdge,
  RepositoryGraphEdgeKind,
  RepositoryGraphNode,
  RepositoryGraphNodeKind,
  RepositorySymbolGraph,
} from "./graphTypes.js";

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

function resolveImport(fromFile: string, source: string, known: Set<string>): string | null {
  const base = dirname(fromFile);
  const joined = normalize(base ? `${base}/${source}` : source);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = normalize(joined + suffix);
    if (known.has(candidate)) return candidate;
  }
  const rewritten = joined.replace(/\.(js|jsx)$/, "");
  if (rewritten !== joined) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = normalize(rewritten + suffix);
      if (known.has(candidate)) return candidate;
    }
  }
  return null;
}

function nodeKind(symbol: ExtractedSymbol): RepositoryGraphNodeKind {
  if (symbol.kind === "variable") return symbol.exported ? "exported_member" : "constant";
  return symbol.kind;
}

function moduleId(repositoryId: string, filePath: string): string {
  return `${repositoryId}:module:${filePath}`;
}

function symbolId(repositoryId: string, filePath: string, symbol: ExtractedSymbol): string {
  return `${repositoryId}:symbol:${filePath}:${symbol.line}:${symbol.kind}:${symbol.name}`;
}

function importedMemberId(repositoryId: string, filePath: string, name: string, line: number): string {
  return `${repositoryId}:import:${filePath}:${line}:${name}`;
}

function addEdge(
  edges: RepositoryGraphEdge[],
  seen: Set<string>,
  fromSymbolId: string,
  toSymbolId: string,
  kind: RepositoryGraphEdgeKind,
): void {
  if (fromSymbolId === toSymbolId) return;
  const key = `${fromSymbolId}\u0000${toSymbolId}\u0000${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ fromSymbolId, toSymbolId, kind });
}

function sortGraph(graph: RepositorySymbolGraph): RepositorySymbolGraph {
  return {
    ...graph,
    nodes: [...graph.nodes].sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.kind.localeCompare(b.kind) ||
        a.name.localeCompare(b.name) ||
        a.symbolId.localeCompare(b.symbolId),
    ),
    edges: [...graph.edges].sort(
      (a, b) =>
        a.fromSymbolId.localeCompare(b.fromSymbolId) ||
        a.toSymbolId.localeCompare(b.toSymbolId) ||
        a.kind.localeCompare(b.kind),
    ),
  };
}

function relationships(symbol: ExtractedSymbol): { extends: string[]; implements: string[] } {
  const maybe = symbol as ExtractedSymbol & {
    extends?: readonly string[];
    implements?: readonly string[];
  };
  return {
    extends: [...(maybe.extends ?? [])].sort((a, b) => a.localeCompare(b)),
    implements: [...(maybe.implements ?? [])].sort((a, b) => a.localeCompare(b)),
  };
}

function findByName(
  symbolByName: Map<string, string[]>,
  name: string,
): string[] {
  return symbolByName.get(name)?.slice().sort((a, b) => a.localeCompare(b)) ?? [];
}

export function buildRepositorySymbolGraph(input: RepositoryGraphBuildInput): RepositorySymbolGraph {
  const nodes: RepositoryGraphNode[] = [];
  const edges: RepositoryGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const knownFiles = new Set(input.symbolMaps.map((map) => map.filePath));
  const symbolByName = new Map<string, string[]>();
  const exportedByFileAndName = new Map<string, string>();
  const moduleByFile = new Map<string, string>();

  for (const map of input.symbolMaps) {
    const id = moduleId(input.repositoryId, map.filePath);
    moduleByFile.set(map.filePath, id);
    nodes.push({
      symbolId: id,
      repositoryId: input.repositoryId,
      name: map.filePath,
      kind: "module",
      language: map.language,
      file: map.filePath,
      line: 1,
      repositoryVersion: input.repositoryVersion,
    });

    for (const symbol of map.symbols) {
      const sid = symbolId(input.repositoryId, map.filePath, symbol);
      nodes.push({
        symbolId: sid,
        repositoryId: input.repositoryId,
        name: symbol.name,
        kind: nodeKind(symbol),
        language: map.language,
        file: map.filePath,
        line: symbol.line,
        repositoryVersion: input.repositoryVersion,
      });
      if (!symbolByName.has(symbol.name)) symbolByName.set(symbol.name, []);
      symbolByName.get(symbol.name)!.push(sid);
      if (symbol.exported) exportedByFileAndName.set(`${map.filePath}\u0000${symbol.name}`, sid);
      addEdge(edges, edgeKeys, id, sid, "child");
      addEdge(edges, edgeKeys, sid, id, "parent");
      if (symbol.exported) addEdge(edges, edgeKeys, id, sid, "exports");
    }
  }

  for (const map of input.symbolMaps) {
    const fromModule = moduleByFile.get(map.filePath);
    if (!fromModule) continue;

    for (const symbol of map.symbols) {
      const fromSymbol = symbolId(input.repositoryId, map.filePath, symbol);
      const rel = relationships(symbol);
      for (const parent of rel.extends) {
        for (const target of findByName(symbolByName, parent)) {
          addEdge(edges, edgeKeys, fromSymbol, target, "extends");
          addEdge(edges, edgeKeys, fromSymbol, target, "references");
        }
      }
      for (const implemented of rel.implements) {
        for (const target of findByName(symbolByName, implemented)) {
          addEdge(edges, edgeKeys, fromSymbol, target, "implements");
          addEdge(edges, edgeKeys, fromSymbol, target, "references");
        }
      }
    }

    for (const imp of map.imports) {
      if (!imp.isRelative) continue;
      const targetFile = resolveImport(map.filePath, imp.source, knownFiles);
      if (!targetFile) continue;
      addEdge(edges, edgeKeys, fromModule, moduleId(input.repositoryId, targetFile), "imports");
      const line = (imp as typeof imp & { line?: number }).line ?? 1;
      for (const specifier of imp.specifiers) {
        const importId = importedMemberId(input.repositoryId, map.filePath, specifier, line);
        nodes.push({
          symbolId: importId,
          repositoryId: input.repositoryId,
          name: specifier,
          kind: "imported_member",
          language: map.language,
          file: map.filePath,
          line,
          repositoryVersion: input.repositoryVersion,
        });
        addEdge(edges, edgeKeys, fromModule, importId, "child");
        addEdge(edges, edgeKeys, importId, fromModule, "parent");
        const target = exportedByFileAndName.get(`${targetFile}\u0000${specifier}`);
        if (target) {
          addEdge(edges, edgeKeys, importId, target, "imports");
          addEdge(edges, edgeKeys, importId, target, "references");
          addEdge(edges, edgeKeys, fromModule, target, "references");
        }
      }
    }
  }

  return sortGraph({
    repositoryId: input.repositoryId,
    repositoryVersion: input.repositoryVersion,
    nodes,
    edges,
  });
}
