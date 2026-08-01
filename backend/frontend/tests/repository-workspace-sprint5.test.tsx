import { fireEvent, render, screen } from "@testing-library/react";
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
  lastEventKind: "file",
  activeFeature: "Authentication",
  activeModule: "auth",
};

const sessionDetail: RepositorySessionDetail = {
  session: sessionSummary,
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
    viewedInsights: ["insight-1"],
    viewedPlans: [],
    viewedSpecifications: [],
    viewedExecutionSummaries: [],
    updatedAt: "2026-07-31T10:00:00.000Z",
  },
  diagnostics: [],
  events: [{
    eventId: "event-1",
    sequence: 1,
    kind: "file",
    referenceId: "file-1",
    summary: "File evidence",
    attributes: { kind: "file", filePath: "src/auth.ts", startLine: 2, endLine: 4, confidence: "high", symbol: "authenticate" },
    createdAt: "2026-07-31T10:00:00.000Z",
  }],
};

const overviewData = {
  architecture: {
    layers: [{ name: "application", paths: ["src/app"] }],
    packageHierarchy: [{ name: "src", children: ["auth"] }],
    moduleHierarchy: [{ name: "auth", children: ["session"] }],
    dependencyGraph: [{ from: "auth", to: "api", count: 3 }],
    hotspots: [{ path: "src/auth.ts", score: 9 }],
    findings: [{ kind: "layering", summary: "Auth owns session boundary" }],
  },
  codeOrganization: {
    highestFanIn: [{ path: "src/api.ts", count: 7 }],
    highestFanOut: [{ path: "src/auth.ts", count: 5 }],
    cyclicDependencies: [{ cycle: ["src/a.ts", "src/b.ts"] }],
    utilityClusters: [{ name: "shared", files: ["src/api.ts"] }],
    coupling: [{ from: "auth", to: "api" }],
  },
  quality: { coupling: [{ module: "auth", degree: "medium" }] },
  evolution: { summary: "Auth module changed recently." },
  metrics: { filesAnalyzed: 4 },
  features: [
    { name: "Authentication", owner: "Identity", dependencies: ["API"], files: ["src/auth.ts"], symbolIds: ["authenticate"] },
    { name: "Billing", owner: "Commerce", upstream: ["Authentication"] },
  ],
  symbols: {
    publicApis: [{ name: "authenticate", qualifiedName: "auth.authenticate", file: "src/auth.ts", line: 1 }],
    internalApis: [{ name: "loadSession", qualifiedName: "auth.loadSession", file: "src/session.ts", line: 8 }],
  },
  subsystems: [{ name: "Frontend", rootPath: "src" }],
};

function renderWorkspace(params = "") {
  currentSearchParams = params;
  return render(<RepositoryWorkspace owner="acme" repo="platform" metadata={metadata} />);
}

describe("Giro Frontend Sprint 5 visual repository intelligence", () => {
  beforeEach(() => {
    routerPush.mockReset();
    window.localStorage.clear();
    queryMocks.overview.mockReturnValue({ data: { data: overviewData, partial: false, diagnostics: [], requestId: "gateway-1" }, dataUpdatedAt: Date.now(), isLoading: false, isError: false, refetch: vi.fn() });
    queryMocks.feature.mockReturnValue({
      data: {
        data: {
          feature: { name: "Authentication", owner: "Identity", files: ["src/auth.ts"], symbolIds: ["authenticate"] },
          ownership: { team: "Identity" },
          entryPoints: [{ filePath: "src/auth.ts", symbol: "login" }],
          exitPoints: [{ filePath: "src/session.ts", symbol: "persist" }],
          relatedApis: ["POST /login"],
          files: ["src/auth.ts"],
          symbols: ["authenticate"],
          dependencies: ["API"],
          upstream: ["Platform shell"],
          downstream: ["Billing"],
          relationships: [{ kind: "uses", target: "API" }],
          flows: [{ step: "Validate credentials" }],
        },
        partial: false,
        diagnostics: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    queryMocks.semantic.mockReturnValue({
      data: {
        data: {
          symbols: [{ name: "authenticate", filePath: "src/auth.ts", line: 1 }],
          hierarchy: [{ parent: "auth", child: "authenticate" }],
          inheritance: [{ base: "AuthProvider", implementation: "TokenAuthProvider" }],
          callers: [{ name: "login" }],
          callees: [{ name: "loadSession" }],
          references: [{ filePath: "src/app.ts", line: 12 }],
          implementations: [{ name: "TokenAuthProvider" }],
          dependencies: [{ name: "apiClient" }],
          relationships: [{ kind: "calls", target: "loadSession" }],
        },
        partial: false,
        diagnostics: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    queryMocks.directory.mockImplementation((_repo: RepositoryMetadata, path: string) => ({
      data: path ? [] : [
        { name: "src", relativePath: "src", type: "directory" },
        { name: "README.md", relativePath: "README.md", type: "file" },
        { name: "auth.ts", relativePath: "src/auth.ts", type: "file" },
      ],
      isLoading: false,
      isError: false,
    }));
    queryMocks.file.mockReturnValue({
      data: { filePath: "README.md", content: "# Giro\n\nconst value = 1\n", lineCount: 3, language: "markdown", sizeBytes: 24 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    queryMocks.engineeringSessions.mockReturnValue({ data: { data: { sessions: [sessionSummary], count: 1 } }, isLoading: false });
    queryMocks.engineeringSession.mockReturnValue({ data: { data: sessionDetail }, isLoading: false, error: null, refetch: vi.fn() });
    queryMocks.createEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.archiveEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.deleteEngineeringSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    queryMocks.engineeringAction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
    queryMocks.attachWorkflow.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
  });

  it("renders the architecture dashboard and insight dashboard from overview data", () => {
    renderWorkspace("view=architecture");
    expect(screen.getByRole("heading", { name: "Architecture dashboard" })).toBeInTheDocument();
    for (const label of ["Layer overview", "Package overview", "Module hierarchy", "Hotspots", "Cyclic dependencies", "Fan-in", "Fan-out", "Utility modules"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("region", { name: "Insight dashboard" })).toHaveTextContent("Repository evolution summary");
  });

  it("renders grouped feature maps and feature relationship sections", () => {
    renderWorkspace("view=features&feature=Authentication");
    expect(screen.getByRole("region", { name: "Grouped features" })).toHaveTextContent("Identity");
    for (const heading of ["Feature ownership", "Entry points", "Exit points", "Related APIs", "Dependencies", "Upstream", "Downstream"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("renders symbol quick navigation and semantic relationship sections", () => {
    renderWorkspace("view=symbols&symbol=authenticate");
    expect(screen.getByRole("region", { name: "Symbol quick navigation" })).toHaveTextContent("auth.authenticate");
    for (const heading of ["Hierarchy", "Inheritance", "Callers", "Callees", "References", "Implementations", "Dependencies"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("supports repository explorer search, breadcrumbs, recent files, keyboard expansion, and responsive switcher", () => {
    window.localStorage.setItem("giro:recent-files:acme/platform", JSON.stringify(["src/auth.ts"]));
    renderWorkspace("file=README.md");
    expect(screen.getByRole("tablist", { name: "Mobile workspace panes" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "File breadcrumbs" })).toHaveTextContent("README.md");
    expect(screen.getByRole("region", { name: "Recent files" })).toHaveTextContent("src/auth.ts");
    fireEvent.change(screen.getByPlaceholderText("Search files"), { target: { value: "readme" } });
    expect(screen.getByRole("treeitem", { name: /README.md/ })).toBeInTheDocument();
    const root = screen.getByRole("treeitem", { name: /platform/ });
    fireEvent.keyDown(root, { key: " " });
    expect(queryMocks.directory).toHaveBeenCalled();
  });

  it("renders line-oriented file viewing and grouped evidence affordances", () => {
    renderWorkspace("file=README.md&sessionId=session-1&evidence=conversation");
    expect(screen.getByRole("region", { name: "File viewer" })).toHaveTextContent("Markdown preview");
    expect(screen.getByRole("link", { name: "Line 1" })).toHaveAttribute("href", "#L1");
    expect(screen.getByRole("button", { name: "Copy line 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "file evidence group" })).toHaveTextContent("Lines 2 - 4");
    expect(screen.getByRole("button", { name: "Open related symbol" })).toBeInTheDocument();
  });
});
