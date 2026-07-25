import { Buffer } from "node:buffer";
import path from "node:path";

import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  CreateWorkspaceInput, FileOperation, GeneratePatchInput, PatchDiagnostic,
  PublishedWorkspaceSnapshot, RepositoryPatch, RepositoryWorkspace, SymbolOperation,
  WorkspaceQuotas, WorkspaceSnapshot,
} from "./types.js";
import { RepositoryWorkspaceError } from "./types.js";

export function immutableWorkspaceClone<T>(value: T): T {
  const result = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(result);
  return result;
}

export function workspaceIdentity(input: CreateWorkspaceInput): string {
  return stableId("repository_workspace", {
    tenantId: input.tenantId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    executionId: input.executionId,
    workUnitId: input.workUnitId,
    ownerId: input.ownerId,
    snapshotVersion: input.snapshot.snapshotVersion,
  });
}

export function validatePublishedSnapshot(
  input: CreateWorkspaceInput,
  now: Date,
): WorkspaceSnapshot {
  const snapshot = input.snapshot;
  if (snapshot.published !== true ||
      snapshot.tenantId !== input.tenantId ||
      snapshot.repositoryId !== input.repositoryId ||
      snapshot.repositoryRevision !== input.repositoryRevision ||
      snapshot.revisionHash !== input.repositoryRevision ||
      !snapshot.snapshotVersion.trim() || !snapshot.revisionHash.trim() ||
      !snapshot.graphVersion.trim() || !snapshot.intelligenceVersion.trim() ||
      !snapshot.retrievalVersion.trim() || !snapshot.planningVersion.trim()) {
    throw new RepositoryWorkspaceError("workspace_snapshot_unpublished",
      "Workspace snapshot is unpublished or outside the requested repository revision.");
  }
  const snapshotHash = stableHash(snapshot);
  return immutableWorkspaceClone({
    ...snapshot,
    snapshotId: stableId("repository_workspace_snapshot", {
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      snapshotVersion: snapshot.snapshotVersion,
      snapshotHash,
    }),
    snapshotHash,
    createdAt: now.toISOString(),
  });
}

export function validateManagedPath(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new RepositoryWorkspaceError("workspace_patch_path_invalid",
      "Patch paths must be normalized repository-relative paths.", { filePath: value });
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    throw new RepositoryWorkspaceError("workspace_patch_path_invalid",
      "Patch paths must be normalized repository-relative paths.", { filePath: value });
  }
  return value;
}

function validateFileOperation(operation: FileOperation): void {
  validateManagedPath(operation.path);
  if (operation.operation === "rename_file") validateManagedPath(operation.destinationPath);
  if ((operation.operation === "create_file" || operation.operation === "update_file") &&
      typeof operation.content !== "string") {
    throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
      "File content must be a string.");
  }
  if (operation.operation !== "create_file" && !operation.expectedContentHash.trim()) {
    throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
      "Existing-file operations require an expected content hash.");
  }
}

function validateSymbolOperation(operation: SymbolOperation): void {
  validateManagedPath(operation.filePath);
  if (!operation.symbol.trim()) {
    throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
      "Symbol operations require a symbol identity.");
  }
  if (operation.operation !== "remove_symbol" && !operation.declaration.trim()) {
    throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
      "Symbol declarations cannot be empty.");
  }
  if (operation.operation !== "add_symbol" && !operation.expectedSymbolHash.trim()) {
    throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
      "Existing-symbol operations require an expected symbol hash.");
  }
}

function validateDiagnostics(diagnostics: readonly PatchDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (!diagnostic.code.trim() || !diagnostic.message.trim()) {
      throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
        "Diagnostics require structured codes and messages.");
    }
    diagnostic.affectedFiles.forEach(validateManagedPath);
    if (diagnostic.affectedSymbols.some((symbol) => !symbol.trim())) {
      throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
        "Affected symbols cannot be empty.");
    }
  }
}

export function validatePatchInput(input: GeneratePatchInput, quotas: WorkspaceQuotas): void {
  if (!Number.isInteger(input.basePatchVersion) || input.basePatchVersion < 0 ||
      typeof input.confidence !== "number" || !Number.isFinite(input.confidence) ||
      input.confidence < 0 || input.confidence > 1) {
    throw new RepositoryWorkspaceError("workspace_patch_schema_invalid",
      "Patch version or confidence is invalid.");
  }
  if (input.fileOperations.length > quotas.fileOperationsPerPatch ||
      input.symbolOperations.length > quotas.symbolOperationsPerPatch ||
      input.diagnostics.length > quotas.diagnosticsPerPatch) {
    throw new RepositoryWorkspaceError("workspace_patch_quota_exceeded",
      "Patch operation or diagnostic quota exceeded.");
  }
  input.fileOperations.forEach(validateFileOperation);
  input.symbolOperations.forEach(validateSymbolOperation);
  validateDiagnostics(input.diagnostics);

  const touched = new Set<string>();
  for (const operation of input.fileOperations) {
    const paths = operation.operation === "rename_file"
      ? [operation.path, operation.destinationPath] : [operation.path];
    for (const filePath of paths) {
      if (touched.has(filePath)) {
        throw new RepositoryWorkspaceError("workspace_patch_path_conflict",
          "A patch contains duplicate or conflicting file operations.", { filePath });
      }
      touched.add(filePath);
    }
  }
  const symbols = new Set<string>();
  for (const operation of input.symbolOperations) {
    const key = `${operation.filePath}\0${operation.symbol}`;
    if (symbols.has(key)) {
      throw new RepositoryWorkspaceError("workspace_patch_symbol_conflict",
        "A patch contains conflicting symbol operations.", {
          filePath: operation.filePath, symbol: operation.symbol,
        });
    }
    symbols.add(key);
    if (input.fileOperations.some((fileOperation) =>
      fileOperation.path === operation.filePath &&
      (fileOperation.operation === "delete_file" || fileOperation.operation === "rename_file"))) {
      throw new RepositoryWorkspaceError("workspace_patch_symbol_conflict",
        "Symbols cannot be edited in files deleted or renamed by the same patch.");
    }
  }
  if (Buffer.byteLength(JSON.stringify({
    fileOperations: input.fileOperations,
    symbolOperations: input.symbolOperations,
    diagnostics: input.diagnostics,
  })) > quotas.patchBytes) {
    throw new RepositoryWorkspaceError("workspace_patch_quota_exceeded",
      "Serialized patch exceeds its byte quota.");
  }
}

export function patchContentHash(patch: Omit<RepositoryPatch,
  "patchId" | "contentHash" | "createdAt" | "validatedAt">): string {
  return stableHash(patch);
}

export function validateWorkspaceIntegrity(workspace: RepositoryWorkspace): void {
  if (stableHash({
    published: workspace.snapshot.published,
    tenantId: workspace.snapshot.tenantId,
    repositoryId: workspace.snapshot.repositoryId,
    repositoryRevision: workspace.snapshot.repositoryRevision,
    snapshotVersion: workspace.snapshot.snapshotVersion,
    revisionHash: workspace.snapshot.revisionHash,
    graphVersion: workspace.snapshot.graphVersion,
    intelligenceVersion: workspace.snapshot.intelligenceVersion,
    retrievalVersion: workspace.snapshot.retrievalVersion,
    planningVersion: workspace.snapshot.planningVersion,
  }) !== workspace.snapshot.snapshotHash ||
      workspace.repositoryRevision !== workspace.snapshot.repositoryRevision ||
      workspace.snapshotVersion !== workspace.snapshot.snapshotVersion) {
    throw new RepositoryWorkspaceError("workspace_snapshot_stale",
      "Workspace snapshot integrity or revision fence is stale.");
  }
  workspace.patches.forEach((patch, index) => {
    const previous = workspace.patches[index - 1];
    if (patch.patchVersion <= 0 ||
        (previous && patch.patchVersion !== previous.patchVersion + 1) ||
        patch.snapshotHash !== workspace.snapshot.snapshotHash) {
      throw new RepositoryWorkspaceError("workspace_patch_version_stale",
        "Patch history contains a stale version or snapshot.");
    }
  });
}
