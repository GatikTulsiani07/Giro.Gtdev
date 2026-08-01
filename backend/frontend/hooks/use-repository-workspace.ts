"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-context";
import { repositoryWorkspaceApi } from "@/services/api/repository-workspace";
import type {
  FeatureNavigationOperation,
  RepositoryMetadata,
  SemanticNavigationOperation,
} from "@/types/api";

export const workspaceKeys = {
  overview: (repositoryId: string, revision: string) =>
    ["repository-workspace", repositoryId, revision, "overview"] as const,
  feature: (
    repositoryId: string,
    revision: string,
    operation: FeatureNavigationOperation,
    name: string,
  ) => ["repository-workspace", repositoryId, revision, "feature", operation, name] as const,
  semantic: (
    repositoryId: string,
    revision: string,
    operation: SemanticNavigationOperation,
    query: string,
  ) => ["repository-workspace", repositoryId, revision, "semantic", operation, query] as const,
  directory: (repositoryId: string, revision: string, path: string) =>
    ["repository-workspace", repositoryId, revision, "directory", path] as const,
  file: (repositoryId: string, revision: string, path: string) =>
    ["repository-workspace", repositoryId, revision, "file", path] as const,
};

export function repositoryGatewayGuard(metadata: RepositoryMetadata | undefined) {
  if (!metadata) return { ready: false, reason: "Repository metadata is unavailable." };
  if (metadata.status === "queued") return { ready: false, reason: "Repository indexing is queued." };
  if (metadata.status === "indexing") return { ready: false, reason: "Repository indexing is still running." };
  if (metadata.status === "failed") return { ready: false, reason: "Repository indexing failed." };
  if (metadata.status === "stale" || metadata.isStale) return { ready: false, reason: "Repository intelligence is stale." };
  if (!metadata.publishedRevision) return { ready: false, reason: "Repository has no published revision." };
  if (!metadata.revisionConsistent) return { ready: false, reason: "Repository revision does not match published intelligence." };
  if (!metadata.gatewayCompatible) return { ready: false, reason: "Repository gateway intelligence is unavailable." };
  return { ready: true, revision: metadata.publishedRevision, reason: null };
}

export function useGatewayOverview(owner: string, repo: string, metadata: RepositoryMetadata | undefined) {
  const { token } = useAuth();
  const guard = repositoryGatewayGuard(metadata);
  return useQuery({
    queryKey: workspaceKeys.overview(metadata?.repositoryId ?? `${owner}/${repo}`, guard.revision ?? "missing"),
    queryFn: ({ signal }) => repositoryWorkspaceApi.overview(token as string, owner, repo, guard.revision as string, signal),
    enabled: Boolean(token && owner && repo && guard.ready),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useFeatureNavigation(
  owner: string,
  repo: string,
  metadata: RepositoryMetadata | undefined,
  operation: FeatureNavigationOperation,
  name: string,
  enabled = true,
) {
  const { token } = useAuth();
  const guard = repositoryGatewayGuard(metadata);
  return useQuery({
    queryKey: workspaceKeys.feature(metadata?.repositoryId ?? `${owner}/${repo}`, guard.revision ?? "missing", operation, name),
    queryFn: ({ signal }) => repositoryWorkspaceApi.feature(token as string, owner, repo, guard.revision as string, operation, name, signal),
    enabled: Boolean(token && guard.ready && name.trim() && enabled),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useSemanticNavigation(
  owner: string,
  repo: string,
  metadata: RepositoryMetadata | undefined,
  operation: SemanticNavigationOperation,
  query: string,
  enabled = true,
) {
  const { token } = useAuth();
  const guard = repositoryGatewayGuard(metadata);
  return useQuery({
    queryKey: workspaceKeys.semantic(metadata?.repositoryId ?? `${owner}/${repo}`, guard.revision ?? "missing", operation, query),
    queryFn: ({ signal }) => repositoryWorkspaceApi.semantic(token as string, owner, repo, guard.revision as string, operation, query, signal),
    enabled: Boolean(token && guard.ready && query.trim() && enabled),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useRepositoryDirectory(
  metadata: RepositoryMetadata | undefined,
  relativePath: string,
  enabled = true,
) {
  const { token } = useAuth();
  const guard = repositoryGatewayGuard(metadata);
  return useQuery({
    queryKey: workspaceKeys.directory(metadata?.repositoryId ?? "missing", guard.revision ?? "missing", relativePath),
    queryFn: ({ signal }) => repositoryWorkspaceApi.listDirectory(token as string, metadata?.repositoryId as string, relativePath, signal),
    enabled: Boolean(token && metadata?.repositoryId && guard.ready && enabled),
    staleTime: 60_000,
  });
}

export function useRepositoryFile(
  metadata: RepositoryMetadata | undefined,
  relativePath: string,
  enabled = true,
) {
  const { token } = useAuth();
  const guard = repositoryGatewayGuard(metadata);
  return useQuery({
    queryKey: workspaceKeys.file(metadata?.repositoryId ?? "missing", guard.revision ?? "missing", relativePath),
    queryFn: ({ signal }) => repositoryWorkspaceApi.readFile(token as string, metadata?.repositoryId as string, relativePath, signal),
    enabled: Boolean(token && metadata?.repositoryId && guard.ready && relativePath && enabled),
    retry: false,
    placeholderData: keepPreviousData,
  });
}
