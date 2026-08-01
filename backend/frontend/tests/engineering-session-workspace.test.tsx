import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const sessionSummary: RepositorySessionSummary = {
  sessionId: "session-1",
  repositoryId: "acme/platform",
  repositoryOwner: "acme",
  repositoryName: "platform",
  revision: metadata.publishedRevision as string,
  workflowId: null,
  attachedWorkflowId: "workflow-1",
  workflowState: "planning",
  workflowStage: "planning",
  attachedAt: "2026-07-31T11:00:00.000Z",
  lifecycle: "active",
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T11:00:00.000Z",
  expiresAt: "2026-08-01T10:00:00.000Z",
  archivedAt: null,
  eventCount: 4,
  lastEventKind: "plan",
  activeFeature: "Repository Workspace",
  activeModule: "features/repositories",
};

const sessionDetail: RepositorySessionDetail = {
  session: sessionSummary,
  context: {
    contextVersion: 1,
    activeFeature: "Repository Workspace",
    activeModule: "features/repositories",
    activeWorkflow: "workflow-1",
    activeArchitecture: "architecture",
    activeChangeAnalysis: null,
    previousQuestions: ["How is this structured?"],
    previousAnswers: ["It is a three-pane workspace."],
    recentFiles: ["features/repositories/workspace/repository-workspace.tsx"],
    recentSymbols: ["RepositoryWorkspace"],
    recentFeatures: ["Repository Workspace"],
    viewedInsights: ["insight-1"],
    viewedPlans: ["plan-1"],
    viewedSpecifications: [],
    viewedExecutionSummaries: [],
    updatedAt: "2026-07-31T11:00:00.000Z",
  },
  diagnostics: [{ code: "session_info", message: "Session ready", severity: "info" }],
  events: [
    { eventId: "event-1", sequence: 1, kind: "query", referenceId: "query-1", summary: "How is this structured?", attributes: { requestId: "req-query", confidence: { level: "high", score: 0.91, answerable: true, reasons: ["grounded"] } }, createdAt: "2026-07-31T10:10:00.000Z" },
    { eventId: "event-2", sequence: 2, kind: "answer", referenceId: "answer-1", summary: "It is a three-pane workspace.", attributes: { files: [{ path: "features/repositories/workspace/repository-workspace.tsx", startLine: 1, endLine: 20 }] }, createdAt: "2026-07-31T10:11:00.000Z" },
    { eventId: "event-3", sequence: 3, kind: "plan", referenceId: "plan-1", summary: "Implement persistent session UI.", attributes: { steps: ["Create session", "Render evidence"] }, createdAt: "2026-07-31T10:12:00.000Z" },
    { eventId: "event-4", sequence: 4, kind: "execution_summary", referenceId: "execution-1", summary: "Execution is ready.", attributes: { ready: true }, createdAt: "2026-07-31T10:13:00.000Z" },
  ],
};

function renderWorkspace(params = "sessionId=session-1") {
  currentSearchParams = params;
  return render(<RepositoryWorkspace owner="acme" repo="platform" metadata={metadata} />);
}

describe("engineering session workspace", () => {
  const create = vi.fn();
  const archive = vi.fn();
  const remove = vi.fn();
  const action = vi.fn();
  const attach = vi.fn();

  beforeEach(() => {
    routerPush.mockReset();
    create.mockReset().mockResolvedValue({ data: { session: { sessionId: "session-created" } } });
    archive.mockReset().mockResolvedValue({});
    remove.mockReset().mockResolvedValue({});
    action.mockReset().mockResolvedValue({ data: { session: sessionDetail, result: { answer: "Done" } } });
    attach.mockReset().mockResolvedValue({ data: { session: { attachedWorkflowId: "workflow-2" } } });
    queryMocks.overview.mockReturnValue({
      data: { data: { features: [{ name: "Repository Workspace" }], symbols: { publicApis: [{ name: "RepositoryWorkspace" }] }, architecture: {}, metrics: {} }, partial: false, diagnostics: [], requestId: "gateway-1" },
      dataUpdatedAt: Date.parse("2026-07-31T12:00:00.000Z"),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    queryMocks.directory.mockReturnValue({ data: [], isLoading: false, isError: false });
    queryMocks.file.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.feature.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.semantic.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
    queryMocks.engineeringSessions.mockReturnValue({ data: { data: { sessions: [sessionSummary], count: 1 } }, isLoading: false });
    queryMocks.engineeringSession.mockReturnValue({ data: { data: sessionDetail }, isLoading: false, error: null, refetch: vi.fn() });
    queryMocks.createEngineeringSession.mockReturnValue({ mutateAsync: create, isPending: false });
    queryMocks.archiveEngineeringSession.mockReturnValue({ mutateAsync: archive, isPending: false });
    queryMocks.deleteEngineeringSession.mockReturnValue({ mutateAsync: remove, isPending: false });
    queryMocks.engineeringAction.mockReturnValue({ mutateAsync: action, isPending: false, error: null });
    queryMocks.attachWorkflow.mockReturnValue({ mutateAsync: attach, isPending: false, error: null });
  });

  it("restores session state from the URL and renders conversation history", () => {
    renderWorkspace("sessionId=session-1&evidence=conversation");
    expect(queryMocks.engineeringSession).toHaveBeenCalledWith("session-1", metadata.publishedRevision);
    expect(screen.getByRole("region", { name: "Engineering session workspace" })).toHaveTextContent("session-1");
    expect(screen.getByLabelText("Conversation history")).toHaveTextContent("How is this structured?");
    expect(screen.getByLabelText("Conversation history")).toHaveTextContent("It is a three-pane workspace.");
  });

  it("creates or reuses a session and persists it in URL state", async () => {
    renderWorkspace("");
    fireEvent.click(screen.getAllByRole("button", { name: "Start engineering session" }).at(-1) as HTMLElement);
    expect(create).toHaveBeenCalledWith({});
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?sessionId=session-created", { scroll: false }));
  });

  it("opens, archives, and deletes previous sessions", async () => {
    renderWorkspace("sessionId=session-1");
    fireEvent.click(screen.getAllByText("session-1")[0] as HTMLElement);
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?sessionId=session-1", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Archive session-1" }));
    expect(archive).toHaveBeenCalledWith("session-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete session-1" }));
    expect(remove).toHaveBeenCalledWith("session-1");
  });

  it("renders pinned context and active context chips", () => {
    renderWorkspace("sessionId=session-1&file=README.md&feature=Repository+Workspace&symbol=RepositoryWorkspace");
    expect(screen.getByLabelText("Pinned context")).toHaveTextContent("File: README.md");
    expect(screen.getByLabelText("Pinned context")).toHaveTextContent("Feature: Repository Workspace");
    expect(screen.getByLabelText("Active context chips")).toHaveTextContent("Workflow: workflow-1");
  });

  it("runs engineering actions against the active session", () => {
    renderWorkspace("sessionId=session-1");
    fireEvent.change(screen.getByLabelText("Engineering action"), { target: { value: "plan" } });
    fireEvent.change(screen.getByLabelText("Question or objective"), { target: { value: "Plan a refactor" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(action).toHaveBeenCalledWith({ action: "plan", value: "Plan a refactor" });
  });

  it("attaches workflows and renders workflow state, stage, and timeline", () => {
    renderWorkspace("sessionId=session-1&workflow=workflow-2");
    expect(screen.getByRole("region", { name: "Workflow" })).toHaveTextContent("workflow-1");
    expect(screen.getByRole("region", { name: "Workflow" })).toHaveTextContent("planning");
    fireEvent.change(screen.getByLabelText("Workflow ID"), { target: { value: "workflow-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach workflow" }));
    expect(attach).toHaveBeenCalledWith({ sessionId: "session-1", workflowId: "workflow-2" });
  });

  it("renders evidence with diagnostics, confidence, request IDs, and line ranges", () => {
    renderWorkspace("sessionId=session-1&evidence=conversation");
    const evidence = screen.getByRole("complementary", { name: "Evidence" });
    expect(evidence).toHaveTextContent("Conversation");
    expect(evidence).toHaveTextContent("req-query");
    expect(evidence).toHaveTextContent("startLine");
    expect(evidence).toHaveTextContent("Session ready");
  });

  it("renders empty, loading, responsive, and accessibility states", () => {
    queryMocks.engineeringSession.mockReturnValueOnce({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    renderWorkspace("sessionId=session-1");
    expect(screen.getByRole("status", { name: "Loading repository workspace" })).toBeInTheDocument();

    queryMocks.engineeringSession.mockReturnValueOnce({ data: { data: { ...sessionDetail, events: [], context: { ...sessionDetail.context, recentFiles: [], recentFeatures: [], recentSymbols: [], activeFeature: null, activeModule: null, activeWorkflow: null } } }, isLoading: false, error: null, refetch: vi.fn() });
    renderWorkspace("sessionId=session-1");
    expect(screen.getByRole("heading", { name: "Empty conversation" })).toBeInTheDocument();
    expect(screen.getAllByRole("tablist", { name: "Mobile workspace panes" }).length).toBeGreaterThan(0);
  });
});
