import { apiRequest } from "./client";
import type {
  ConnectRepositoryResult,
  IndexedRepository,
  RepositorySummary,
  RepositoryWorkspace,
} from "@/types/api";

export function encodeRepositoryId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export const repositoriesApi = {
  list(token: string) {
    return apiRequest<{ repositories: IndexedRepository[]; count: number }>("/repos/indexed", {
      method: "GET",
      token,
    });
  },
  connect(token: string, repoUrl: string) {
    return apiRequest<ConnectRepositoryResult>("/repos/connect", {
      method: "POST",
      token,
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
