"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RepositorySessionState, WorkflowState } from "@/types/api";

export interface SessionContextState {
  currentSession: RepositorySessionState | null;
  workflow: WorkflowState | null;
  revision: string | null;
  activeArtifact: string | null;
  setCurrentSession(session: RepositorySessionState | null): void;
  setWorkflow(workflow: WorkflowState | null): void;
  setActiveArtifact(artifactId: string | null): void;
  resetSession(): void;
}

const SessionContext = createContext<SessionContextState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [currentSession, setCurrentSession] = useState<RepositorySessionState | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null);
  const resetSession = useCallback(() => {
    setCurrentSession(null);
    setWorkflow(null);
    setActiveArtifact(null);
  }, []);
  const value = useMemo<SessionContextState>(() => ({
    currentSession,
    workflow,
    revision: currentSession?.revision ?? null,
    activeArtifact,
    setCurrentSession,
    setWorkflow,
    setActiveArtifact,
    resetSession,
  }), [activeArtifact, currentSession, resetSession, workflow]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSessionContext must be used within SessionProvider");
  return context;
}
