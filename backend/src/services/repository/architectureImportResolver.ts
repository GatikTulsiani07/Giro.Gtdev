import path from "node:path";

export interface ArchitectureImportResolution {
  sourceFile: string;
  rawImport: string;
  resolvedImport: string;
  isRelative: boolean;
}

export function resolveArchitectureImport(
  sourceFile: string,
  rawImport: string,
): ArchitectureImportResolution {
  const isRelative =
    rawImport.startsWith("./") ||
    rawImport.startsWith("../");

  if (!isRelative) {
    return {
      sourceFile,
      rawImport,
      resolvedImport: rawImport,
      isRelative,
    };
  }

  const sourceDirectory = path.dirname(sourceFile);

  return {
    sourceFile,
    rawImport,
    resolvedImport: path.normalize(
      path.join(sourceDirectory, rawImport),
    ).replaceAll("\\", "/"),
    isRelative,
  };
}