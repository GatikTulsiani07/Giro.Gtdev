export const SEMANTIC_ENGINE_VERSION = "semantic-code-intelligence-v1";
export const SEMANTIC_SCHEMA_VERSION = "semantic-code-graph-v1";
export const TYPESCRIPT_ADAPTER_VERSION = "typescript-semantic-adapter-v1";

export type SemanticLanguage = "typescript" | "javascript";
export type SemanticSymbolKind =
  | "module" | "namespace" | "class" | "interface" | "enum" | "struct"
  | "function" | "method" | "constructor" | "variable" | "constant"
  | "import" | "export";
export type SemanticVisibility = "public" | "protected" | "private" | "internal";
export type SemanticRelationshipKind =
  | "calls" | "called_by"
  | "implements" | "implemented_by"
  | "extends" | "inherited_by"
  | "imports" | "imported_by"
  | "references" | "referenced_by"
  | "overrides" | "overridden_by";
export type SemanticGraphLifecycle =
  | "building" | "validating" | "published" | "failed" | "superseded";

export interface SemanticFileSnapshot {
  readonly file: string;
  readonly content: string;
  readonly contentHash?: string;
}

export interface SemanticLocation {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface SemanticSymbolDraft extends SemanticLocation {
  readonly localKey: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SemanticSymbolKind;
  readonly visibility: SemanticVisibility;
  readonly signature: string;
  readonly documentationHash: string;
  readonly parentKey: string | null;
  readonly exported: boolean;
  readonly extendsNames: readonly string[];
  readonly implementsNames: readonly string[];
  readonly calls: readonly string[];
  readonly references: readonly string[];
}

export interface SemanticImportDraft {
  readonly source: string;
  readonly importedName: string;
  readonly localName: string;
  readonly line: number;
  readonly reExport: boolean;
}

export interface SemanticFileAnalysis {
  readonly file: string;
  readonly language: SemanticLanguage;
  readonly adapterVersion: string;
  readonly contentHash: string;
  readonly symbols: readonly SemanticSymbolDraft[];
  readonly imports: readonly SemanticImportDraft[];
  readonly diagnostics: readonly SemanticDiagnostic[];
}

export interface SemanticSymbol extends SemanticLocation {
  readonly symbolId: string;
  readonly graphVersion: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly file: string;
  readonly language: SemanticLanguage;
  readonly kind: SemanticSymbolKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly visibility: SemanticVisibility;
  readonly signature: string;
  readonly documentationHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SemanticRelationship {
  readonly relationshipId: string;
  readonly graphVersion: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly fromSymbolId: string;
  readonly toSymbolId: string;
  readonly kind: SemanticRelationshipKind;
  readonly createdAt: string;
}

export interface SemanticDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly severity: "info" | "warning" | "error";
}

export interface SemanticIndexingMetrics {
  readonly indexedSymbols: number;
  readonly indexedRelationships: number;
  readonly indexingDurationMs: number;
  readonly graphRebuilds: number;
  readonly incrementalUpdates: number;
  readonly recoveryOperations: number;
}

export interface SemanticGraph {
  readonly graphVersion: string;
  readonly schemaVersion: string;
  readonly persistenceVersion: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly snapshotFingerprint: string;
  readonly adapterVersions: readonly string[];
  readonly lifecycle: SemanticGraphLifecycle;
  readonly symbols: readonly SemanticSymbol[];
  readonly relationships: readonly SemanticRelationship[];
  readonly fileAnalyses: readonly SemanticFileAnalysis[];
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly metrics: SemanticIndexingMetrics;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface BuildSemanticGraphInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly snapshotRevision: string;
  readonly files: readonly SemanticFileSnapshot[];
  readonly indexedAt?: string;
  readonly previousGraph?: SemanticGraph | null;
}

export interface SemanticLanguageAdapter {
  readonly language: SemanticLanguage;
  readonly version: string;
  supports(file: string): boolean;
  analyze(file: string, content: string): SemanticFileAnalysis;
}

export interface SemanticNavigationResult {
  readonly query: string;
  readonly symbols: readonly SemanticSymbol[];
  readonly relationships: readonly SemanticRelationship[];
}

export interface SemanticStoreMetrics extends SemanticIndexingMetrics {}

export class SemanticCodeIntelligenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SemanticCodeIntelligenceError";
  }
}
