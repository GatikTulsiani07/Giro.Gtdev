import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { TrustedRepositoryCheckoutPath } from "../security/repositoryPaths.js";
import { resolveRepositoryPath } from "../security/repositoryPaths.js";
import { shouldIgnoreFile, shouldIgnorePath } from "../repository/ignore.js";
import {
  REPOSITORY_GRAPH_PARSER_VERSION,
  type ParsedGraphFile,
  type ParsedGraphImport,
  type ParsedGraphSymbol,
  type RepositoryGraphNodeKind,
  type RepositoryLanguageParser,
} from "./graphTypes.js";

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function language(filePath: string): "typescript" | "javascript" {
  return filePath.endsWith(".js") || filePath.endsWith(".jsx")
    ? "javascript"
    : "typescript";
}

function nameText(node: ts.Node): string | null {
  const named = node as ts.Node & { name?: ts.DeclarationName };
  if (!named.name) return ts.isConstructorDeclaration(node) ? "constructor" : null;
  if (ts.isIdentifier(named.name) || ts.isPrivateIdentifier(named.name)) return named.name.text;
  if (ts.isStringLiteral(named.name) || ts.isNumericLiteral(named.name)) return named.name.text;
  return named.name.getText();
}

function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function isExported(node: ts.Node): boolean {
  return modifiers(node).some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword ||
    modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function isDefaultExport(node: ts.Node): boolean {
  return modifiers(node).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function declarationContainer(node: ts.Node): ts.Node {
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
    return node.parent.parent;
  }
  return node;
}

function declarationKind(node: ts.Node): RepositoryGraphNodeKind | null {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return "function";
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type_alias";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) return "method";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isModuleDeclaration(node)) return "namespace";
  return null;
}

function heritageNames(node: ts.Node, token: ts.SyntaxKind.ExtendsKeyword | ts.SyntaxKind.ImplementsKeyword): string[] {
  const declaration = node as ts.Node & { heritageClauses?: ts.NodeArray<ts.HeritageClause> };
  return (declaration.heritageClauses ?? [])
    .filter((clause) => clause.token === token)
    .flatMap((clause) => clause.types.map((type) => type.expression.getText()))
    .sort((left, right) => left.localeCompare(right));
}

function ownerDeclaration(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (declarationKind(current)) return current;
    current = current.parent;
  }
  return null;
}

function declarationKey(filePath: string, node: ts.Node, source: ts.SourceFile, name: string, kind: string): string {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${filePath}\u0000${kind}\u0000${name}\u0000${start.line + 1}\u0000${start.character + 1}`;
}

export class TypeScriptJavaScriptParser implements RepositoryLanguageParser {
  readonly parserVersion = REPOSITORY_GRAPH_PARSER_VERSION;

  supports(filePath: string): boolean {
    return EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  parse(filePath: string, sourceText: string): ParsedGraphFile {
    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(filePath),
    );
    const symbols: ParsedGraphSymbol[] = [];
    const imports: ParsedGraphImport[] = [];
    const byNode = new Map<ts.Node, ParsedGraphSymbol>();
    const localExports = new Map<string, { defaultExport: boolean }>();

    const addImport = (
      sourceName: string,
      line: number,
      importedName: string,
      localName: string,
      reExport = false,
      exportAll = false,
    ) => imports.push({ source: sourceName, line, importedName, localName, reExport, exportAll });

    const collectDeclarations = (node: ts.Node, parentQualifiedName = ""): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const clause = node.importClause;
        if (clause?.name) addImport(node.moduleSpecifier.text, line, "default", clause.name.text);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          addImport(node.moduleSpecifier.text, line, "*", clause.namedBindings.name.text);
        } else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            addImport(
              node.moduleSpecifier.text,
              line,
              element.propertyName?.text ?? element.name.text,
              element.name.text,
            );
          }
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (!node.exportClause) addImport(node.moduleSpecifier.text, line, "*", "*", true, true);
        else if (ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            addImport(
              node.moduleSpecifier.text,
              line,
              element.propertyName?.text ?? element.name.text,
              element.name.text,
              true,
            );
          }
        }
      }
      if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause &&
          ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          localExports.set(element.propertyName?.text ?? element.name.text, {
            defaultExport: element.name.text === "default",
          });
        }
      }
      if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
        localExports.set(node.expression.text, { defaultExport: true });
      }

      const kind = declarationKind(node);
      const rawName = kind
        ? nameText(node) ?? (isDefaultExport(node) ? "default" : null)
        : null;
      if (kind && rawName) {
        const parent = ownerDeclaration(node);
        const parentSymbol = parent ? byNode.get(parent) : undefined;
        const qualifiedName = parentSymbol
          ? `${parentSymbol.qualifiedName}.${rawName}`
          : parentQualifiedName
            ? `${parentQualifiedName}.${rawName}`
            : rawName;
        const start = source.getLineAndCharacterOfPosition(node.getStart(source));
        const end = source.getLineAndCharacterOfPosition(node.getEnd());
        const symbol: ParsedGraphSymbol = {
          key: declarationKey(filePath, node, source, rawName, kind),
          name: rawName,
          qualifiedName,
          kind,
          filePath,
          language: language(filePath),
          line: start.line + 1,
          endLine: end.line + 1,
          column: start.character + 1,
          endColumn: end.character + 1,
          exported:
            isExported(declarationContainer(node)) ||
            isExported(node.parent) ||
            Boolean(parentSymbol?.exported),
          defaultExport:
            isDefaultExport(declarationContainer(node)) ||
            isDefaultExport(node.parent),
          parentKey: parentSymbol?.key ?? null,
          extendsNames: heritageNames(node, ts.SyntaxKind.ExtendsKeyword),
          implementsNames: heritageNames(node, ts.SyntaxKind.ImplementsKeyword),
          calls: [],
          references: [],
        };
        symbols.push(symbol);
        byNode.set(node, symbol);
      }
      ts.forEachChild(node, (child) => collectDeclarations(child, parentQualifiedName));
    };
    collectDeclarations(source);
    for (const symbol of symbols) {
      const localExport = localExports.get(symbol.name);
      if (!localExport) continue;
      symbol.exported = true;
      symbol.defaultExport ||= localExport.defaultExport;
    }

    const visitRelationships = (node: ts.Node): void => {
      const owner = ownerDeclaration(node);
      const symbol = owner ? byNode.get(owner) : undefined;
      if (symbol && ts.isCallExpression(node)) {
        symbol.calls.push(node.expression.getText());
      }
      if (symbol && ts.isIdentifier(node) && node !== (owner as { name?: ts.Node }).name) {
        symbol.references.push(node.text);
      }
      ts.forEachChild(node, visitRelationships);
    };
    visitRelationships(source);

    for (const symbol of symbols) {
      symbol.calls = [...new Set(symbol.calls)].sort((a, b) => a.localeCompare(b));
      symbol.references = [...new Set(symbol.references)]
        .filter((name) => name !== symbol.name)
        .sort((a, b) => a.localeCompare(b));
    }
    const referencedNames = new Set(symbols.flatMap((symbol) => [
      ...symbol.references,
      ...symbol.calls.map((call) => call.split(/[.(]/).filter(Boolean).at(-1) ?? call),
    ]));
    for (let index = symbols.length - 1; index >= 0; index -= 1) {
      const symbol = symbols[index]!;
      if (symbol.kind === "variable" && !symbol.exported && !referencedNames.has(symbol.name)) {
        symbols.splice(index, 1);
      }
    }
    symbols.sort((left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.column - right.column ||
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name));
    imports.sort((left, right) =>
      left.line - right.line ||
      left.source.localeCompare(right.source) ||
      left.importedName.localeCompare(right.importedName) ||
      left.localName.localeCompare(right.localName));
    return {
      filePath,
      language: language(filePath),
      symbols,
      imports,
      parserFailures: (
        (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
          .parseDiagnostics ?? []
      ).map((diagnostic: ts.Diagnostic) => ({
        code: `TS${diagnostic.code}`,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      })),
    };
  }
}

export interface ParseRepositoryAstOptions {
  parser?: RepositoryLanguageParser;
  maxFileBytes?: number;
  signal?: AbortSignal;
}

export async function parseRepositoryAst(
  repositoryRoot: TrustedRepositoryCheckoutPath,
  options: ParseRepositoryAstOptions = {},
): Promise<ParsedGraphFile[]> {
  const parser = options.parser ?? new TypeScriptJavaScriptParser();
  const maxFileBytes = options.maxFileBytes ?? 5_242_880;
  const filePaths: string[] = [];
  async function walk(directory: string): Promise<void> {
    options.signal?.throwIfAborted();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = path.relative(repositoryRoot, path.join(directory, entry.name)).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (entry.name === ".git" || shouldIgnorePath(relative)) continue;
        await walk(await resolveRepositoryPath(repositoryRoot, relative, {
          mustExist: true,
          requireDirectory: true,
        }));
      } else if (
        entry.isFile() &&
        !shouldIgnorePath(relative) &&
        !shouldIgnoreFile(entry.name) &&
        parser.supports(relative)
      ) {
        const safe = await resolveRepositoryPath(repositoryRoot, relative, {
          mustExist: true,
          requireFile: true,
        });
        if ((await stat(safe)).size <= maxFileBytes) filePaths.push(relative);
      }
    }
  }
  await walk(repositoryRoot);
  const parsed: ParsedGraphFile[] = [];
  for (const filePath of filePaths.sort((left, right) => left.localeCompare(right))) {
    options.signal?.throwIfAborted();
    const safe = await resolveRepositoryPath(repositoryRoot, filePath, {
      mustExist: true,
      requireFile: true,
    });
    parsed.push(parser.parse(filePath, await readFile(safe, "utf8")));
  }
  return parsed;
}
