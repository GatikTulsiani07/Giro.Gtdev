import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryWorkspace } from "@/features/repositories/workspace/repository-workspace";
import type { RepositoryMetadata, RepositorySessionDetail, RepositorySessionSummary } from "@/types/api";

const routerPush = vi.fn();
let currentSearchParams = "";

const queryMocks = vi.hoisted(() => ({
  overview: vi.fn(),
  feature: vi.fn(),
  semantic: vi.fn(),
  directory: vi.fn(),
  file: vi.fn(),
  engineeringSessions: vi.fn(),
  engineeringSession: vi.fn(),
  createEngineeringSession: vi.fn(),
  archiveEngineeringSession: vi.fn(),
  deleteEngineeringSession: vi.fn(),
  engineeringAction: vi.fn(),
  attachWorkflow: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

vi.mock("@/hooks/use-repository-workspace", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-repository-workspace")>("@/hooks/use-repository-workspace");
  return {
    ...actual,
    useGatewayOverview: queryMocks.overview,
    useFeatureNavigation: queryMocks.feature,
    useSemanticNavigation: queryMocks.semantic,
    useRepositoryDirectory: queryMocks.directory,
    useRepositoryFile: queryMocks.file,
  };
});

vi.mock("@/hooks/use-engineering-sessions", () => ({
  useEngineeringSessions: queryMocks.engineeringSessions,
  useEngineeringSession: queryMocks.engineeringSession,
  useCreateEngineeringSession: queryMocks.createEngineeringSession,
  useArchiveEngineeringSession: queryMocks.archiveEngineeringSession,
  useDeleteEngineeringSession: queryMocks.deleteEngineeringSession,
  useEngineeringAction: queryMocks.engineeringAction,
  useAttachWorkflow: queryMocks.attachWorkflow,
}));

const metadata: RepositoryMetadata = {
  repositoryId: "acme/platform",
  owner: "acme",
  repo: "platform",
  repository: "acme/platform",
  displayName: "acme/platform",
  status: "indexed",
  currentRevision: "1111111111111111111111111111111111111111",
  indexedRevision: "1111111111111111111111111111111111111111",
  publishedRevision: "1111111111111111111111111111111111111111",
  revisionConsistent: true,
  gatewayCompatible: true,
  isStale: false,
  lastIndexedAt: "2026-07-31T10:00:00.000Z",
  lastAccessedAt: null,
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
};

const session: RepositorySessionSummary = {
  sessionId: "session-1",
  repositoryId: "acme/platform",
  repositoryOwner: "acme",
  repositoryName: "platform",
  revision: metadata.publishedRevision as string,
  workflowId: null,
  attachedWorkflowId: null,
  workflowState: null,
  workflowStage: null,
  attachedAt: null,
  lifecycle: "active",
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
  expiresAt: "2026-08-01T10:00:00.000Z",
  archivedAt: null,
  eventCount: 1,
  lastEventKind: "answer",
  activeFeature: "Authentication",
  activeModule: "auth",
};

const sessionDetail: RepositorySessionDetail = {
  session,
  context: {
    contextVersion: 1,
    activeFeature: "Authentication",
    activeModule: "auth",
    activeWorkflow: null,
    activeArchitecture: "layers",
    activeChangeAnalysis: null,
    previousQuestions: [],
    previousAnswers: [],
    recentFiles: ["src/auth.ts"],
    recentSymbols: ["authenticate"],
    recentFeatures: ["Authentication"],
    viewedInsights: [],
    viewedPlans: [],
    viewedSpecifications: [],
    viewedExecutionSummaries: [],
    updatedAt: "2026-07-31T10:00:00.000Z",
  },
  diagnostics: [],
  events: [],
};

const overviewData = {
  architecture: { files: [{ filePath: "src/auth.ts" }] },
  codeOrganization: {},
  quality: {},
  evolution: {},
  metrics: {},
  features: [{ name: "Authentication", owner: "Identity", files: ["src/auth.ts"] }],
  symbols: { publicApis: [{ name: "authenticate", qualifiedName: "auth.authenticate", filePath: "src/auth.ts" }] },
};

function renderWorkspace(params = "") {
  currentSearchParams = params;
  return render(<RepositoryWorkspace owner="acme" repo="platform" metadata={metadata} />);
}

describe("Giro Frontend Sprint 6 production workspace", () => {
  beforeEach(() => {
    routerPush.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    queryMocks.overview.mockReturnValue({ data: { data: overviewData, partial: false, diagnostics: [], requestId: "gateway-1" }, dataUpdatedAt: Date.now(), isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.feature.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.semantic.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
    queryMocks.directory.mockReturnValue({ data: [{ name: "auth.ts", relativePath: "src/auth.ts", type: "file" }], isLoading: false, isError: false });
    queryMocks.file.mockReturnValue({ data: { filePath: "src/auth.ts", content: "export const authenticate = true;", lineCount: 1, language: "typescript", sizeBytes: 33 }, isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.engineeringSessions.mockReturnValue({ data: { data: { sessions: [session], count: 1 } }, isLoading: false });
    queryMocks.engineeringSession.mockReturnValue({ data: { data: sessionDetail }, isLoading: false, error: null, refetch: vi.fn() });
    queryMocks.createEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.archiveEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.deleteEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.engineeringAction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
    queryMocks.attachWorkflow.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
  });

  it("opens the command palette with Cmd+K and searches existing entities by keyboard", () => {
    renderWorkspace();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Global repository search"), { target: { value: "Authentication" } });
    expect(screen.getByRole("region", { name: "Features results" })).toHaveTextContent("Authentication");
    fireEvent.keyDown(screen.getByLabelText("Global repository search"), { key: "Enter" });
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?view=features&feature=Authentication&evidence=feature", { scroll: false });
  });

  it("supports command palette arrow navigation, Escape close, and session commands", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    fireEvent.change(screen.getByLabelText("Global repository search"), { target: { value: "session-1" } });
    fireEvent.keyDown(screen.getByLabelText("Global repository search"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByLabelText("Global repository search"), { key: "Enter" });
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?sessionId=session-1&view=overview", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("remembers recent activity and workspace state locally", () => {
    renderWorkspace("view=symbols&symbol=auth.authenticate&feature=Authentication&file=src/auth.ts&sessionId=session-1&evidence=symbol");
    expect(window.localStorage.getItem("giro:last-repository")).toBe("acme/platform");
    expect(window.localStorage.getItem("giro:last-session:acme/platform")).toBe("session-1");
    expect(window.localStorage.getItem("giro:recent-files:acme/platform")).toContain("src/auth.ts");
    expect(window.localStorage.getItem("giro:recent-symbols:acme/platform")).toContain("auth.authenticate");
    expect(window.localStorage.getItem("giro:recent-features:acme/platform")).toContain("Authentication");
  });

  it("restores deep-linked workspace state when no URL state is present", () => {
    window.localStorage.setItem("giro:workspace-state:acme/platform", JSON.stringify({ view: "symbols", selectedSymbol: "auth.authenticate", selectedEvidence: "symbol", sessionId: "session-1" }));
    renderWorkspace();
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?view=symbols&sessionId=session-1&symbol=auth.authenticate&evidence=symbol", { scroll: false });
  });

  it("renders loading skeletons, recovery actions, and accessible search landmarks", () => {
    queryMocks.overview.mockReturnValue({ data: undefined, dataUpdatedAt: 0, isLoading: true, isError: false, refetch: vi.fn() });
    const loading = renderWorkspace();
    expect(screen.getByRole("status", { name: "Loading repository workspace" })).toBeInTheDocument();
    loading.unmount();

    const refetch = vi.fn();
    queryMocks.overview.mockReturnValue({ data: undefined, dataUpdatedAt: 0, isLoading: false, isError: true, error: new Error("gateway unavailable"), refetch });
    renderWorkspace("view=architecture");
    const recovery = screen.getByRole("status", { name: "Workspace recovery" });
    expect(recovery).toHaveTextContent("Repository intelligence is unavailable.");
    fireEvent.click(within(recovery).getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
