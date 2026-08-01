import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryWorkspace } from "@/features/repositories/workspace/repository-workspace";
import type { RepositoryMetadata, RepositorySessionDetail, RepositorySessionSummary } from "@/types/api";

const routerPush = vi.fn();
let currentSearchParams = "sessionId=session-1";

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

const activeSummary: RepositorySessionSummary = {
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
  eventCount: 2,
  lastEventKind: "answer",
  activeFeature: "Auth",
  activeModule: "auth",
};

const archivedSummary: RepositorySessionSummary = {
  ...activeSummary,
  sessionId: "archived-1",
  lifecycle: "archived",
  eventCount: 1,
  activeFeature: "Billing",
};

const sessionDetail: RepositorySessionDetail = {
  session: activeSummary,
  context: {
    contextVersion: 1,
    activeFeature: "Auth",
    activeModule: "auth",
    activeWorkflow: null,
    activeArchitecture: "layers",
    activeChangeAnalysis: null,
    previousQuestions: [],
    previousAnswers: [],
    recentFiles: ["src/auth.ts"],
    recentSymbols: ["authenticate"],
    recentFeatures: ["Auth"],
    viewedInsights: [],
    viewedPlans: [],
    viewedSpecifications: [],
    viewedExecutionSummaries: [],
    updatedAt: "2026-07-31T10:00:00.000Z",
  },
  diagnostics: [],
  events: [
    {
      eventId: "event-1",
      sequence: 1,
      kind: "answer",
      referenceId: "answer-1",
      summary: "## Result\n\n- item\n\n```ts\nconst value = 1\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n> quoted",
      attributes: {
        reasoning: "### Why\n\nUses indexed evidence.",
        files: [{ filePath: "src/auth.ts", startLine: 4, endLine: 8 }],
        symbol: "authenticate",
        confidence: { level: "high", score: 0.9 },
        requestId: "req-1",
      },
      createdAt: "2026-07-31T10:00:00.000Z",
    },
  ],
};

function renderWorkspace(params = "sessionId=session-1") {
  currentSearchParams = params;
  return render(<RepositoryWorkspace owner="acme" repo="platform" metadata={metadata} />);
}

describe("conversation UX sprint 4", () => {
  const action = vi.fn();

  beforeEach(() => {
    routerPush.mockReset();
    action.mockReset().mockResolvedValue({});
    queryMocks.overview.mockReturnValue({ data: { data: { features: [{ name: "Auth" }], symbols: { publicApis: [{ name: "authenticate" }] }, architecture: {}, metrics: {} }, partial: false, diagnostics: [], requestId: "gateway-1" }, dataUpdatedAt: Date.now(), isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.directory.mockReturnValue({ data: [], isLoading: false, isError: false });
    queryMocks.file.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.feature.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.semantic.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
    queryMocks.engineeringSessions.mockReturnValue({ data: { data: { sessions: [activeSummary, archivedSummary], count: 2 } }, isLoading: false });
    queryMocks.engineeringSession.mockReturnValue({ data: { data: sessionDetail }, isLoading: false, error: null, refetch: vi.fn() });
    queryMocks.createEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.archiveEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.deleteEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.engineeringAction.mockReturnValue({ mutateAsync: action, isPending: false, error: null });
    queryMocks.attachWorkflow.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
  });

  it("renders markdown, code blocks, tables, quotes, timestamps, and reasoning sections", () => {
    const view = renderWorkspace();
    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(view.container).toHaveTextContent("const value = 1");
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    expect(screen.getByText("quoted")).toBeInTheDocument();
    expect(screen.getAllByText("Reasoning").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it("supports composer shortcuts, clear, suggested prompts, and context chips", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Generate a step-by-step plan for this change." }));
    expect(screen.getByLabelText("Question or objective")).toHaveValue("Generate a step-by-step plan for this change.");
    fireEvent.click(screen.getByRole("button", { name: /file:src\/auth.ts/ }));
    expect((screen.getByLabelText("Question or objective") as HTMLTextAreaElement).value).toContain("Attach file:src/auth.ts");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Question or objective")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Question or objective"), { target: { value: "Run query" } });
    fireEvent.keyDown(screen.getByLabelText("Question or objective"), { key: "Enter" });
    expect(action).toHaveBeenCalledWith({ action: "query", value: "Run query", signal: expect.any(AbortSignal) });
  });

  it("renders typing placeholder and abort control while loading", () => {
    queryMocks.engineeringAction.mockReturnValue({ mutateAsync: action, isPending: true, error: null });
    renderWorkspace();
    expect(screen.getByText("Giro is composing")).toBeInTheDocument();
    expect(screen.getByLabelText("Streaming placeholder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abort request" })).toBeInTheDocument();
  });

  it("supports session search, grouping, and current session highlighting", () => {
    renderWorkspace();
    expect(screen.getByText("Recent sessions")).toBeInTheDocument();
    expect(screen.getByText("Archived sessions")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /session-1/ }).find((button) => button.getAttribute("aria-current") === "page")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search sessions"), { target: { value: "Billing" } });
    expect(screen.queryByRole("button", { name: /^session-1/ })).not.toBeInTheDocument();
    expect(screen.getByText("archived-1")).toBeInTheDocument();
  });

  it("renders expandable evidence with confidence, copy, line ranges, and related navigation", () => {
    renderWorkspace("sessionId=session-1&evidence=conversation");
    expect(screen.getByLabelText("Copy Conversation evidence")).toBeInTheDocument();
    expect(screen.getAllByText(/high/).length).toBeGreaterThan(0);
    expect(screen.getByText("Lines 4 - 8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open related file" }));
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?sessionId=session-1&evidence=file&file=src%2Fauth.ts", { scroll: false });
  });
});
