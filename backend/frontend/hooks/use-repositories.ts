"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-context";
import { repositoriesApi } from "@/services/api/repositories";

export const repositoryKeys = {
  all: ["repositories"] as const,
  dashboard: (owner: string, repo: string) => ["repository", owner, repo, "dashboard"] as const,
  summary: (owner: string, repo: string) => ["repository", owner, repo, "summary"] as const,
};

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
  const dashboard = useQuery({
    queryKey: repositoryKeys.dashboard(owner, repo),
    queryFn: () => repositoriesApi.dashboard(token as string, owner, repo),
    enabled: Boolean(token && owner && repo),
  });
  const summary = useQuery({
    queryKey: repositoryKeys.summary(owner, repo),
    queryFn: () => repositoriesApi.summary(token as string, owner, repo),
    enabled: Boolean(token && owner && repo),
    retry: false,
  });
  return { dashboard, summary };
}

export function useConnectRepository() {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (repoUrl: string) => repositoriesApi.connect(token as string, repoUrl),
    onSuccess: () => client.invalidateQueries({ queryKey: repositoryKeys.all }),
  });
}
