"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-context";
import { repositoriesApi } from "@/services/api/repositories";
import { queryKeys } from "@/services/query/query-client";

export const repositoryKeys = {
  all: ["repositories"] as const,
  summary: (owner: string, repo: string) => ["repository", owner, repo, "summary"] as const,
  workspace: (owner: string, repo: string) => ["repository", owner, repo, "workspace"] as const,
};

export function useRepositoryMetadata() {
  const { token } = useAuth();
  return useQuery({
    queryKey: queryKeys.repositories,
    queryFn: ({ signal }) => repositoriesApi.metadata(token as string, signal),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
}

export function useRepositoryMetadataById(owner: string, repo: string) {
  const { token } = useAuth();
  const repositoryId = `${owner}/${repo}`;
  return useQuery({
    queryKey: queryKeys.repository(repositoryId),
    queryFn: ({ signal }) => repositoriesApi.metadataById(
      token as string, owner, repo, signal),
    enabled: Boolean(token && owner && repo),
    staleTime: 30_000,
  });
}

export function useRepositories() {
  const { token } = useAuth();
  return useQuery({
    queryKey: repositoryKeys.all,
    queryFn: () => repositoriesApi.list(token as string),
    enabled: Boolean(token),
  });
}

export function useRepository(owner: string, repo: string) {
  const { token } = useAuth();
  const summary = useQuery({
    queryKey: repositoryKeys.summary(owner, repo),
    queryFn: () => repositoriesApi.summary(token as string, owner, repo),
    enabled: Boolean(token && owner && repo),
    retry: false,
  });
  return summary;
}

export function useRepositoryWorkspace(owner: string, repo: string, enabled = true) {
  const { token } = useAuth();
  return useQuery({
    queryKey: repositoryKeys.workspace(owner, repo),
    queryFn: () => repositoriesApi.workspace(token as string, owner, repo),
    enabled: Boolean(token && owner && repo && enabled),
    retry: false,
  });
}

export function useConnectRepository() {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (repoUrl: string) => {
      const parsed = new URL(repoUrl);
      const [owner = "", repoWithSuffix = ""] = parsed.pathname.split("/").filter(Boolean);
      const repo = repoWithSuffix.replace(/\.git$/, "");
      const current = await repositoriesApi.metadata(token as string);
      const existing = current.repositories.find(
        (item) => item.owner === owner && item.repo === repo &&
          item.status === "indexed" && item.publishedRevision,
      );
      if (existing) {
        return { repositoryId: `${owner}/${repo}`, status: "already_indexed" as const };
      }
      return repositoriesApi.connect(token as string, repoUrl);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: repositoryKeys.all });
      void client.invalidateQueries({ queryKey: queryKeys.repositories });
    },
  });
}
