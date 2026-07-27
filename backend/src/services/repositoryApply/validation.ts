import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import { artifactContentHash } from "../repositoryArtifact/validation.js";
import { proposalOutputHash } from "../repositoryProposal/validation.js";
import type {
  ApplyDiagnostic,
  ApplyOperation,
  ApplyPlan,
  ApplyQuotas,
  ApplyTransactionVersion,
  ApplyValidationCategory,
  ApplyValidationFinding,
  PrepareApplyTransactionInput,
  RepositoryApplyTransaction,
  RollbackOperation,
} from "./types.js";
import {
  REPOSITORY_APPLY_PLAN_SCHEMA_VERSION,
  RepositoryApplyError,
} from "./types.js";

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));
const unsafePath = (path: string): boolean =>
  !path.trim() || path.startsWith("/") || path.includes("\\") ||
  path.split("/").some((segment) =>
    segment === "" || segment === "." || segment === "..");
const fail = (code: string, message: string): never => {
  throw new RepositoryApplyError(code, message);
};

export function applyTransactionIdentity(
  input: PrepareApplyTransactionInput,
): string {
  return stableId("repository_apply_transaction", {
    tenantId: input.tenantId,
    proposalId: input.proposal.proposalId,
    repositoryId: input.proposal.repositoryId,
    repositoryRevision: input.proposal.repositoryRevision,
    executionId: input.proposal.executionId,
    workspaceId: input.proposal.workspaceId,
  });
}

export function validateApplyInput(
  input: PrepareApplyTransactionInput,
  quotas: ApplyQuotas,
  currentVersion: number,
  transactionCount: number,
  now: Date,
): void {
  const { proposal, workspace } = input;
  if (!input.tenantId.trim() || !input.ownerId.trim() ||
      !proposal.proposalId.trim() || !proposal.repositoryId.trim()) {
    fail("repository_apply_schema_invalid", "Apply identity is malformed.");
  }
  if (input.ownerId !== input.repositoryOwnerId ||
      input.ownerId !== input.executionOwnerId ||
      input.ownerId !== input.executionMetadata.ownerId ||
      input.ownerId !== proposal.ownerId ||
      input.ownerId !== workspace.ownerId ||
      input.tenantId !== proposal.tenantId ||
      input.tenantId !== workspace.tenantId) {
    fail("repository_apply_ownership_conflict",
      "Apply inputs belong to another owner.");
  }
  const proposalVersion = proposal.versions.at(-1);
  if (!proposalVersion) {
    throw new RepositoryApplyError(
      "repository_apply_proposal_unapproved",
      "Proposal has no immutable approved version.");
  }
  const { outputHash: _proposalOutputHash, ...proposalBody } = proposalVersion;
  if (proposalVersion.outputHash !== proposalOutputHash(proposalBody)) {
    fail("repository_apply_proposal_stale",
      "Approved proposal content hash is stale.");
  }
  const approval = [...proposal.decisions].reverse().find((decision) =>
    decision.proposalVersion === proposal.proposalVersion);
  if (proposal.lifecycle !== "approved" || approval?.verdict !== "approved" ||
      !proposalVersion.manifest.validationSummary.valid) {
    fail("repository_apply_proposal_unapproved",
      "Proposal is not approved and valid.");
  }
  if (!["active", "validating"].includes(workspace.lifecycle) ||
      !workspace.snapshot.published) {
    fail("repository_apply_workspace_invalid",
      "Workspace is not active with a published snapshot.");
  }
  if (proposal.repositoryId !== workspace.repositoryId ||
      proposal.repositoryRevision !== workspace.repositoryRevision ||
      proposal.repositoryRevision !== workspace.snapshot.repositoryRevision ||
      proposal.repositoryRevision !== workspace.snapshot.revisionHash ||
      proposal.workspaceId !== workspace.workspaceId ||
      proposal.executionId !== workspace.executionId ||
      input.executionMetadata.executionId !== workspace.executionId ||
      input.executionMetadata.workUnitId !== workspace.workUnitId) {
    fail("repository_apply_revision_stale",
      "Repository, workspace, or execution fencing is stale.");
  }
  if (input.baseTransactionVersion !== currentVersion) {
    fail("repository_apply_version_stale",
      "Apply transaction base version is stale.");
  }
  if (transactionCount >= quotas.transactionsPerProposal ||
      currentVersion >= quotas.versionsPerTransaction) {
    fail("repository_apply_quota_exceeded", "Apply transaction quota exceeded.");
  }
  if (input.artifacts.length === 0 || input.patches.length === 0) {
    fail("repository_apply_incomplete",
      "Approved artifacts and validated patches are required.");
  }
  if (input.applyLeaseExpiresAt &&
      Date.parse(input.applyLeaseExpiresAt) <= now.getTime()) {
    fail("repository_apply_lease_expired", "Apply lease has expired.");
  }

  const artifactMetadata = new Map(
    proposalVersion.assemblyMetadata.artifactVersions.map((value) =>
      [value.artifactId, value]));
  if (artifactMetadata.size !== input.artifacts.length) {
    fail("repository_apply_artifact_incompatible",
      "Artifact set does not match the approved proposal.");
  }
  for (const artifact of input.artifacts) {
    const metadata = artifactMetadata.get(artifact.artifactId);
    const version = artifact.versions.at(-1);
    const artifactApproval = [...artifact.approvals].reverse().find((value) =>
      value.artifactVersion === artifact.artifactVersion);
    if (!metadata || artifact.lifecycle !== "approved" ||
        artifactApproval?.decision !== "approved" || !version ||
        version.contentHash !== artifactContentHash(version) ||
        artifact.artifactVersion !== metadata.artifactVersion ||
        version.contentHash !== metadata.contentHash ||
        artifact.tenantId !== input.tenantId ||
        artifact.ownerId !== input.ownerId ||
        artifact.repositoryRevision !== proposal.repositoryRevision ||
        artifact.workspaceId !== workspace.workspaceId ||
        artifact.executionId !== workspace.executionId) {
      fail("repository_apply_artifact_incompatible",
        "Artifact is stale or incompatible with the proposal.");
    }
  }

  const patchMetadata = new Map(
    proposalVersion.assemblyMetadata.patchVersions.map((value) =>
      [value.patchId, value]));
  const workspacePatches = new Map(workspace.patches.map((patch) =>
    [patch.patchId, patch]));
  if (patchMetadata.size !== input.patches.length) {
    fail("repository_apply_patch_incompatible",
      "Patch set does not match the approved proposal.");
  }
  for (const patch of input.patches) {
    const metadata = patchMetadata.get(patch.patchId);
    const published = workspacePatches.get(patch.patchId);
    if (!metadata || !published ||
        stableHash(published) !== stableHash(patch) ||
        patch.patchVersion !== metadata.patchVersion ||
        patch.contentHash !== metadata.contentHash ||
        patch.snapshotHash !== workspace.snapshot.snapshotHash ||
        patch.executionId !== workspace.executionId ||
        patch.workUnitId !== workspace.workUnitId) {
      fail("repository_apply_patch_incompatible",
        "Patch is stale or incompatible with the proposal.");
    }
  }
}

function inverseName(operation: string): string {
  switch (operation) {
    case "create_file": return "delete_created_file";
    case "delete_file": return "restore_file_from_snapshot";
    case "rename_file": return "reverse_file_rename";
    case "add_symbol": return "remove_added_symbol";
    case "remove_symbol": return "restore_symbol_from_snapshot";
    case "update_symbol": return "restore_symbol_from_snapshot";
    default: return "restore_file_from_snapshot";
  }
}

export function buildApplyPlan(
  input: PrepareApplyTransactionInput,
  transactionId: string,
  transactionVersion: number,
  quotas: ApplyQuotas,
  timestamp: string,
): {
  plan: ApplyPlan;
  conflictCount: number;
} {
  const raw = [...input.artifacts]
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
    .flatMap((artifact) => artifact.versions.at(-1)!.structuredContent.operations
      .map((operation) => ({ artifact, operation })))
    .sort((left, right) =>
      left.operation.path.localeCompare(right.operation.path) ||
      (left.operation.destinationPath ?? "").localeCompare(
        right.operation.destinationPath ?? "") ||
      (left.operation.symbol ?? "").localeCompare(right.operation.symbol ?? "") ||
      left.operation.operation.localeCompare(right.operation.operation) ||
      left.artifact.artifactId.localeCompare(right.artifact.artifactId));
  if (raw.length > quotas.operationsPerPlan) {
    fail("repository_apply_quota_exceeded", "Apply operation quota exceeded.");
  }
  const signatures = new Map<string, Set<string>>();
  for (const { operation } of raw) {
    if (unsafePath(operation.path) ||
        (operation.destinationPath && unsafePath(operation.destinationPath))) {
      fail("repository_apply_plan_invalid", "Apply plan contains unsafe paths.");
    }
    const conflictKey = operation.symbol
      ? `${operation.path}#${operation.symbol}` : operation.path;
    const values = signatures.get(conflictKey) ?? new Set<string>();
    values.add(stableHash({
      operation: operation.operation,
      destinationPath: operation.destinationPath ?? null,
      symbol: operation.symbol ?? null,
      content: operation.content ?? null,
      expectedHash: operation.expectedHash ?? null,
    }));
    signatures.set(conflictKey, values);
  }
  const conflicts = [...signatures.values()].filter((values) =>
    values.size > 1).length;
  if (conflicts > 0) {
    throw new RepositoryApplyError(
      "repository_apply_conflict",
      "Apply plan contains conflicting operations.",
      { conflictCount: conflicts },
    );
  }
  const operations: ApplyOperation[] = raw.map(({ artifact, operation }, index) => ({
    operationId: stableId("repository_apply_operation", {
      transactionId, transactionVersion, sequence: index + 1,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion, operation,
    }),
    sequence: index + 1,
    operation: operation.operation,
    path: operation.path,
    destinationPath: operation.destinationPath ?? null,
    symbol: operation.symbol ?? null,
    content: operation.content ?? null,
    expectedHash: operation.expectedHash ?? null,
    artifactId: artifact.artifactId,
    artifactVersion: artifact.artifactVersion,
  }));
  const affectedFiles = sortedUnique(operations.flatMap((operation) =>
    [operation.path, operation.destinationPath ?? ""]).filter(Boolean));
  const affectedSymbols = sortedUnique(operations
    .filter((operation) => operation.symbol)
    .map((operation) => `${operation.path}#${operation.symbol}`));
  if (affectedFiles.length > quotas.filesPerPlan ||
      affectedSymbols.length > quotas.symbolsPerPlan) {
    fail("repository_apply_quota_exceeded", "Apply plan scope quota exceeded.");
  }

  const edges = operations.flatMap((operation, index) => {
    const previous = operations.slice(0, index).reverse().find((candidate) =>
      candidate.path === operation.path ||
      candidate.destinationPath === operation.path ||
      operation.destinationPath === candidate.path);
    return previous ? [{
      fromOperationId: previous.operationId,
      toOperationId: operation.operationId,
      reason: operation.symbol ? "symbol_order" as const :
        operation.destinationPath ? "destination_order" as const :
          "same_path_order" as const,
    }] : [];
  });
  if (edges.length > quotas.dependenciesPerPlan) {
    fail("repository_apply_quota_exceeded", "Dependency quota exceeded.");
  }
  const inverseOperations: RollbackOperation[] = [...operations].reverse()
    .map((operation, index) => ({
      rollbackOperationId: stableId("repository_rollback_operation", {
        transactionId, transactionVersion,
        sourceOperationId: operation.operationId,
        sequence: index + 1,
      }),
      sequence: index + 1,
      sourceOperationId: operation.operationId,
      operation: inverseName(operation.operation),
      path: operation.destinationPath ?? operation.path,
      destinationPath: operation.operation === "rename_file"
        ? operation.path : null,
      symbol: operation.symbol,
      sourceExpectedHash: operation.expectedHash,
    }));
  const rollbackBySource = new Map(inverseOperations.map((operation) =>
    [operation.sourceOperationId, operation.rollbackOperationId]));
  const diagnostics: ApplyDiagnostic[] = input.proposal.versions.at(-1)!
    .diagnostics.map((diagnostic) => ({
      diagnosticId: stableId("repository_apply_diagnostic", {
        transactionId, transactionVersion,
        sourceDiagnosticId: diagnostic.diagnosticId,
      }),
      transactionId,
      transactionVersion,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      affectedFiles: sortedUnique(diagnostic.affectedFiles),
      affectedSymbols: sortedUnique(diagnostic.affectedSymbols),
      createdAt: timestamp,
    })).sort((left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.diagnosticId.localeCompare(right.diagnosticId));
  if (diagnostics.length > quotas.diagnosticsPerTransaction) {
    fail("repository_apply_quota_exceeded", "Diagnostic quota exceeded.");
  }
  const categories: readonly ApplyValidationCategory[] = [
    "ownership", "proposal_approval", "workspace_state",
    "repository_revision", "version_fencing", "quota_validation", "lifecycle",
    "patch_compatibility", "artifact_compatibility",
  ];
  const findings: ApplyValidationFinding[] = categories.map((category) => ({
    category, passed: true, codes: [],
  }));
  const plan: ApplyPlan = {
    schemaVersion: REPOSITORY_APPLY_PLAN_SCHEMA_VERSION,
    orderedOperations: operations,
    affectedFiles,
    affectedSymbols,
    dependencyGraph: {
      operationIds: operations.map((operation) => operation.operationId),
      edges,
    },
    rollbackPlan: {
      affectedFiles,
      affectedSymbols,
      inverseOperations,
      dependencyRollback: [...edges].reverse().map((edge) => ({
        operationId: rollbackBySource.get(edge.fromOperationId)!,
        dependsOnRollbackOperationIds: [
          rollbackBySource.get(edge.toOperationId)!,
        ],
      })),
      validationCheckpoints: [
        "proposal_hash_matches",
        "repository_revision_matches",
        "affected_paths_safe",
        "inverse_operations_complete",
        "dependency_rollback_acyclic",
      ],
    },
    diagnostics,
    validationSummary: {
      valid: true,
      gateCount: findings.length,
      passedGateCount: findings.length,
      findings,
    },
  };
  if (Buffer.byteLength(JSON.stringify(plan)) > quotas.planBytes) {
    fail("repository_apply_quota_exceeded", "Apply plan byte quota exceeded.");
  }
  return { plan, conflictCount: 0 };
}

export const applyPlanHash = (
  version: Omit<ApplyTransactionVersion, "planHash">,
): string => stableHash(version);

export function validateApplyIntegrity(
  transaction: RepositoryApplyTransaction,
  quotas: ApplyQuotas,
): void {
  if (transaction.versions.length !== transaction.transactionVersion ||
      transaction.transactionVersion < 1 ||
      transaction.versions.length > quotas.versionsPerTransaction ||
      transaction.diagnostics.length > quotas.retainedDiagnostics) {
    fail("repository_apply_integrity_invalid",
      "Apply transaction history is malformed.");
  }
  for (const [index, version] of transaction.versions.entries()) {
    const { planHash: _planHash, ...body } = version;
    if (version.transactionId !== transaction.transactionId ||
        version.transactionVersion !== index + 1 ||
        version.planHash !== applyPlanHash(body) ||
        version.applyPlan.schemaVersion !==
          REPOSITORY_APPLY_PLAN_SCHEMA_VERSION ||
        !version.applyPlan.validationSummary.valid ||
        version.applyPlan.rollbackPlan.inverseOperations.length !==
          version.applyPlan.orderedOperations.length) {
      fail("repository_apply_integrity_invalid",
        "Apply transaction version is malformed.");
    }
  }
}
