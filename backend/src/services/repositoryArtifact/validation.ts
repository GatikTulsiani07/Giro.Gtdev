import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  ArtifactContentOperation,
  ArtifactDiagnostic,
  ArtifactQuotas,
  ArtifactVersion,
  GenerateArtifactInput,
  RepositoryArtifact,
  StructuredArtifactContent,
} from "./types.js";
import {
  REPOSITORY_ARTIFACT_CONTENT_SCHEMA_VERSION,
  REPOSITORY_ARTIFACT_SCHEMA_VERSION,
  RepositoryArtifactError,
} from "./types.js";

const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[^\r\n]+$/u;
const allowedWorkspaceLifecycles = new Set(["active", "validating"]);
const artifactTypes = new Set([
  "source_code", "unit_tests", "integration_tests", "documentation",
  "configuration", "migration_proposal", "api_contract_update",
  "refactoring_proposal",
]);

function fail(code: string, message: string, details = {}): never {
  throw new RepositoryArtifactError(code, message, details);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function artifactIdentity(input: GenerateArtifactInput): string {
  return stableId("repository_artifact", {
    workspaceId: input.workspace.workspaceId,
    executionId: input.executionMetadata.executionId,
    workUnitId: input.executionMetadata.workUnitId,
    artifactType: input.artifactType,
  });
}

export function validateGenerationInput(
  input: GenerateArtifactInput,
  quotas: ArtifactQuotas,
  currentVersion: number,
  existingArtifactCount: number,
): void {
  if (!artifactTypes.has(input.artifactType)) {
    fail("repository_artifact_type_invalid", "Artifact type is unsupported.");
  }
  if ([input.tenantId, input.ownerId, input.repositoryOwnerId,
    input.executionOwnerId].some((value) => !value.trim())) {
    fail("repository_artifact_identity_invalid", "Artifact ownership is incomplete.");
  }
  const workspace = input.workspace;
  if (input.ownerId !== input.repositoryOwnerId ||
      input.ownerId !== input.executionOwnerId ||
      input.ownerId !== workspace.ownerId ||
      input.ownerId !== input.executionMetadata.ownerId ||
      input.ownerId !== input.workspaceMetadata.ownerId ||
      input.tenantId !== workspace.tenantId) {
    fail("repository_artifact_ownership_conflict",
      "Repository, execution, workspace, and artifact ownership must match.");
  }
  if (!allowedWorkspaceLifecycles.has(workspace.lifecycle) ||
      input.workspaceMetadata.lifecycle !== workspace.lifecycle) {
    fail("repository_artifact_workspace_lifecycle_conflict",
      "Artifacts require an active or validating repository workspace.");
  }
  if (!input.snapshot.published ||
      !input.repositoryGraph.published ||
      !input.intelligence.published ||
      !input.planning.published) {
    fail("repository_artifact_revision_unpublished",
      "Artifact generation requires published immutable revisions.");
  }
  if (input.snapshot.snapshotId !== workspace.snapshot.snapshotId ||
      input.snapshot.snapshotHash !== workspace.snapshot.snapshotHash ||
      input.snapshot.snapshotVersion !== workspace.snapshotVersion ||
      input.snapshot.repositoryRevision !== workspace.repositoryRevision ||
      input.workspaceMetadata.snapshotVersion !== workspace.snapshotVersion) {
    fail("repository_artifact_snapshot_stale",
      "Artifact snapshot is stale or does not belong to the workspace.");
  }
  const latestPatch = workspace.patches.at(-1);
  if (!latestPatch ||
      input.patch.patchId !== latestPatch.patchId ||
      input.patch.contentHash !== latestPatch.contentHash ||
      input.patch.patchVersion !== latestPatch.patchVersion ||
      input.patch.snapshotHash !== input.snapshot.snapshotHash ||
      input.workspaceMetadata.patchVersion !== input.patch.patchVersion) {
    fail("repository_artifact_patch_stale",
      "Artifact patch is stale or does not belong to the workspace.");
  }
  if (workspace.workspaceId !== input.workspaceMetadata.workspaceId ||
      workspace.executionId !== input.executionMetadata.executionId ||
      workspace.workUnitId !== input.executionMetadata.workUnitId ||
      input.patch.executionId !== workspace.executionId ||
      input.patch.workUnitId !== workspace.workUnitId) {
    fail("repository_artifact_version_fence_rejected",
      "Artifact inputs are fenced by another workspace or execution.");
  }
  if (input.baseArtifactVersion !== currentVersion) {
    fail("repository_artifact_version_stale", "Artifact base version is stale.");
  }
  if (currentVersion >= quotas.versionsPerArtifact) {
    fail("repository_artifact_version_quota_exceeded",
      "Artifact version quota exceeded.");
  }
  if (currentVersion === 0 && existingArtifactCount >= quotas.artifactsPerWorkspace) {
    fail("repository_artifact_quota_exceeded",
      "Workspace artifact quota exceeded.");
  }
  if (input.leaseExpiresAt &&
      Date.parse(input.leaseExpiresAt) <= Date.now()) {
    fail("repository_artifact_lease_expired", "Artifact generation lease expired.");
  }
}

export function buildStructuredContent(
  input: GenerateArtifactInput,
): {
  content: StructuredArtifactContent;
  affectedFiles: string[];
  affectedSymbols: string[];
  warnings: string[];
} {
  const fileOperations: ArtifactContentOperation[] = input.patch.fileOperations.map((item) => {
    if ("content" in item) {
      return {
        operation: item.operation,
        path: item.path,
        content: item.content,
        ...("expectedContentHash" in item
          ? { expectedHash: item.expectedContentHash } : {}),
      };
    }
    return {
      operation: item.operation,
      path: item.path,
      ...("destinationPath" in item ? { destinationPath: item.destinationPath } : {}),
      ...("expectedContentHash" in item
        ? { expectedHash: item.expectedContentHash } : {}),
    };
  });
  const symbolOperations: ArtifactContentOperation[] = input.patch.symbolOperations.map((item) => ({
    operation: item.operation,
    path: item.filePath,
    symbol: item.symbol,
    ...("declaration" in item ? { content: item.declaration } : {}),
    ...("expectedSymbolHash" in item ? { expectedHash: item.expectedSymbolHash } : {}),
  }));
  const operations = [...fileOperations, ...symbolOperations].sort((left, right) =>
    left.path.localeCompare(right.path) ||
    (left.symbol ?? "").localeCompare(right.symbol ?? "") ||
    left.operation.localeCompare(right.operation));
  const affectedFiles = uniqueSorted(operations.flatMap((operation) =>
    operation.destinationPath
      ? [operation.path, operation.destinationPath] : [operation.path]));
  const affectedSymbols = uniqueSorted(operations
    .map((operation) => operation.symbol)
    .filter((symbol): symbol is string => Boolean(symbol)));
  const warnings = uniqueSorted(input.patch.diagnostics
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => diagnostic.message));
  return {
    content: {
      schemaVersion: REPOSITORY_ARTIFACT_CONTENT_SCHEMA_VERSION,
      proposalOnly: true,
      artifactType: input.artifactType,
      operations,
      sourceHashes: {
        snapshot: input.snapshot.snapshotHash,
        patch: input.patch.contentHash,
        graph: input.repositoryGraph.contentHash,
        intelligence: input.intelligence.contentHash,
        planning: input.planning.contentHash,
      },
    },
    affectedFiles,
    affectedSymbols,
    warnings,
  };
}

export function validateArtifactVersion(
  version: ArtifactVersion,
  quotas: ArtifactQuotas,
): void {
  if (!Number.isInteger(version.artifactVersion) || version.artifactVersion < 1 ||
      version.structuredContent.schemaVersion !==
        REPOSITORY_ARTIFACT_CONTENT_SCHEMA_VERSION ||
      version.structuredContent.proposalOnly !== true ||
      !artifactTypes.has(version.structuredContent.artifactType) ||
      !Number.isFinite(version.confidence) ||
      version.confidence < 0 || version.confidence > 1) {
    fail("repository_artifact_schema_invalid", "Artifact schema validation failed.");
  }
  if (version.structuredContent.operations.length > quotas.operationsPerArtifact ||
      version.diagnostics.length > quotas.diagnosticsPerArtifact ||
      Buffer.byteLength(JSON.stringify(version.structuredContent), "utf8") >
        quotas.artifactBytes) {
    fail("repository_artifact_quota_exceeded", "Artifact content quota exceeded.");
  }
  for (const operation of version.structuredContent.operations) {
    if (!operation.operation.trim() || !safePath.test(operation.path) ||
        (operation.destinationPath && !safePath.test(operation.destinationPath))) {
      fail("repository_artifact_schema_invalid",
        "Artifact contains an unsafe or malformed file operation.",
        { filePath: operation.path });
    }
  }
  const expected = artifactContentHash(version);
  if (version.contentHash !== expected) {
    fail("repository_artifact_content_hash_invalid",
      "Artifact content hash does not match its immutable payload.");
  }
}

export function artifactContentHash(
  version: Omit<ArtifactVersion, "contentHash"> | ArtifactVersion,
): string {
  return stableHash({
    artifactId: version.artifactId,
    artifactVersion: version.artifactVersion,
    structuredContent: version.structuredContent,
    affectedFiles: version.affectedFiles,
    affectedSymbols: version.affectedSymbols,
    diagnostics: version.diagnostics,
    confidence: version.confidence,
    warnings: version.warnings,
    generationMetadata: version.generationMetadata,
  });
}

export function createDiagnostics(
  artifactId: string,
  artifactVersion: number,
  input: GenerateArtifactInput,
  createdAt: string,
): ArtifactDiagnostic[] {
  return [...input.patch.diagnostics]
    .sort((left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message))
    .map((diagnostic, index) => ({
      diagnosticId: stableId("repository_artifact_diagnostic", {
        artifactId, artifactVersion, index, code: diagnostic.code,
      }),
      severity: diagnostic.severity === "validation_failure"
        ? "validation_finding" : diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      affectedFiles: uniqueSorted(diagnostic.affectedFiles),
      affectedSymbols: uniqueSorted(diagnostic.affectedSymbols),
      createdAt,
    }));
}

export function validateArtifactIntegrity(
  artifact: RepositoryArtifact,
  quotas: ArtifactQuotas,
): void {
  if (artifact.schemaVersion !== REPOSITORY_ARTIFACT_SCHEMA_VERSION ||
      artifact.artifactVersion !== (artifact.versions.at(-1)?.artifactVersion ?? 0) ||
      artifact.versions.some((version, index) =>
        version.artifactVersion !== index + 1 ||
        version.artifactId !== artifact.artifactId ||
        version.structuredContent.artifactType !== artifact.artifactType)) {
    fail("repository_artifact_schema_invalid",
      "Artifact history or schema is malformed.");
  }
  artifact.versions.forEach((version) => validateArtifactVersion(version, quotas));
}
