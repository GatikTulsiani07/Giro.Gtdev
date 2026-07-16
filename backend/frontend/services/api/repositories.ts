import { apiRequest } from "./client";
import type {
  ConnectRepositoryResult,
  IndexedRepository,
  RepositoryDashboard,
  RepositorySummary,
} from "@/types/api";

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
  dashboard(token: string, owner: string, repo: string) {
    return apiRequest<RepositoryDashboard>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dashboard`, {
      method: "GET",
      token,
    });
  },
  summary(token: string, owner: string, repo: string) {
    return apiRequest<{ summary: RepositorySummary }>(
      `/repositories/${encodeURIComponent(`${owner}/${repo}`)}/summary`,
      { method: "GET", token },
    );
  },
};
