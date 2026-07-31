import { z } from "zod";
import {
  CommitShaSchema,
  RepositoryNameSchema,
  RepositoryOwnerSchema,
} from "../../validation/repositorySchemas.js";
import type {
  RepositoryRecord,
  RepositoryStore,
} from "../repository/store/repositoryStore.js";

export const REPOSITORY_METADATA_API_VERSION = "repository-metadata-api-v1";

export const RepositoryMetadataApiSchemas = Object.freeze({
  params: z.object({
    owner: RepositoryOwnerSchema,
    repo: RepositoryNameSchema,
  }).strict(),
  revision: CommitShaSchema.refine(
    (value) => value === value.toLowerCase(),
    "revision must be a lowercase 40-character commit SHA",
  ),
});

export const REPOSITORY_METADATA_API_ROUTES = Object.freeze([
  ["GET", "/api/v1/repositories"],
  ["GET", "/api/v1/repositories/:owner/:repo"],
] as const);

export type RepositoryMetadataLifecycle =
  | "queued"
  | "indexing"
  | "indexed"
  | "stale"
  | "failed";

export interface PublicRepositoryMetadata {
  readonly repositoryId: string;
  readonly owner: string;
  /** Existing repository-name field retained for compatibility. */
  readonly repo: string;
  readonly repository: string;
  readonly displayName: string;
  readonly status: RepositoryMetadataLifecycle;
  readonly currentRevision: string | null;
  readonly indexedRevision: string | null;
  /** Exact revision accepted by the Repository API Gateway, or null. */
  readonly publishedRevision: string | null;
  readonly revisionConsistent: boolean;
  readonly gatewayCompatible: boolean;
  readonly isStale: boolean;
  readonly lastIndexedAt: string | null;
  readonly lastAccessedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class RepositoryMetadataContractError extends Error {
  readonly code = "repository_metadata_revision_invalid";

  constructor(readonly field: "currentRevision" | "indexedRevision") {
    super(`Stored ${field} is not a valid published revision.`);
    this.name = "RepositoryMetadataContractError";
  }
}

function publicRevision(
  value: string | null,
  field: "currentRevision" | "indexedRevision",
): string | null {
  if (value === null) return null;
  const parsed = RepositoryMetadataApiSchemas.revision.safeParse(value);
  if (!parsed.success) throw new RepositoryMetadataContractError(field);
  return parsed.data;
}

function lifecycle(record: RepositoryRecord): RepositoryMetadataLifecycle {
  return record.status === "connected" ? "queued" : record.status;
}

export function publicRepositoryMetadata(
  record: RepositoryRecord,
): PublicRepositoryMetadata {
  const currentRevision = publicRevision(
    record.currentRevision,
    "currentRevision",
  );
  const indexedRevision = publicRevision(
    record.indexedRevision,
    "indexedRevision",
  );
  const revisionConsistent = currentRevision === indexedRevision;
  const publishedRevision = currentRevision !== null && revisionConsistent
    ? currentRevision
    : null;
  const status = lifecycle(record);
  return Object.freeze({
    repositoryId: record.repositoryId,
    owner: record.owner,
    repo: record.repo,
    repository: record.repo,
    displayName: record.repo,
    status,
    currentRevision,
    indexedRevision,
    publishedRevision,
    revisionConsistent,
    gatewayCompatible: publishedRevision !== null,
    isStale: status === "stale" || !revisionConsistent,
    lastIndexedAt: record.lastIndexedAt,
    lastAccessedAt: record.lastAccessedAt,
    createdAt: record.connectedAt,
    updatedAt: record.updatedAt,
  });
}

export function verifyRepositoryMetadataApiContracts(
  store: Pick<RepositoryStore, "getRepository" | "listRepositories">,
) {
  const routes = REPOSITORY_METADATA_API_ROUTES.map(
    ([method, path]) => `${method}:${path}`,
  );
  if (routes.length !== 2 || new Set(routes).size !== routes.length) {
    throw new Error("repository_metadata_api_route_contract_invalid");
  }
  if (!RepositoryMetadataApiSchemas.params.safeParse({
    owner: "acme",
    repo: "widgets",
  }).success || RepositoryMetadataApiSchemas.params.safeParse({
    owner: "../acme",
    repo: "widgets",
  }).success || !RepositoryMetadataApiSchemas.revision.safeParse(
    "a".repeat(40),
  ).success || RepositoryMetadataApiSchemas.revision.safeParse(
    "a".repeat(39),
  ).success) {
    throw new Error("repository_metadata_api_validator_contract_invalid");
  }
  for (const method of ["getRepository", "listRepositories"] as const) {
    if (typeof store[method] !== "function") {
      throw new Error(`repository_metadata_api_dependency_missing:${method}`);
    }
  }
}
