import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  AssembleProposalInput,
  ChangeManifest,
  ProposalDiagnostic,
  ProposalOutputMetrics,
  ProposalQuotas,
  ProposalValidationCategory,
  ProposalValidationFinding,
  ProposalVersion,
} from "./types.js";
import {
  REPOSITORY_PROPOSAL_OUTPUT_SCHEMA_VERSION,
  RepositoryProposalError,
} from "./types.js";

const unsafePath = (path: string): boolean =>
  !path.trim() ||
  path.startsWith("/") ||
  path.includes("\\") ||
  path.split("/").some((segment) =>
    segment === "" || segment === "." || segment === "..");

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export function proposalIdentity(input: AssembleProposalInput): string {
  return stableId("repository_proposal", {
    tenantId: input.tenantId,
    repositoryId: input.workspace.repositoryId,
    repositoryRevision: input.workspace.repositoryRevision,
    executionId: input.executionMetadata.executionId,
    workspaceId: input.workspace.workspaceId,
  });
}

function fail(code: string, message: string): never {
  throw new RepositoryProposalError(code, message);
}

export function validateProposalInput(
  input: AssembleProposalInput,
  quotas: ProposalQuotas,
  currentVersion: number,
  proposalCount: number,
  now: Date,
): void {
  const { workspace } = input;
  if (!input.tenantId.trim() || !input.ownerId.trim() ||
      !workspace.repositoryId.trim() || !workspace.repositoryRevision.trim() ||
      !input.executionMetadata.executionId.trim()) {
    fail("repository_proposal_schema_invalid", "Proposal identity is malformed.");
  }
  if (input.ownerId !== input.repositoryOwnerId ||
      input.ownerId !== input.executionOwnerId ||
      input.ownerId !== input.executionMetadata.ownerId ||
      input.ownerId !== workspace.ownerId ||
      input.tenantId !== workspace.tenantId) {
    fail("repository_proposal_ownership_conflict",
      "Proposal inputs belong to another owner.");
  }
  if (!workspace.snapshot.published) {
    fail("repository_proposal_revision_unpublished",
      "Workspace snapshot is unpublished.");
  }
  if (!["active", "validating"].includes(workspace.lifecycle)) {
    fail("repository_proposal_lifecycle_conflict",
      "Workspace is not available for proposal assembly.");
  }
  if (workspace.repositoryRevision !== workspace.snapshot.repositoryRevision ||
      workspace.repositoryRevision !== workspace.snapshot.revisionHash ||
      workspace.repositoryId !== workspace.snapshot.repositoryId ||
      workspace.executionId !== input.executionMetadata.executionId ||
      workspace.workUnitId !== input.executionMetadata.workUnitId) {
    fail("repository_proposal_revision_stale",
      "Workspace or execution metadata is stale.");
  }
  if (input.baseProposalVersion !== currentVersion) {
    fail("repository_proposal_version_stale",
      "Proposal base version is stale.");
  }
  if (proposalCount >= quotas.proposalsPerWorkspace ||
      currentVersion >= quotas.versionsPerProposal) {
    fail("repository_proposal_quota_exceeded", "Proposal quota exceeded.");
  }
  if (input.artifacts.length === 0 || input.reviews.length === 0 ||
      input.patches.length === 0) {
    fail("repository_proposal_incomplete",
      "Artifacts, reviews, and patches are required.");
  }
  if (input.artifacts.length > quotas.artifactsPerProposal ||
      input.reviews.length > quotas.reviewsPerProposal ||
      input.patches.length > quotas.patchesPerProposal) {
    fail("repository_proposal_quota_exceeded", "Assembly input quota exceeded.");
  }
  if (input.assemblyLeaseExpiresAt &&
      Date.parse(input.assemblyLeaseExpiresAt) <= now.getTime()) {
    fail("repository_proposal_lease_expired", "Assembly lease has expired.");
  }

  const workspacePatchById = new Map(workspace.patches.map((patch) =>
    [patch.patchId, patch]));
  for (const patch of input.patches) {
    const published = workspacePatchById.get(patch.patchId);
    if (!published || stableHash(published) !== stableHash(patch)) {
      fail("repository_proposal_patch_unpublished",
        "Patch is unpublished or stale.");
    }
    if (patch.workspaceId !== workspace.workspaceId ||
        patch.executionId !== workspace.executionId ||
        patch.workUnitId !== workspace.workUnitId ||
        patch.snapshotHash !== workspace.snapshot.snapshotHash) {
      fail("repository_proposal_patch_stale", "Patch fencing is stale.");
    }
  }

  const artifacts = new Map<string, (typeof input.artifacts)[number]>();
  for (const artifact of input.artifacts) {
    if (artifacts.has(artifact.artifactId)) {
      fail("repository_proposal_schema_invalid", "Artifact IDs must be unique.");
    }
    artifacts.set(artifact.artifactId, artifact);
    const version = artifact.versions.at(-1);
    const approval = [...artifact.approvals].reverse().find((candidate) =>
      candidate.artifactVersion === artifact.artifactVersion);
    if (artifact.lifecycle !== "approved" || approval?.decision !== "approved") {
      fail("repository_proposal_artifact_unapproved",
        "Every artifact must be approved.");
    }
    if (!version || version.artifactVersion !== artifact.artifactVersion ||
        version.generationMetadata.snapshotHash !==
          workspace.snapshot.snapshotHash ||
        artifact.tenantId !== input.tenantId ||
        artifact.ownerId !== input.ownerId ||
        artifact.repositoryId !== workspace.repositoryId ||
        artifact.repositoryRevision !== workspace.repositoryRevision ||
        artifact.workspaceId !== workspace.workspaceId ||
        artifact.executionId !== workspace.executionId ||
        artifact.workUnitId !== workspace.workUnitId) {
      fail("repository_proposal_artifact_stale",
        "Artifact is stale or fenced to another workspace.");
    }
  }

  const reviewedArtifacts = new Set<string>();
  for (const review of input.reviews) {
    const artifact = artifacts.get(review.artifactId);
    const version = review.versions.at(-1);
    const decision = [...review.decisions].reverse().find((candidate) =>
      candidate.reviewVersion === review.reviewVersion);
    if (review.lifecycle !== "approved" || decision?.verdict !== "approved" ||
        version?.verdict !== "approved") {
      fail("repository_proposal_review_unapproved",
        "Every review must be approved.");
    }
    if (!artifact || !version ||
        version.reviewVersion !== review.reviewVersion ||
        version.artifactVersion !== artifact.artifactVersion ||
        review.tenantId !== input.tenantId ||
        review.ownerId !== input.ownerId ||
        review.workspaceId !== workspace.workspaceId ||
        review.executionId !== workspace.executionId ||
        review.repositoryRevision !== workspace.repositoryRevision) {
      fail("repository_proposal_review_stale",
        "Review is stale or does not reference an assembled artifact.");
    }
    reviewedArtifacts.add(review.artifactId);
  }
  if (reviewedArtifacts.size !== artifacts.size) {
    fail("repository_proposal_incomplete",
      "Every artifact requires an approved review.");
  }
}

function diagnosticSort(left: ProposalDiagnostic, right: ProposalDiagnostic) {
  return left.severity.localeCompare(right.severity) ||
    left.code.localeCompare(right.code) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.diagnosticId.localeCompare(right.diagnosticId);
}

export function assembleManifest(
  input: AssembleProposalInput,
  proposalId: string,
  proposalVersion: number,
  quotas: ProposalQuotas,
  timestamp: string,
): {
  manifest: ChangeManifest;
  diagnostics: readonly ProposalDiagnostic[];
  metrics: ProposalOutputMetrics;
} {
  const artifacts = [...input.artifacts].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId));
  const reviews = [...input.reviews].sort((left, right) =>
    left.reviewId.localeCompare(right.reviewId));
  const patches = [...input.patches].sort((left, right) =>
    left.patchVersion - right.patchVersion ||
    left.patchId.localeCompare(right.patchId));

  const fileMap = new Map<string, {
    operations: Set<string>;
    artifactIds: Set<string>;
    patchVersions: Set<number>;
  }>();
  const symbolMap = new Map<string, Set<string>>();
  for (const artifact of artifacts) {
    const version = artifact.versions.at(-1)!;
    for (const operation of version.structuredContent.operations) {
      const paths = [operation.path, operation.destinationPath]
        .filter((path): path is string => Boolean(path));
      for (const path of paths) {
        const entry = fileMap.get(path) ?? {
          operations: new Set(), artifactIds: new Set(),
          patchVersions: new Set<number>(),
        };
        entry.operations.add(operation.operation);
        entry.artifactIds.add(artifact.artifactId);
        entry.patchVersions.add(version.generationMetadata.patchVersion);
        fileMap.set(path, entry);
      }
      if (operation.symbol) {
        const key = `${operation.path}\0${operation.symbol}`;
        const ids = symbolMap.get(key) ?? new Set<string>();
        ids.add(artifact.artifactId);
        symbolMap.set(key, ids);
      }
    }
  }
  for (const patch of patches) {
    for (const operation of patch.fileOperations) {
      for (const path of [operation.path,
        "destinationPath" in operation ? operation.destinationPath : undefined]
        .filter((value): value is string => Boolean(value))) {
        const entry = fileMap.get(path) ?? {
          operations: new Set(), artifactIds: new Set(),
          patchVersions: new Set<number>(),
        };
        entry.operations.add(operation.operation);
        entry.patchVersions.add(patch.patchVersion);
        fileMap.set(path, entry);
      }
    }
    for (const operation of patch.symbolOperations) {
      const key = `${operation.filePath}\0${operation.symbol}`;
      if (!symbolMap.has(key)) symbolMap.set(key, new Set());
    }
  }
  if ([...fileMap.keys()].some(unsafePath)) {
    fail("repository_proposal_manifest_invalid",
      "Manifest contains an unsafe path.");
  }
  if (fileMap.size > quotas.filesPerManifest ||
      symbolMap.size > quotas.symbolsPerManifest) {
    fail("repository_proposal_quota_exceeded", "Manifest quota exceeded.");
  }

  const diagnostics: ProposalDiagnostic[] = [];
  const addDiagnostic = (
    sourceType: ProposalDiagnostic["sourceType"],
    sourceId: string,
    code: string,
    severity: ProposalDiagnostic["severity"],
    message: string,
    affectedFiles: readonly string[],
    affectedSymbols: readonly string[],
  ) => diagnostics.push({
    diagnosticId: stableId("repository_proposal_diagnostic", {
      proposalId, proposalVersion, sourceType, sourceId, code, message,
      affectedFiles: sortedUnique(affectedFiles),
      affectedSymbols: sortedUnique(affectedSymbols),
    }),
    proposalId, proposalVersion, code, severity, message,
    affectedFiles: sortedUnique(affectedFiles),
    affectedSymbols: sortedUnique(affectedSymbols),
    sourceType, sourceId, createdAt: timestamp,
  });
  for (const artifact of artifacts) {
    for (const diagnostic of artifact.versions.at(-1)!.diagnostics) {
      addDiagnostic("artifact", artifact.artifactId, diagnostic.code,
        diagnostic.severity === "blocker" ? "error" : "warning",
        diagnostic.message, diagnostic.affectedFiles,
        diagnostic.affectedSymbols);
    }
  }
  for (const review of reviews) {
    for (const diagnostic of review.versions.at(-1)!.diagnostics) {
      addDiagnostic("review", review.reviewId, diagnostic.code,
        diagnostic.severity, diagnostic.message, [], []);
    }
  }
  for (const patch of patches) {
    for (const diagnostic of patch.diagnostics) {
      addDiagnostic("patch", patch.patchId, diagnostic.code,
        diagnostic.severity === "blocker" ||
          diagnostic.severity === "validation_failure" ? "error" : "warning",
        diagnostic.message, diagnostic.affectedFiles,
        diagnostic.affectedSymbols);
    }
  }
  diagnostics.sort(diagnosticSort);
  if (diagnostics.length > quotas.diagnosticsPerProposal) {
    fail("repository_proposal_quota_exceeded", "Diagnostic quota exceeded.");
  }

  const changedFiles = [...fileMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => ({
      path,
      operations: [...value.operations].sort(),
      artifactIds: [...value.artifactIds].sort(),
      patchVersions: [...value.patchVersions].sort((left, right) => left - right),
    }));
  const changedSymbols = [...symbolMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, artifactIds]) => {
      const [filePath, symbol] = key.split("\0");
      return {
        filePath: filePath!, symbol: symbol!,
        artifactIds: [...artifactIds].sort(),
      };
    });
  const gates: readonly ProposalValidationCategory[] = [
    "ownership", "lifecycle", "version_fencing", "completeness",
    "artifact_approval", "review_approval", "manifest_consistency",
    "quota_validation",
  ];
  const findings: ProposalValidationFinding[] = gates.map((category) => ({
    category, passed: true, codes: [],
  }));
  const risks = sortedUnique([
    ...diagnostics.filter((diagnostic) => diagnostic.severity !== "info")
      .map((diagnostic) => diagnostic.code),
    ...reviews.flatMap((review) => review.findings)
      .filter((finding) => finding.severity === "warning")
      .map((finding) => finding.category),
  ]);
  const confidenceValues = [
    ...artifacts.map((artifact) => artifact.versions.at(-1)!.confidence),
    ...reviews.map((review) => review.versions.at(-1)!.confidence),
    ...patches.map((patch) => patch.confidence),
  ];
  const manifest: ChangeManifest = {
    schemaVersion: REPOSITORY_PROPOSAL_OUTPUT_SCHEMA_VERSION,
    changedFiles,
    changedSymbols,
    patchSummaries: patches.map((patch) => ({
      patchId: patch.patchId, patchVersion: patch.patchVersion,
      contentHash: patch.contentHash,
      operationCount:
        patch.fileOperations.length + patch.symbolOperations.length,
      affectedFiles: sortedUnique([
        ...patch.fileOperations.flatMap((operation) => [
          operation.path,
          "destinationPath" in operation ? operation.destinationPath : "",
        ]),
        ...patch.symbolOperations.map((operation) => operation.filePath),
      ].filter(Boolean)),
    })),
    reviewSummaries: reviews.map((review) => ({
      reviewId: review.reviewId, reviewVersion: review.reviewVersion,
      artifactId: review.artifactId, verdict: "approved",
      confidence: review.versions.at(-1)!.confidence,
      findingCount: review.versions.at(-1)!.findings.length,
    })),
    diagnostics,
    confidence: confidenceValues.length === 0 ? 0 :
      Number((confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length).toFixed(6)),
    risks,
    affectedComponents: sortedUnique(changedFiles.map(({ path }) =>
      path.includes("/") ? path.split("/")[0]! : "root")),
    validationSummary: {
      valid: true, gateCount: findings.length,
      passedGateCount: findings.length, findings,
    },
  };
  const manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
  if (manifestBytes > quotas.manifestBytes) {
    fail("repository_proposal_quota_exceeded", "Manifest byte quota exceeded.");
  }
  return {
    manifest,
    diagnostics,
    metrics: {
      artifactCount: artifacts.length,
      reviewCount: reviews.length,
      patchCount: patches.length,
      changedFileCount: changedFiles.length,
      changedSymbolCount: changedSymbols.length,
      diagnosticCount: diagnostics.length,
      manifestBytes,
    },
  };
}

export function proposalOutputHash(
  version: Omit<ProposalVersion, "outputHash">,
): string {
  return stableHash(version);
}

export function validateProposalIntegrity(
  proposal: import("./types.js").RepositoryProposal,
  quotas: ProposalQuotas,
): void {
  if (proposal.versions.length !== proposal.proposalVersion ||
      proposal.proposalVersion < 1 ||
      proposal.versions.length > quotas.versionsPerProposal ||
      proposal.diagnostics.length > quotas.retainedDiagnostics) {
    fail("repository_proposal_integrity_invalid",
      "Proposal history or retention fencing is invalid.");
  }
  for (const [index, version] of proposal.versions.entries()) {
    if (version.proposalVersion !== index + 1 ||
        version.proposalId !== proposal.proposalId ||
        version.outputHash !== proposalOutputHash(
          Object.fromEntries(Object.entries(version).filter(([key]) =>
            key !== "outputHash")) as unknown as Omit<
              ProposalVersion, "outputHash"
            >,
        ) ||
        version.manifest.schemaVersion !==
          REPOSITORY_PROPOSAL_OUTPUT_SCHEMA_VERSION ||
        !version.manifest.validationSummary.valid) {
      fail("repository_proposal_integrity_invalid",
        "Proposal version is malformed.");
    }
  }
}
