import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  attachedWorkflowId: "workflow-1",
  workflowState: "planning",
  workflowStage: "review",
  attachedAt: "2026-07-31T10:05:00.000Z",
  lifecycle: "active",
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:05:00.000Z",
  expiresAt: "2026-08-01T10:00:00.000Z",
  archivedAt: null,
  eventCount: 2,
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
    activeWorkflow: "workflow-1",
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
  diagnostics: [{ code: "session_info", message: "ready", severity: "info" }],
  events: [
    { eventId: "event-1", sequence: 1, kind: "query", referenceId: "query-1", summary: "How does auth work?", attributes: {}, createdAt: "2026-07-31T10:01:00.000Z" },
    { eventId: "event-2", sequence: 2, kind: "answer", referenceId: "answer-1", summary: "Auth is handled by `authenticate`.", attributes: { requestId: "req-answer" }, createdAt: "2026-07-31T10:02:00.000Z" },
  ],
};

const overviewData = {
  architecture: { files: [{ filePath: "src/auth.ts" }], layers: [{ name: "web" }] },
  codeOrganization: { highestFanIn: [{ path: "src/auth.ts", value: 3 }] },
  quality: {},
  evolution: {},
  metrics: {},
  features: [{ name: "Authentication", owner: "Identity", files: ["src/auth.ts"] }],
  symbols: { publicApis: [{ name: "authenticate", qualifiedName: "auth.authenticate", filePath: "src/auth.ts" }] },
};

function renderWorkspace(params = "sessionId=session-1") {
  currentSearchParams = params;
  return render(<RepositoryWorkspace owner="acme" repo="platform" metadata={metadata} />);
}

describe("Giro Frontend Release Candidate 1 workspace polish", () => {
  beforeEach(() => {
    routerPush.mockReset();
    currentSearchParams = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    queryMocks.overview.mockReturnValue({ data: { data: overviewData, partial: false, diagnostics: [], requestId: "gateway-1" }, dataUpdatedAt: Date.parse("2026-07-31T10:06:00.000Z"), isLoading: false, isError: false, refetch: vi.fn() });
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

  it("restores focus after command palette close and exposes the active result", async () => {
    renderWorkspace();
    const trigger = screen.getByRole("button", { name: "Open command palette" });
    trigger.focus();
    fireEvent.click(trigger);
    const search = await screen.findByLabelText("Global repository search");
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "authenticate" } });
    expect(search).toHaveAttribute("aria-controls", "command-palette-results");
    expect(search).toHaveAttribute("aria-activedescendant", expect.stringContaining("symbol"));
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps the audited shell landmarks, status, and mobile switcher available", () => {
    renderWorkspace();
    expect(screen.getByRole("banner", { name: "Repository workspace header" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Repository workspace" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Workspace status" })).toHaveTextContent("Gateway available");
    expect(screen.getByRole("tablist", { name: "Mobile workspace panes" })).toBeInTheDocument();
  });

  it("renders readable session groups, timestamps, and workflow timeline metadata", () => {
    renderWorkspace();
    const conversation = screen.getByLabelText("Conversation history");
    expect(within(conversation).getByLabelText("query event")).toHaveTextContent("How does auth work?");
    expect(within(conversation).getByLabelText("answer event")).toHaveTextContent("Auth is handled by");
    expect(within(conversation).getAllByText(/7\/31\/2026|31\/7\/2026|2026/).length).toBeGreaterThan(0);
    const workflow = screen.getByRole("region", { name: "Workflow" });
    expect(workflow).toHaveTextContent("workflow-1");
    expect(workflow.querySelectorAll("time").length).toBeGreaterThan(0);
  });

  it("keeps navigation and partial recovery actions predictable", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    const refetch = vi.fn();
    queryMocks.overview.mockReturnValue({ data: { data: overviewData, partial: true, diagnostics: [{ code: "partial", message: "partial", severity: "warning" }], requestId: "gateway-1" }, dataUpdatedAt: Date.now(), isLoading: false, isError: false, refetch });
    renderWorkspace("view=architecture&sessionId=session-1");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(back).toHaveBeenCalled();
    expect(forward).toHaveBeenCalled();
    const recovery = screen.getByRole("status", { name: "Workspace recovery" });
    fireEvent.click(within(recovery).getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
    fireEvent.click(within(recovery).getByRole("button", { name: "Refresh context" }));
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?view=architecture&sessionId=session-1&evidence=diagnostics", { scroll: false });
    back.mockRestore();
    forward.mockRestore();
  });
});
