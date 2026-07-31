import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@/services/api/client";

export const queryKeys = {
  repositories: ["repositories", "metadata"] as const,
  repository: (repositoryId: string) =>
    ["repository", repositoryId] as const,
  revision: (repositoryId: string, revision: string) =>
    ["repository", repositoryId, "revision", revision] as const,
  session: (sessionId: string, revision: string) =>
    ["session", sessionId, "revision", revision] as const,
};

export function createFrontendQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry(failureCount, error) {
          return error instanceof ApiClientError && error.retryable && failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}
