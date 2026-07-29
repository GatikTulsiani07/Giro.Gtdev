import { createHash } from "node:crypto";
import path from "node:path";
import { SemanticAdapterRegistry } from "./adapter.js";
import {
  SEMANTIC_SCHEMA_VERSION,
  SemanticCodeIntelligenceError,
  type BuildSemanticGraphInput,
  type SemanticFileAnalysis,
  type SemanticGraph,
  type SemanticNavigationResult,
  type SemanticRelationship,
  type SemanticRelationshipKind,
  type SemanticSymbol,
  type SemanticSymbolDraft,
} from "./types.js";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicSemanticSymbolId(input: {
  repositoryId: string;
  repositoryRevision: string;
  file: string;
  language: string;
  kind: string;
  qualifiedName: string;
  line: number;
  column: number;
}): string {
  return stableHash(["semantic-symbol-v1", input.repositoryId,
    input.repositoryRevision, input.file, input.language, input.kind,
    input.qualifiedName, input.line, input.column]);
}

function graphVersion(input: BuildSemanticGraphInput, analyses: readonly SemanticFileAnalysis[]) {
  return stableHash([
    SEMANTIC_SCHEMA_VERSION, input.tenantId, input.repositoryId,
    input.repositoryRevision,
    analyses.map((file) => [file.file, file.contentHash, file.adapterVersion]),
  ]);
}

function normalizePath(value: string): string {
  const result: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") result.pop();
    else result.push(segment);
  }
  return result.join("/");
}

function resolveImport(
  fromFile: string, source: string, knownFiles: ReadonlySet<string>,
): string | null {
  if (!source.startsWith(".")) return null;
  const base = normalizePath(`${path.posix.dirname(fromFile)}/${source}`);
  const roots = [base, base.replace(/\.(?:mjs|cjs|js|jsx)$/u, "")];
  const suffixes = [
    "", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
    "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
  ];
  for (const root of roots) {
    for (const suffix of suffixes) {
      const candidate = `${root}${suffix}`;
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

function terminalName(value: string): string {
  return value.replace(/\?.*$/u, "").split(/[.(<\[]/u).filter(Boolean).at(-1) ?? value;
}

interface IndexedDraft {
  readonly analysis: SemanticFileAnalysis;
  readonly draft: SemanticSymbolDraft;
  readonly symbol: SemanticSymbol;
}

const INVERSES: Readonly<Record<SemanticRelationshipKind, SemanticRelationshipKind>> = {
  calls: "called_by",
  called_by: "calls",
  implements: "implemented_by",
  implemented_by: "implements",
  extends: "inherited_by",
  inherited_by: "extends",
  imports: "imported_by",
  imported_by: "imports",
  references: "referenced_by",
  referenced_by: "references",
  overrides: "overridden_by",
  overridden_by: "overrides",
};

function indexFiles(
  input: BuildSemanticGraphInput,
  registry: SemanticAdapterRegistry,
): { analyses: SemanticFileAnalysis[]; incrementalUpdates: number; graphRebuilds: number } {
  const previous = new Map(
    (input.previousGraph?.fileAnalyses ?? []).map((item) => [item.file, item]),
  );
  const analyses: SemanticFileAnalysis[] = [];
  let changed = 0;
  for (const file of [...input.files].sort((a, b) => a.file.localeCompare(b.file))) {
    const adapter = registry.forFile(file.file);
    if (!adapter) {
      analyses.push({
        file: file.file,
        language: "typescript",
        adapterVersion: "unsupported",
        contentHash: file.contentHash ?? sourceHash(file.content),
        symbols: [],
        imports: [],
        diagnostics: [{
          code: "semantic_language_unsupported",
          message: `No semantic adapter supports ${file.file}.`,
          file: file.file,
          severity: "info",
        }],
      });
      continue;
    }
    const contentHash = file.contentHash ?? sourceHash(file.content);
    const cached = previous.get(file.file);
    if (cached?.contentHash === contentHash &&
        cached.adapterVersion === adapter.version) {
      analyses.push(cached);
    } else {
      const analysis = adapter.analyze(file.file, file.content);
      if (analysis.contentHash !== contentHash) {
        throw new SemanticCodeIntelligenceError(
          "semantic_snapshot_hash_mismatch",
          "Semantic file content does not match its snapshot hash.",
          { file: file.file },
        );
      }
      analyses.push(analysis);
      changed += 1;
    }
  }
  return {
    analyses,
    incrementalUpdates: input.previousGraph ? changed : 0,
    graphRebuilds: input.previousGraph ? 0 : 1,
  };
}

export function buildSemanticGraph(
  input: BuildSemanticGraphInput,
  registry = new SemanticAdapterRegistry(),
): SemanticGraph {
  if (!input.tenantId || !input.ownerId || !input.repositoryId ||
      !/^[0-9a-f]{40}$/u.test(input.repositoryRevision) ||
      input.repositoryRevision !== input.snapshotRevision ||
      input.ownerId !== input.repositoryOwnerId) {
    throw new SemanticCodeIntelligenceError(
      "semantic_repository_access_denied",
      "Repository ownership and immutable snapshot revision are required.",
    );
  }
  registry.verify();
  const started = Date.now();
  const indexed = indexFiles(input, registry);
  const version = graphVersion(input, indexed.analyses);
  const timestamp = input.indexedAt ?? new Date().toISOString();
  const symbols: SemanticSymbol[] = [];
  const drafts: IndexedDraft[] = [];

  for (const analysis of indexed.analyses) {
    for (const draft of analysis.symbols) {
      const symbol: SemanticSymbol = {
        symbolId: deterministicSemanticSymbolId({
          repositoryId: input.repositoryId,
          repositoryRevision: input.repositoryRevision,
          file: analysis.file,
          language: analysis.language,
          kind: draft.kind,
          qualifiedName: draft.qualifiedName,
          line: draft.line,
          column: draft.column,
        }),
        graphVersion: version,
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        file: analysis.file,
        language: analysis.language,
        kind: draft.kind,
        name: draft.name,
        qualifiedName: draft.qualifiedName,
        visibility: draft.visibility,
        signature: draft.signature,
        documentationHash: draft.documentationHash,
        line: draft.line,
        column: draft.column,
        endLine: draft.endLine,
        endColumn: draft.endColumn,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      symbols.push(symbol);
      drafts.push({ analysis, draft, symbol });
    }
  }

  const duplicateIds = symbols.filter((symbol, index) =>
    symbols.findIndex((candidate) => candidate.symbolId === symbol.symbolId) !== index);
  if (duplicateIds.length > 0) {
    throw new SemanticCodeIntelligenceError(
      "semantic_duplicate_symbol",
      "Duplicate deterministic semantic symbols were produced.",
    );
  }
  const byName = new Map<string, IndexedDraft[]>();
  const byQualified = new Map<string, IndexedDraft>();
  const modules = new Map<string, IndexedDraft>();
  for (const entry of drafts) {
    byName.set(entry.draft.name, [...(byName.get(entry.draft.name) ?? []), entry]);
    byQualified.set(entry.draft.qualifiedName, entry);
    if (entry.draft.kind === "module") modules.set(entry.analysis.file, entry);
  }
  const resolve = (name: string, owner: IndexedDraft): IndexedDraft | null => {
    const direct = byQualified.get(name) ??
      byQualified.get(`${owner.draft.qualifiedName}.${name}`);
    if (direct) return direct;
    const allCandidates = byName.get(terminalName(name)) ?? [];
    const declarations = allCandidates.filter((item) =>
      item.draft.kind !== "import" && item.draft.kind !== "export");
    const candidates = declarations.length > 0 ? declarations : allCandidates;
    return candidates.find((item) => item.analysis.file === owner.analysis.file) ??
      candidates.find((item) => item.draft.exported) ?? candidates[0] ?? null;
  };

  const relationships: SemanticRelationship[] = [];
  const relationshipKeys = new Set<string>();
  const add = (
    from: SemanticSymbol, to: SemanticSymbol, kind: SemanticRelationshipKind,
  ) => {
    if (from.symbolId === to.symbolId) return;
    const key = [from.symbolId, to.symbolId, kind].join("\0");
    if (relationshipKeys.has(key)) return;
    relationshipKeys.add(key);
    relationships.push({
      relationshipId: stableHash(["semantic-edge-v1", input.repositoryId,
        input.repositoryRevision, from.symbolId, to.symbolId, kind]),
      graphVersion: version,
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      fromSymbolId: from.symbolId,
      toSymbolId: to.symbolId,
      kind,
      createdAt: timestamp,
    });
  };
  const pair = (
    from: SemanticSymbol, to: SemanticSymbol, kind: SemanticRelationshipKind,
  ) => {
    add(from, to, kind);
    add(to, from, INVERSES[kind]);
  };

  for (const entry of drafts) {
    for (const name of entry.draft.extendsNames) {
      const target = resolve(name, entry);
      if (target) pair(entry.symbol, target.symbol, "extends");
    }
    for (const name of entry.draft.implementsNames) {
      const target = resolve(name, entry);
      if (target) pair(entry.symbol, target.symbol, "implements");
    }
    for (const name of entry.draft.calls) {
      const target = resolve(name, entry);
      if (target) pair(entry.symbol, target.symbol, "calls");
    }
    for (const name of entry.draft.references) {
      const target = resolve(name, entry);
      if (target) pair(entry.symbol, target.symbol, "references");
    }
  }

  const knownFiles = new Set(indexed.analyses.map((item) => item.file));
  for (const analysis of indexed.analyses) {
    const sourceModule = modules.get(analysis.file);
    if (!sourceModule) continue;
    for (const imported of analysis.imports) {
      const targetFile = resolveImport(analysis.file, imported.source, knownFiles);
      if (!targetFile) continue;
      const target = imported.importedName === "*" || imported.importedName === "default"
        ? modules.get(targetFile)
        : (byName.get(imported.importedName) ?? [])
          .find((item) => item.analysis.file === targetFile) ?? modules.get(targetFile);
      if (target) pair(sourceModule.symbol, target.symbol, "imports");
    }
  }

  // A same-named method in a derived class deterministically overrides the
  // method declared on its nearest resolvable base.
  for (const entry of drafts.filter((item) => item.draft.kind === "method")) {
    const ownerName = entry.draft.qualifiedName.split(".").slice(0, -1).join(".");
    const owner = byQualified.get(ownerName);
    if (!owner) continue;
    for (const baseName of owner.draft.extendsNames) {
      const base = resolve(baseName, owner);
      if (!base) continue;
      const baseMethod = byQualified.get(`${base.draft.qualifiedName}.${entry.draft.name}`);
      if (baseMethod) pair(entry.symbol, baseMethod.symbol, "overrides");
    }
  }

  symbols.sort((a, b) => a.symbolId.localeCompare(b.symbolId));
  relationships.sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
  const diagnostics = indexed.analyses.flatMap((item) => item.diagnostics)
    .sort((a, b) => (a.file ?? "").localeCompare(b.file ?? "") ||
      a.code.localeCompare(b.code));
  const duration = input.indexedAt ? 0 : Math.max(0, Date.now() - started);
  return {
    graphVersion: version,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    persistenceVersion: 1,
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    snapshotFingerprint: stableHash(indexed.analyses.map((item) =>
      [item.file, item.contentHash])),
    adapterVersions: registry.versions(),
    lifecycle: "published",
    symbols,
    relationships,
    fileAnalyses: indexed.analyses,
    diagnostics,
    metrics: {
      indexedSymbols: symbols.length,
      indexedRelationships: relationships.length,
      indexingDurationMs: duration,
      graphRebuilds: indexed.graphRebuilds,
      incrementalUpdates: indexed.incrementalUpdates,
      recoveryOperations: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

export class SemanticNavigator {
  constructor(private readonly graph: SemanticGraph) {}

  definition(query: string): SemanticNavigationResult {
    const symbols = this.graph.symbols.filter((symbol) =>
      symbol.symbolId === query || symbol.qualifiedName === query || symbol.name === query);
    return { query, symbols, relationships: [] };
  }

  private adjacent(query: string, kinds: readonly SemanticRelationshipKind[]):
  SemanticNavigationResult {
    const roots = this.definition(query).symbols;
    const ids = new Set(roots.map((item) => item.symbolId));
    const relationships = this.graph.relationships.filter((edge) =>
      ids.has(edge.fromSymbolId) && kinds.includes(edge.kind));
    const targets = new Set(relationships.map((edge) => edge.toSymbolId));
    return {
      query,
      symbols: this.graph.symbols.filter((symbol) => targets.has(symbol.symbolId)),
      relationships,
    };
  }

  references(query: string) { return this.adjacent(query, ["referenced_by"]); }
  implementations(query: string) { return this.adjacent(query, ["implemented_by"]); }
  callers(query: string) { return this.adjacent(query, ["called_by"]); }
  callees(query: string) { return this.adjacent(query, ["calls"]); }

  inheritanceChain(query: string): SemanticNavigationResult {
    return this.traverse(query, ["extends", "implements"]);
  }

  dependencyChain(query: string): SemanticNavigationResult {
    return this.traverse(query, ["imports"]);
  }

  private traverse(
    query: string, kinds: readonly SemanticRelationshipKind[],
  ): SemanticNavigationResult {
    const roots = this.definition(query).symbols;
    const visited = new Set(roots.map((item) => item.symbolId));
    const queue = [...visited];
    const relationships: SemanticRelationship[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.graph.relationships.filter((candidate) =>
        candidate.fromSymbolId === current && kinds.includes(candidate.kind))) {
        relationships.push(edge);
        if (!visited.has(edge.toSymbolId)) {
          visited.add(edge.toSymbolId);
          queue.push(edge.toSymbolId);
        }
      }
    }
    for (const root of roots) visited.delete(root.symbolId);
    return {
      query,
      symbols: this.graph.symbols.filter((symbol) => visited.has(symbol.symbolId)),
      relationships,
    };
  }
}
