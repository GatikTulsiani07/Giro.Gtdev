import { apiRequest } from "./client";
import type {
  ConnectRepositoryResult,
  IndexedRepository,
  RepositorySummary,
  RepositoryWorkspace,
  RepositoryMetadata,
} from "@/types/api";

export function encodeRepositoryId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export const repositoriesApi = {
  metadata(token: string, signal?: AbortSignal) {
    return apiRequest<{ repositories: RepositoryMetadata[]; count: number }>(
      "/api/v1/repositories",
      { method: "GET", token, signal },
    );
  },
  metadataById(token: string, owner: string, repo: string, signal?: AbortSignal) {
    return apiRequest<{ repository: RepositoryMetadata }>(
      `/api/v1/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { method: "GET", token, signal },
    );
  },
  list(token: string) {
    return apiRequest<{ repositories: IndexedRepository[]; count: number }>("/repos/indexed", {
      method: "GET",
      token,
    });
  },
  connect(token: string, repoUrl: string, signal?: AbortSignal) {
    return apiRequest<ConnectRepositoryResult>("/repos/connect", {
      method: "POST",
      token,
      signal,
      body: JSON.stringify({ repoUrl }),
    });
  },
  summary(token: string, owner: string, repo: string) {
    return apiRequest<{ summary: RepositorySummary }>(
      `/repositories/${encodeRepositoryId(owner, repo)}/summary`,
      { method: "GET", token },
    );
  },
  workspace(token: string, owner: string, repo: string) {
    return apiRequest<RepositoryWorkspace>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/workspace`,
      { method: "GET", token },
    );
  },
};
