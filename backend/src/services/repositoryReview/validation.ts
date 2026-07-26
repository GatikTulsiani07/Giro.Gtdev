import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  ArtifactContentOperation,
  ArtifactVersion,
} from "../repositoryArtifact/types.js";
import {
  REPOSITORY_ARTIFACT_CONTENT_SCHEMA_VERSION,
  REPOSITORY_ARTIFACT_SCHEMA_VERSION,
} from "../repositoryArtifact/types.js";
import type {
  CreateReviewInput,
  FindingSeverity,
  QualityGateCategory,
  RepositoryReview,
  ReviewDiagnostic,
  ReviewFinding,
  ReviewOutputMetrics,
  ReviewQuotas,
  ReviewVerdict,
  ReviewVersion,
} from "./types.js";
import {
  REPOSITORY_REVIEW_OUTPUT_SCHEMA_VERSION,
  REPOSITORY_REVIEW_SCHEMA_VERSION,
  RepositoryReviewError,
} from "./types.js";

const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[^\r\n]+$/u;
const categories: readonly QualityGateCategory[] = [
  "schema_correctness",
  "ownership",
  "lifecycle",
  "version_fencing",
  "artifact_completeness",
  "patch_consistency",
  "dependency_consistency",
  "symbol_consistency",
  "path_safety",
  "quota_validation",
];
const severityOrder: Record<FindingSeverity, number> = {
  blocker: 0, error: 1, warning: 2, info: 3,
};

function fail(
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new RepositoryReviewError(code, message, details);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function reviewIdentity(input: CreateReviewInput): string {
  return stableId("repository_quality_review", {
    artifactId: input.artifact.artifactId,
    workspaceId: input.workspace.workspaceId,
    executionId: input.executionMetadata.executionId,
    workUnitId: input.executionMetadata.workUnitId,
    reviewerType: input.reviewerType,
  });
}

export function validateReviewInput(
  input: CreateReviewInput,
  quotas: ReviewQuotas,
  currentReviewVersion: number,
  existingReviewCount: number,
  now: Date,
): void {
  const { artifact, workspace, snapshot, patch, executionMetadata } = input;
  if (!["human", "agent", "system"].includes(input.reviewerType) ||
      [input.tenantId, input.ownerId, input.repositoryOwnerId,
        input.executionOwnerId].some((value) => !value.trim())) {
    fail("repository_review_identity_invalid", "Review identity is incomplete.");
  }
  if (input.ownerId !== input.repositoryOwnerId ||
      input.ownerId !== input.executionOwnerId ||
      input.ownerId !== artifact.ownerId ||
      input.ownerId !== workspace.ownerId ||
      input.ownerId !== executionMetadata.ownerId ||
      input.tenantId !== artifact.tenantId ||
      input.tenantId !== workspace.tenantId) {
    fail("repository_review_ownership_conflict",
      "Repository, artifact, workspace, execution, and review ownership must match.");
  }
  if (!["active", "validating"].includes(workspace.lifecycle) ||
      !["awaiting_review", "validated"].includes(artifact.lifecycle)) {
    fail("repository_review_lifecycle_conflict",
      "Review requires an active workspace and reviewable artifact.");
  }
  if (!snapshot.published || !input.repositoryGraph.published ||
      !input.intelligence.published || !input.planning.published) {
    fail("repository_review_revision_unpublished",
      "Review requires published immutable inputs.");
  }
  if (snapshot.snapshotId !== workspace.snapshot.snapshotId ||
      snapshot.snapshotHash !== workspace.snapshot.snapshotHash ||
      snapshot.snapshotVersion !== workspace.snapshotVersion ||
      snapshot.repositoryRevision !== workspace.repositoryRevision) {
    fail("repository_review_snapshot_stale",
      "Review snapshot is stale or belongs to another workspace.");
  }
  const latestPatch = workspace.patches.at(-1);
  const artifactVersion = artifact.versions.at(-1);
  if (!latestPatch || patch.patchId !== latestPatch.patchId ||
      patch.patchVersion !== latestPatch.patchVersion ||
      patch.contentHash !== latestPatch.contentHash ||
      patch.snapshotHash !== snapshot.snapshotHash) {
    fail("repository_review_patch_stale",
      "Review patch is stale or belongs to another workspace.");
  }
  if (!artifactVersion || artifact.artifactVersion !== artifactVersion.artifactVersion ||
      artifact.workspaceId !== workspace.workspaceId ||
      artifact.executionId !== workspace.executionId ||
      artifact.workUnitId !== workspace.workUnitId ||
      artifact.repositoryRevision !== workspace.repositoryRevision ||
      executionMetadata.executionId !== workspace.executionId ||
      executionMetadata.workUnitId !== workspace.workUnitId) {
    fail("repository_review_version_fence_rejected",
      "Review inputs are fenced by another artifact, workspace, or execution.");
  }
  const metadata = artifactVersion.generationMetadata;
  if (metadata.snapshotHash !== snapshot.snapshotHash ||
      metadata.snapshotVersion !== snapshot.snapshotVersion ||
      metadata.patchHash !== patch.contentHash ||
      metadata.patchVersion !== patch.patchVersion ||
      metadata.graphVersion !== input.repositoryGraph.version ||
      metadata.intelligenceVersion !== input.intelligence.version ||
      metadata.planningVersion !== input.planning.version ||
      metadata.executionVersion !== executionMetadata.executionVersion) {
    fail("repository_review_artifact_stale",
      "Artifact was generated from stale review inputs.");
  }
  if (input.baseReviewVersion !== currentReviewVersion) {
    fail("repository_review_version_stale", "Review base version is stale.");
  }
  if (currentReviewVersion >= quotas.versionsPerReview) {
    fail("repository_review_version_quota_exceeded",
      "Review version quota exceeded.");
  }
  if (currentReviewVersion === 0 &&
      existingReviewCount >= quotas.reviewsPerArtifact) {
    fail("repository_review_quota_exceeded",
      "Artifact review quota exceeded.");
  }
  if (input.reviewLeaseExpiresAt &&
      Date.parse(input.reviewLeaseExpiresAt) <= now.getTime()) {
    fail("repository_review_lease_expired", "Review lease is expired.");
  }
}

type FindingDraft = Omit<
  ReviewFinding,
  "findingId" | "reviewId" | "reviewVersion" | "createdAt"
>;

function operationKey(operation: ArtifactContentOperation): string {
  return [
    operation.operation,
    operation.path,
    operation.destinationPath ?? "",
    operation.symbol ?? "",
    operation.content ?? "",
    operation.expectedHash ?? "",
  ].join("\0");
}

function patchOperationKeys(input: CreateReviewInput): string[] {
  const files: ArtifactContentOperation[] = input.patch.fileOperations.map((item) => ({
    operation: item.operation,
    path: item.path,
    ...("destinationPath" in item ? { destinationPath: item.destinationPath } : {}),
    ...("content" in item ? { content: item.content } : {}),
    ...("expectedContentHash" in item
      ? { expectedHash: item.expectedContentHash } : {}),
  }));
  const symbols: ArtifactContentOperation[] = input.patch.symbolOperations.map((item) => ({
    operation: item.operation,
    path: item.filePath,
    symbol: item.symbol,
    ...("declaration" in item ? { content: item.declaration } : {}),
    ...("expectedSymbolHash" in item
      ? { expectedHash: item.expectedSymbolHash } : {}),
  }));
  return [...files, ...symbols].map(operationKey).sort();
}

function passed(category: QualityGateCategory): FindingDraft {
  return {
    severity: "info",
    category,
    affectedFile: null,
    affectedSymbol: null,
    explanation: `${category} gate passed.`,
    recommendation: "No corrective action required.",
  };
}

export function evaluateQualityGates(
  input: CreateReviewInput,
  reviewId: string,
  reviewVersion: number,
  quotas: ReviewQuotas,
  createdAt: string,
): {
  findings: ReviewFinding[];
  diagnostics: ReviewDiagnostic[];
  verdict: ReviewVerdict;
  confidence: number;
  metrics: ReviewOutputMetrics;
} {
  const artifactVersion = input.artifact.versions.at(-1)!;
  const drafts = new Map<QualityGateCategory, FindingDraft[]>(
    categories.map((category) => [category, []]),
  );
  const add = (finding: FindingDraft) => drafts.get(finding.category)!.push(finding);

  const content = artifactVersion.structuredContent;
  if (input.artifact.schemaVersion !== REPOSITORY_ARTIFACT_SCHEMA_VERSION ||
      content.schemaVersion !== REPOSITORY_ARTIFACT_CONTENT_SCHEMA_VERSION ||
      content.proposalOnly !== true ||
      artifactVersion.contentHash !== stableHash({
        artifactId: artifactVersion.artifactId,
        artifactVersion: artifactVersion.artifactVersion,
        structuredContent: artifactVersion.structuredContent,
        affectedFiles: artifactVersion.affectedFiles,
        affectedSymbols: artifactVersion.affectedSymbols,
        diagnostics: artifactVersion.diagnostics,
        confidence: artifactVersion.confidence,
        warnings: artifactVersion.warnings,
        generationMetadata: artifactVersion.generationMetadata,
      })) {
    add({
      severity: "blocker", category: "schema_correctness",
      affectedFile: null, affectedSymbol: null,
      explanation: "Artifact schema or immutable content hash is invalid.",
      recommendation: "Regenerate the artifact from validated immutable inputs.",
    });
  }

  add(passed("ownership"));
  add(passed("lifecycle"));
  add(passed("version_fencing"));

  if (content.operations.length === 0 ||
      artifactVersion.affectedFiles.length === 0) {
    add({
      severity: "error", category: "artifact_completeness",
      affectedFile: null, affectedSymbol: null,
      explanation: "Artifact has no actionable operations or affected files.",
      recommendation: "Add a complete structured proposal before review.",
    });
  }

  const actualOperations = content.operations.map(operationKey).sort();
  const expectedOperations = patchOperationKeys(input);
  if (stableHash(actualOperations) !== stableHash(expectedOperations) ||
      content.sourceHashes.patch !== input.patch.contentHash) {
    add({
      severity: "blocker", category: "patch_consistency",
      affectedFile: null, affectedSymbol: null,
      explanation: "Artifact operations do not match the fenced structured patch.",
      recommendation: "Regenerate the artifact from the current patch version.",
    });
  }

  const proposedFiles = new Set(artifactVersion.affectedFiles);
  const plannedFiles = new Set(input.planning.affectedFiles);
  const knownFiles = new Set([
    ...input.intelligence.knownFiles,
    ...input.planning.affectedFiles,
    ...input.patch.fileOperations.flatMap((operation) =>
      "destinationPath" in operation
        ? [operation.path, operation.destinationPath] : [operation.path]),
  ]);
  for (const file of [...proposedFiles].sort()) {
    if (!knownFiles.has(file)) {
      add({
        severity: "error", category: "dependency_consistency",
        affectedFile: file, affectedSymbol: null,
        explanation: "Affected file is absent from intelligence, planning, and patch scope.",
        recommendation: "Update the plan or remove the out-of-scope file.",
      });
    } else if (!plannedFiles.has(file)) {
      add({
        severity: "warning", category: "dependency_consistency",
        affectedFile: file, affectedSymbol: null,
        explanation: "Affected file is not explicitly included in planning scope.",
        recommendation: "Confirm the plan covers this file and its dependencies.",
      });
    }
  }
  const graphDependencies = new Set(input.repositoryGraph.dependencies.map((item) =>
    `${item.fromFile}\0${item.toFile}`));
  for (const dependency of [...input.planning.dependencies].sort((left, right) =>
    left.fromFile.localeCompare(right.fromFile) ||
    left.toFile.localeCompare(right.toFile))) {
    if (dependency.blocking &&
        !graphDependencies.has(`${dependency.fromFile}\0${dependency.toFile}`)) {
      add({
        severity: "warning", category: "dependency_consistency",
        affectedFile: dependency.fromFile, affectedSymbol: null,
        explanation: `Blocking dependency to ${dependency.toFile} is absent from the graph.`,
        recommendation: "Refresh the repository graph or reconcile the plan dependency.",
      });
    }
  }

  const knownSymbols = new Set([
    ...input.repositoryGraph.symbols,
    ...input.intelligence.knownSymbols,
    ...input.planning.affectedSymbols,
    ...input.patch.symbolOperations
      .filter((operation) => operation.operation === "add_symbol")
      .map((operation) => ({ filePath: operation.filePath, symbol: operation.symbol })),
  ].map((item) => `${item.filePath}\0${item.symbol}`));
  for (const operation of content.operations
    .filter((item) => item.symbol)
    .sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.symbol!.localeCompare(right.symbol!))) {
    if (!knownSymbols.has(`${operation.path}\0${operation.symbol}`)) {
      add({
        severity: "error", category: "symbol_consistency",
        affectedFile: operation.path, affectedSymbol: operation.symbol ?? null,
        explanation: "Affected symbol is absent from graph, intelligence, planning, and patch additions.",
        recommendation: "Correct the symbol reference or refresh immutable analysis inputs.",
      });
    }
  }

  for (const operation of content.operations) {
    if (!safePath.test(operation.path) ||
        (operation.destinationPath && !safePath.test(operation.destinationPath))) {
      add({
        severity: "blocker", category: "path_safety",
        affectedFile: operation.path, affectedSymbol: operation.symbol ?? null,
        explanation: "Artifact contains an unsafe repository-relative path.",
        recommendation: "Use normalized repository-relative paths without traversal.",
      });
    }
  }

  const reviewBytes = Buffer.byteLength(JSON.stringify({
    content, diagnostics: artifactVersion.diagnostics,
  }), "utf8");
  if (content.operations.length > quotas.operationsPerReview ||
      artifactVersion.diagnostics.length > quotas.diagnosticsPerReview ||
      reviewBytes > quotas.reviewBytes) {
    add({
      severity: "blocker", category: "quota_validation",
      affectedFile: null, affectedSymbol: null,
      explanation: "Artifact exceeds configured review quotas.",
      recommendation: "Split the proposal into smaller deterministic artifacts.",
    });
  }

  for (const category of categories) {
    if (drafts.get(category)!.length === 0) add(passed(category));
  }
  const orderedDrafts = [...drafts.values()].flat().sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity] ||
    left.category.localeCompare(right.category) ||
    (left.affectedFile ?? "").localeCompare(right.affectedFile ?? "") ||
    (left.affectedSymbol ?? "").localeCompare(right.affectedSymbol ?? "") ||
    left.explanation.localeCompare(right.explanation));
  const findings = orderedDrafts.map((finding, index): ReviewFinding => ({
    findingId: stableId("repository_review_finding", {
      reviewId, reviewVersion, index, ...finding,
    }),
    reviewId, reviewVersion, ...finding, createdAt,
  }));
  const diagnostics = [...input.artifact.diagnostics]
    .sort((left, right) =>
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message))
    .map((diagnostic, index): ReviewDiagnostic => ({
      diagnosticId: stableId("repository_review_diagnostic", {
        reviewId, reviewVersion, index, sourceId: diagnostic.diagnosticId,
      }),
      reviewId, reviewVersion, code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity === "warning" ? "warning" : "error",
      createdAt,
    }));
  const count = (severity: FindingSeverity) =>
    findings.filter((finding) => finding.severity === severity).length;
  const metrics: ReviewOutputMetrics = {
    gateCount: categories.length,
    passedGateCount: categories.filter((category) =>
      findings.some((finding) =>
        finding.category === category && finding.severity === "info") &&
      !findings.some((finding) =>
        finding.category === category && finding.severity !== "info")).length,
    infoCount: count("info"),
    warningCount: count("warning"),
    errorCount: count("error"),
    blockerCount: count("blocker"),
  };
  const verdict: ReviewVerdict = metrics.blockerCount + metrics.errorCount > 0
    ? "rejected" : metrics.warningCount > 0 ? "changes_requested" : "approved";
  const confidence = Math.max(0, Math.min(1, Number((
    1 - metrics.warningCount * 0.08 -
    metrics.errorCount * 0.2 - metrics.blockerCount * 0.35
  ).toFixed(6))));
  return { findings, diagnostics, verdict, confidence, metrics };
}

export function reviewOutputHash(
  version: Omit<ReviewVersion, "outputHash"> | ReviewVersion,
): string {
  return stableHash({
    reviewId: version.reviewId,
    reviewVersion: version.reviewVersion,
    artifactVersion: version.artifactVersion,
    verdict: version.verdict,
    confidence: version.confidence,
    findings: version.findings,
    diagnostics: version.diagnostics,
    metrics: version.metrics,
    reviewMetadata: version.reviewMetadata,
  });
}

export function validateReviewIntegrity(
  review: RepositoryReview,
  quotas: ReviewQuotas,
): void {
  if (review.schemaVersion !== REPOSITORY_REVIEW_SCHEMA_VERSION ||
      review.reviewVersion !== (review.versions.at(-1)?.reviewVersion ?? 0) ||
      review.versions.some((version, index) =>
        version.reviewVersion !== index + 1 ||
        version.reviewId !== review.reviewId ||
        version.outputHash !== reviewOutputHash(version) ||
        version.reviewMetadata.schemaVersion !==
          REPOSITORY_REVIEW_OUTPUT_SCHEMA_VERSION) ||
      review.findings.some((finding) =>
        !review.versions.some((version) =>
          version.reviewVersion === finding.reviewVersion &&
          version.findings.some((item) => item.findingId === finding.findingId))) ||
      review.versions.some((version) =>
        version.findings.length > quotas.findingsPerReview ||
        version.diagnostics.length > quotas.diagnosticsPerReview ||
        Buffer.byteLength(JSON.stringify(version), "utf8") > quotas.reviewBytes)) {
    fail("repository_review_schema_invalid",
      "Review schema or immutable history is malformed.");
  }
}
