import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  RepositoryProvider,
  useRepository,
} from "@/features/repositories/repository-context";
import {
  SessionProvider,
  useSessionContext,
} from "@/features/sessions/session-context";
import type { RepositoryMetadata } from "@/types/api";

const repository: RepositoryMetadata = {
  repositoryId: "acme/platform", owner: "acme", repo: "platform",
  repository: "platform", displayName: "platform", status: "indexed",
  currentRevision: "a".repeat(40), indexedRevision: "a".repeat(40),
  publishedRevision: "a".repeat(40), revisionConsistent: true,
  gatewayCompatible: true, isStale: false,
  lastIndexedAt: "2026-07-31T10:00:00.000Z",
  lastAccessedAt: "2026-07-31T11:00:00.000Z",
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-31T11:00:00.000Z",
};

describe("frontend context providers", () => {
  it("maintains and clears the public repository context", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      <RepositoryProvider>{children}</RepositoryProvider>;
    const { result } = renderHook(useRepository, { wrapper });
    expect(result.current.repositoryId).toBeNull();
    act(() => result.current.selectRepository(repository));
    expect(result.current).toMatchObject({
      repositoryId: "acme/platform", owner: "acme", repository: "platform",
      publishedRevision: "a".repeat(40), status: "indexed",
    });
    act(() => result.current.clearRepository());
    expect(result.current.repositoryId).toBeNull();
  });

  it("keeps session, workflow, revision, and active artifact as state only", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      <SessionProvider>{children}</SessionProvider>;
    const { result } = renderHook(useSessionContext, { wrapper });
    act(() => result.current.setCurrentSession({
      sessionId: "session-1", repositoryId: "acme/platform",
      revision: "b".repeat(40), lifecycle: "active",
      attachedWorkflowId: "workflow-1",
    }));
    act(() => result.current.setWorkflow({
      workflowId: "workflow-1", version: 2,
      lifecycle: "planning", currentStage: "planning",
    }));
    act(() => result.current.setActiveArtifact("artifact-1"));
    expect(result.current.revision).toBe("b".repeat(40));
    expect(result.current.workflow?.version).toBe(2);
    expect(result.current.activeArtifact).toBe("artifact-1");
    act(() => result.current.resetSession());
    expect(result.current).toMatchObject({
      currentSession: null, workflow: null, revision: null, activeArtifact: null,
    });
  });
});
