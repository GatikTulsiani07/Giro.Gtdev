"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-context";
import { repositorySessionsApi, sessionResultSummary } from "@/services/api/repository-sessions";
import type {
  JsonValue,
  RepositoryMetadata,
  RepositorySessionEvent,
} from "@/types/api";

export const engineeringSessionKeys = {
  all: ["engineering-sessions"] as const,
  repository: (repositoryId: string, revision: string) =>
    ["engineering-sessions", repositoryId, revision] as const,
  detail: (sessionId: string, revision: string) =>
    ["engineering-sessions", sessionId, revision, "detail"] as const,
};

export function useEngineeringSessions(metadata: RepositoryMetadata | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: engineeringSessionKeys.repository(metadata?.repositoryId ?? "missing", metadata?.publishedRevision ?? "missing"),
    queryFn: ({ signal }) => repositorySessionsApi.list(token as string, signal),
    enabled: Boolean(token && metadata?.repositoryId && metadata.publishedRevision),
    select: (envelope) => ({
      ...envelope,
      data: {
        ...envelope.data,
        sessions: envelope.data.sessions.filter((session) =>
          session.repositoryId === metadata?.repositoryId &&
          session.revision === metadata?.publishedRevision),
      },
    }),
  });
}

export function useEngineeringSession(sessionId: string, revision: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: engineeringSessionKeys.detail(sessionId, revision ?? "missing"),
    queryFn: ({ signal }) => repositorySessionsApi.get(token as string, sessionId, signal),
    enabled: Boolean(token && sessionId && revision),
    retry: false,
  });
}

export function useCreateEngineeringSession(metadata: RepositoryMetadata) {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input?: { workflowId?: string }) => repositorySessionsApi.create(token as string, {
      owner: metadata.owner,
      repo: metadata.repo,
      revision: metadata.publishedRevision as string,
      ...(input?.workflowId ? { workflowId: input.workflowId } : {}),
    }),
    onSuccess: (envelope) => {
      client.setQueryData(
        engineeringSessionKeys.detail(envelope.data.session.sessionId, envelope.data.session.revision),
        envelope,
      );
      void client.invalidateQueries({
        queryKey: engineeringSessionKeys.repository(metadata.repositoryId, metadata.publishedRevision ?? "missing"),
      });
    },
  });
}

export function useArchiveEngineeringSession(metadata: RepositoryMetadata) {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => repositorySessionsApi.archive(token as string, sessionId),
    onSuccess: () => void client.invalidateQueries({
      queryKey: engineeringSessionKeys.repository(metadata.repositoryId, metadata.publishedRevision ?? "missing"),
    }),
  });
}

export function useDeleteEngineeringSession(metadata: RepositoryMetadata) {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => repositorySessionsApi.remove(token as string, sessionId),
    onSuccess: () => void client.invalidateQueries({
      queryKey: engineeringSessionKeys.repository(metadata.repositoryId, metadata.publishedRevision ?? "missing"),
    }),
  });
}

export function useEngineeringAction(metadata: RepositoryMetadata, sessionId: string, revision: string | null | undefined) {
  const { token } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { action: "query" | "plan" | "specification" | "insights" | "execution"; value: string }) => {
      switch (input.action) {
        case "query":
          return repositorySessionsApi.query(token as string, sessionId, input.value);
        case "plan":
          return repositorySessionsApi.plan(token as string, sessionId, input.value);
        case "specification":
          return repositorySessionsApi.specification(token as string, sessionId, input.value);
        case "insights":
          return repositorySessionsApi.insights(token as string, sessionId);
        case "execution":
          return repositorySessionsApi.execution(token as string, sessionId, input.value);
      }
    },
    onMutate: async (input) => {
      if (!revision) return undefined;
      const key = engineeringSessionKeys.detail(sessionId, revision);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Awaited<ReturnType<typeof repositorySessionsApi.get>>>(key);
      const optimistic = optimisticEvent(input.action, input.value);
      if (previous) {
        client.setQueryData(key, {
          ...previous,
          data: {
            ...previous.data,
            events: [...previous.data.events, optimistic],
          },
        });
      }
      return { previous, key };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(context.key, context.previous);
    },
    onSuccess: (envelope) => {
      const detail = envelope.data.session;
      client.setQueryData(engineeringSessionKeys.detail(detail.session.sessionId, detail.session.revision), {
        ...envelope,
        data: detail,
      });
      void client.invalidateQueries({
        queryKey: engineeringSessionKeys.repository(metadata.repositoryId, metadata.publishedRevision ?? "missing"),
      });
    },
  });
}

export function useAttachWorkflow(metadata: RepositoryMetadata, revision: string | null | undefined) {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; workflowId: string }) =>
      repositorySessionsApi.workflow(token as string, input.sessionId, input.workflowId),
    onSuccess: (envelope) => {
      if (revision) client.setQueryData(
        engineeringSessionKeys.detail(envelope.data.session.sessionId, revision),
        envelope,
      );
      void client.invalidateQueries({
        queryKey: engineeringSessionKeys.repository(metadata.repositoryId, metadata.publishedRevision ?? "missing"),
      });
    },
  });
}

function optimisticEvent(action: string, value: string): RepositorySessionEvent {
  return {
    eventId: `optimistic-${Date.now()}`,
    sequence: Number.MAX_SAFE_INTEGER,
    kind: action === "plan" ? "plan" : action === "specification" ? "specification" : action === "execution" ? "execution_summary" : action === "insights" ? "insight" : "query",
    referenceId: "pending",
    summary: action === "insights" ? "Generating repository insights..." : value,
    attributes: { pending: true, action, summary: sessionResultSummary(value as JsonValue) },
    createdAt: new Date().toISOString(),
  };
}
