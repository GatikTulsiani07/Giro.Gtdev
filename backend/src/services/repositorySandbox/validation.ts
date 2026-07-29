import { posix } from "node:path";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  CreateSandboxInput,
  RepositorySandbox,
  SandboxWorkspaceMetadata,
} from "./types.js";
import {
  REPOSITORY_SANDBOX_SCHEMA_VERSION,
  RepositorySandboxError,
} from "./types.js";

const identityFields = (input: CreateSandboxInput) => ({
  tenantId: input.tenantId,
  repositoryId: input.repositoryId,
  workflowId: input.workflowId,
  executionId: input.executionId,
  ownerId: input.ownerId,
  repositoryRevision: input.repositoryRevision,
});

export function sandboxIdentity(input: CreateSandboxInput): string {
  return stableId("sandbox", identityFields(input));
}

export function sandboxWorkspaceRoot(input: CreateSandboxInput): string {
  const base = posix.normalize(input.workspaceRootBase.trim().replaceAll("\\", "/"));
  if (!base || base === "." || !base.startsWith("/") || base.includes("\0")) {
    throw new RepositorySandboxError(
      "repository_sandbox_workspace_root_invalid",
      "Sandbox workspace root base must be a non-empty absolute metadata path.",
    );
  }
  return posix.join(base, stableId("tenant", input.tenantId), sandboxIdentity(input));
}

export function prepareWorkspaceMetadata(
  input: CreateSandboxInput,
  now: Date,
): SandboxWorkspaceMetadata {
  if (input.repositorySnapshot.repositoryId !== input.repositoryId ||
      input.repositorySnapshot.repositoryRevision !== input.repositoryRevision ||
      input.executionRevision !== input.repositoryRevision) {
    throw new RepositorySandboxError(
      "repository_sandbox_revision_fence_rejected",
      "Repository snapshot, execution, and sandbox revisions must match.",
    );
  }
  const snapshot = {
    ...input.repositorySnapshot,
    snapshotId: stableId("sandbox_snapshot", {
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      contentFingerprint: input.repositorySnapshot.contentFingerprint,
    }),
    capturedAt: now.toISOString(),
  };
  const manifest = structuredClone(input.manifest ?? {});
  const dependencyMetadata = structuredClone(input.dependencyMetadata ?? {});
  return {
    repositorySnapshot: snapshot,
    repositoryRevision: input.repositoryRevision,
    manifest,
    dependencyMetadata,
    workspaceFingerprint: stableHash({
      identity: identityFields(input),
      snapshot: {
        snapshotId: snapshot.snapshotId,
        contentFingerprint: snapshot.contentFingerprint,
      },
      manifest,
      dependencyMetadata,
    }),
    preparedAt: null,
    preparationLatencyMs: 0,
  };
}

export function validateSandboxIntegrity(sandbox: RepositorySandbox): void {
  if (sandbox.schemaVersion !== REPOSITORY_SANDBOX_SCHEMA_VERSION ||
      !sandbox.sandboxId || !sandbox.tenantId || !sandbox.repositoryId ||
      !sandbox.workflowId || !sandbox.executionId || !sandbox.ownerId ||
      !sandbox.repositoryRevision || !sandbox.workspaceRoot ||
      sandbox.repositoryRevision !== sandbox.workspace.repositoryRevision ||
      sandbox.repositoryId !== sandbox.workspace.repositorySnapshot.repositoryId ||
      sandbox.repositoryRevision !==
        sandbox.workspace.repositorySnapshot.repositoryRevision) {
    throw new RepositorySandboxError(
      "repository_sandbox_startup_validation_failed",
      "Sandbox metadata integrity validation failed.",
    );
  }
  const active = sandbox.leases.filter((lease) => lease.releasedAt === null);
  if ((sandbox.lifecycle === "leased") !== (active.length === 1) ||
      sandbox.leases.some((lease, index) =>
        lease.sandboxId !== sandbox.sandboxId || lease.ownerId !== sandbox.ownerId ||
        lease.fencingToken !== index + 1)) {
    throw new RepositorySandboxError(
      "repository_sandbox_startup_validation_failed",
      "Sandbox lease integrity validation failed.",
    );
  }
}

export function cloneSandbox<T>(value: T): T {
  return structuredClone(value);
}
