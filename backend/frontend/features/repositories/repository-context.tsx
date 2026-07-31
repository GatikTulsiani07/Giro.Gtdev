"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RepositoryLifecycleStatus, RepositoryMetadata } from "@/types/api";

export interface RepositoryContextState {
  repositoryId: string | null;
  owner: string | null;
  repository: string | null;
  publishedRevision: string | null;
  status: RepositoryLifecycleStatus | null;
  selectRepository(repository: RepositoryMetadata): void;
  clearRepository(): void;
}

const RepositoryContext = createContext<RepositoryContextState | null>(null);

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<RepositoryMetadata | null>(null);
  const selectRepository = useCallback((repository: RepositoryMetadata) => {
    setCurrent(repository);
  }, []);
  const clearRepository = useCallback(() => setCurrent(null), []);
  const value = useMemo<RepositoryContextState>(() => ({
    repositoryId: current?.repositoryId ?? null,
    owner: current?.owner ?? null,
    repository: current?.repository ?? null,
    publishedRevision: current?.publishedRevision ?? null,
    status: current?.status ?? null,
    selectRepository,
    clearRepository,
  }), [clearRepository, current, selectRepository]);
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): RepositoryContextState {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error("useRepository must be used within RepositoryProvider");
  return context;
}

export function useOptionalRepository(): RepositoryContextState | null {
  return useContext(RepositoryContext);
}
