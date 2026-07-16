"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { subscribeToIndexing } from "@/services/sse/indexing-events";
import type { IndexingProgress } from "@/types/api";

export function useIndexingProgress(repositoryId: string, initial?: IndexingProgress) {
  const { token } = useAuth();
  const [progress, setProgress] = useState<IndexingProgress | undefined>(initial);
  const [connected, setConnected] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    if (!token || !repositoryId) return;
    const controller = new AbortController();
    void subscribeToIndexing(repositoryId, token, {
      onProgress: (event) => {
        setProgress(event);
        setDisconnected(false);
      },
      onConnectionChange: setConnected,
      onError: () => setDisconnected(true),
    }, controller.signal);
    return () => controller.abort();
  }, [repositoryId, token]);

  return { progress, connected, disconnected };
}
