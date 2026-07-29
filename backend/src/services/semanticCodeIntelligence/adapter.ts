import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import type {
  SemanticDiagnostic,
  SemanticFileAnalysis,
  SemanticImportDraft,
  SemanticLanguage,
  SemanticLanguageAdapter,
  SemanticSymbolDraft,
  SemanticSymbolKind,
  SemanticVisibility,
} from "./types.js";
import { TYPESCRIPT_ADAPTER_VERSION } from "./types.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function language(file: string): SemanticLanguage {
  return /\.(?:mjs|cjs|js|jsx)$/u.test(file) ? "javascript" : "typescript";
}

function declarationKind(node: ts.Node): SemanticSymbolKind | null {
  if (ts.isSourceFile(node)) return "module";
  if (ts.isModuleDeclaration(node)) return "namespace";
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) return "function";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) ||
      ts.isGetAccessor(node) || ts.isSetAccessor(node)) return "method";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isVariableDeclaration(node)) {
    const list = node.parent;
    return ts.isVariableDeclarationList(list) &&
      (list.flags & ts.NodeFlags.Const) !== 0 ? "constant" : "variable";
  }
  return null;
}

function nodeName(node: ts.Node, file: string): string | null {
  if (ts.isSourceFile(node)) return file;
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const declaration = node as ts.Node & { name?: ts.DeclarationName };
  const name = declaration.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ||
      ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

function nodeModifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return nodeModifiers(node).some((modifier) => modifier.kind === kind);
}

function visibility(node: ts.Node, exported: boolean): SemanticVisibility {
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return "private";
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return "protected";
  return exported ? "public" : "internal";
}

function signature(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isSourceFile(node)) return `module ${source.fileName}`;
  const text = node.getText(source);
  const body = text.search(/[={]/u);
  return (body < 0 ? text : text.slice(0, body)).replace(/\s+/gu, " ").trim();
}

function documentation(node: ts.Node, source: ts.SourceFile): string {
  return ts.getLeadingCommentRanges(source.text, node.getFullStart())
    ?.map((range) => source.text.slice(range.pos, range.end)).join("\n") ?? "";
}

function heritage(
  node: ts.Node,
  token: ts.SyntaxKind.ExtendsKeyword | ts.SyntaxKind.ImplementsKeyword,
): string[] {
  const declaration = node as ts.Node & {
    heritageClauses?: ts.NodeArray<ts.HeritageClause>;
  };
  return (declaration.heritageClauses ?? [])
    .filter((clause) => clause.token === token)
    .flatMap((clause) => clause.types.map((item) => item.expression.getText()))
    .sort();
}

function owner(node: ts.Node): ts.Node | null {
  let current = node.parent;
  while (current) {
    if (declarationKind(current)) return current;
    current = current.parent;
  }
  return null;
}

function localKey(
  file: string, kind: SemanticSymbolKind, qualifiedName: string,
  line: number, column: number,
): string {
  return [file, kind, qualifiedName, line, column].join("\0");
}

function diagnostics(source: ts.SourceFile, file: string): SemanticDiagnostic[] {
  const values = (source as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  return values.map((item) => ({
    code: `TS${item.code}`,
    message: ts.flattenDiagnosticMessageText(item.messageText, " "),
    file,
    severity: "error" as const,
  }));
}

export class TypeScriptSemanticAdapter implements SemanticLanguageAdapter {
  readonly language: SemanticLanguage;
  readonly version = TYPESCRIPT_ADAPTER_VERSION;

  constructor(languageName: SemanticLanguage = "typescript") {
    this.language = languageName;
  }

  supports(file: string): boolean {
    return this.language === "javascript"
      ? /\.(?:mjs|cjs|js|jsx)$/u.test(file)
      : /\.(?:mts|cts|ts|tsx)$/u.test(file);
  }

  analyze(file: string, content: string): SemanticFileAnalysis {
    const source = ts.createSourceFile(
      file, content, ts.ScriptTarget.Latest, true, scriptKind(file),
    );
    const symbols: SemanticSymbolDraft[] = [];
    const imports: SemanticImportDraft[] = [];
    const byNode = new Map<ts.Node, SemanticSymbolDraft>();

    const collect = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const clause = node.importClause;
        if (!clause) {
          imports.push({
            source: node.moduleSpecifier.text, importedName: "*", localName: "*",
            line, reExport: false,
          });
        }
        if (clause?.name) imports.push({
          source: node.moduleSpecifier.text, importedName: "default",
          localName: clause.name.text, line, reExport: false,
        });
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) imports.push({
          source: node.moduleSpecifier.text, importedName: "*",
          localName: bindings.name.text, line, reExport: false,
        });
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) imports.push({
            source: node.moduleSpecifier.text,
            importedName: element.propertyName?.text ?? element.name.text,
            localName: element.name.text, line, reExport: false,
          });
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (!node.exportClause) imports.push({
          source: node.moduleSpecifier.text, importedName: "*", localName: "*",
          line, reExport: true,
        });
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) imports.push({
            source: node.moduleSpecifier.text,
            importedName: element.propertyName?.text ?? element.name.text,
            localName: element.name.text, line, reExport: true,
          });
        }
      }

      const kind = declarationKind(node);
      const name = kind ? nodeName(node, file) : null;
      if (kind && name) {
        const parent = owner(node);
        const parentSymbol = parent ? byNode.get(parent) : undefined;
        const qualifiedName = parentSymbol
          ? `${parentSymbol.qualifiedName}.${name}`
          : kind === "module" ? file : name;
        const start = source.getLineAndCharacterOfPosition(node.getStart(source));
        const end = source.getLineAndCharacterOfPosition(node.getEnd());
        const exported = kind === "module" ||
          hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
          hasModifier(node.parent, ts.SyntaxKind.ExportKeyword) ||
          Boolean(parentSymbol?.exported);
        const draft: SemanticSymbolDraft = {
          localKey: localKey(file, kind, qualifiedName, start.line + 1, start.character + 1),
          name, qualifiedName, kind,
          visibility: visibility(node, exported),
          signature: signature(node, source),
          documentationHash: hash(documentation(node, source)),
          parentKey: parentSymbol?.localKey ?? null,
          exported,
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
          extendsNames: heritage(node, ts.SyntaxKind.ExtendsKeyword),
          implementsNames: heritage(node, ts.SyntaxKind.ImplementsKeyword),
          calls: [],
          references: [],
        };
        symbols.push(draft);
        byNode.set(node, draft);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);

    const moduleSymbol = byNode.get(source);
    for (const imported of imports) {
      const kind: SemanticSymbolKind = imported.reExport ? "export" : "import";
      const name = imported.localName === "*" ? imported.source : imported.localName;
      const qualifiedName =
        `${file}::${kind}:${name}:${imported.source}:${imported.line}`;
      symbols.push({
        localKey: localKey(file, kind, qualifiedName, imported.line, 1),
        name,
        qualifiedName,
        kind,
        visibility: imported.reExport ? "public" : "internal",
        signature: `${kind} ${imported.importedName} from ${imported.source}`,
        documentationHash: hash(""),
        parentKey: moduleSymbol?.localKey ?? null,
        exported: imported.reExport,
        line: imported.line,
        column: 1,
        endLine: imported.line,
        endColumn: 1,
        extendsNames: [],
        implementsNames: [],
        calls: [],
        references: imported.importedName === "*"
          ? [] : [imported.importedName],
      });
    }

    const relationships = (node: ts.Node): void => {
      const parent = owner(node);
      const draft = parent ? byNode.get(parent) : undefined;
      if (draft && ts.isCallExpression(node)) {
        (draft.calls as string[]).push(node.expression.getText(source));
      }
      if (draft && ts.isIdentifier(node)) {
        const named = parent as ts.Node & { name?: ts.Node };
        if (node !== named.name) (draft.references as string[]).push(node.text);
      }
      ts.forEachChild(node, relationships);
    };
    relationships(source);

    for (const symbol of symbols) {
      const calls = symbol.calls as string[];
      calls.splice(0, calls.length, ...[...new Set(calls)].sort());
      const references = symbol.references as string[];
      references.splice(
        0, references.length,
        ...[...new Set(references)].filter((name) => name !== symbol.name).sort(),
      );
    }
    symbols.sort((a, b) =>
      a.line - b.line || a.column - b.column || a.qualifiedName.localeCompare(b.qualifiedName));
    imports.sort((a, b) =>
      a.line - b.line || a.source.localeCompare(b.source) ||
      a.importedName.localeCompare(b.importedName));
    return {
      file,
      language: language(file),
      adapterVersion: this.version,
      contentHash: hash(content),
      symbols,
      imports,
      diagnostics: diagnostics(source, file),
    };
  }
}

export class SemanticAdapterRegistry {
  private readonly adapters: readonly SemanticLanguageAdapter[];

  constructor(adapters: readonly SemanticLanguageAdapter[] = [
    new TypeScriptSemanticAdapter("typescript"),
    new TypeScriptSemanticAdapter("javascript"),
  ]) {
    this.adapters = [...adapters];
  }

  versions(): string[] {
    return [...new Set(this.adapters.map((adapter) =>
      `${adapter.language}:${adapter.version}`))].sort();
  }

  forFile(file: string): SemanticLanguageAdapter | null {
    return this.adapters.find((adapter) => adapter.supports(file)) ?? null;
  }

  verify(): void {
    const versions = this.versions();
    if (versions.length !== this.adapters.length ||
        !this.adapters.some((adapter) => adapter.language === "typescript") ||
        !this.adapters.some((adapter) => adapter.language === "javascript") ||
        this.adapters.some((adapter) => !adapter.version.trim())) {
      throw new Error("Semantic language adapter registry is incompatible.");
    }
    for (const adapter of this.adapters) {
      const extension = adapter.language === "typescript" ? ".ts" : ".js";
      if (!adapter.supports(`adapter-probe${extension}`) ||
          adapter.supports(`adapter-probe${path.extname(extension === ".ts" ? ".js" : ".ts")}`)) {
        throw new Error("Semantic language adapter support is ambiguous.");
      }
    }
  }
}
