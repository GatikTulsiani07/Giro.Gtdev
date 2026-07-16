"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-context";
import { sessionsApi } from "@/services/api/sessions";

export const sessionKeys = {
  all: ["sessions"] as const,
  detail: (id: string) => ["sessions", id] as const,
};

export function useSessions() {
  const { token } = useAuth();
  return useQuery({ queryKey: sessionKeys.all, queryFn: () => sessionsApi.list(token as string), enabled: Boolean(token) });
}

export function useSession(id: string) {
  const { token } = useAuth();
  return useQuery({ queryKey: sessionKeys.detail(id), queryFn: () => sessionsApi.get(token as string, id), enabled: Boolean(token && id) });
}

export function useCreateSession() {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { owner: string; repo: string; title?: string }) => sessionsApi.create(token as string, input),
    onSuccess: (session) => {
      client.setQueryData(sessionKeys.detail(session.id), session);
      void client.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useDeleteSession() {
  const { token } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionsApi.remove(token as string, id),
    onSuccess: () => client.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}
