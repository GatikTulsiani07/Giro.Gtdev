import type { MetricsRegistry } from "../../observability/metrics.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import { authorizeRepository } from "../repository/ownershipGuard.js";
import type {
  RepositoryStore,
} from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import {
  publicRepositoryMetadata,
  type PublicRepositoryMetadata,
} from "./contracts.js";

export type RepositoryMetadataAccessResult =
  | { readonly ok: true; readonly repository: PublicRepositoryMetadata }
  | {
      readonly ok: false;
      readonly status: 403 | 404;
      readonly code: string;
      readonly message: string;
    };

export class RepositoryMetadataApiService {
  constructor(
    private readonly repositories: RepositoryStore = repositoryStore,
    private readonly metrics: Pick<
      MetricsRegistry,
      "incrementRepositoryMetadataApi"
    > = runtimeMetrics,
  ) {}

  recordFailure(): void {
    this.metrics.incrementRepositoryMetadataApi("failure");
  }

  async list(ownerId: string): Promise<readonly PublicRepositoryMetadata[]> {
    try {
      const records = await this.repositories.listRepositories();
      const repositories = records
        .filter((record) =>
          record.deletionState === "active" &&
          record.ownerUserId === ownerId)
        .map(publicRepositoryMetadata)
        .sort((left, right) =>
          left.owner.localeCompare(right.owner) ||
          left.repository.localeCompare(right.repository));
      this.metrics.incrementRepositoryMetadataApi("listing");
      return Object.freeze(repositories);
    } catch (error) {
      this.metrics.incrementRepositoryMetadataApi("failure");
      throw error;
    }
  }

  async get(
    ownerId: string,
    repositoryId: string,
  ): Promise<RepositoryMetadataAccessResult> {
    try {
      const access = await authorizeRepository({
        repositoryId,
        userId: ownerId,
        store: this.repositories,
        log: { operation: "repository_metadata_lookup" },
      });
      if (!access.ok) {
        this.metrics.incrementRepositoryMetadataApi("failure");
        return access;
      }
      const record = await this.repositories.getRepository(repositoryId);
      if (!record || record.deletionState !== "active" ||
          record.ownerUserId !== ownerId ||
          record.repositoryId !== repositoryId) {
        this.metrics.incrementRepositoryMetadataApi("failure");
        return {
          ok: false,
          status: 404,
          code: "repo_not_connected",
          message: "Repository not connected. Call POST /repos/connect first.",
        };
      }
      const repository = publicRepositoryMetadata(record);
      this.metrics.incrementRepositoryMetadataApi("lookup");
      return { ok: true, repository };
    } catch (error) {
      this.metrics.incrementRepositoryMetadataApi("failure");
      throw error;
    }
  }
}

export const runtimeRepositoryMetadataApiService =
  new RepositoryMetadataApiService();
