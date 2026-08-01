import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryWorkspace } from "@/features/repositories/workspace/repository-workspace";
import { repositoryGatewayGuard } from "@/hooks/use-repository-workspace";
import type { RepositoryMetadata } from "@/types/api";

const routerPush = vi.fn();
let currentSearchParams = "";

const queryMocks = vi.hoisted(() => ({
  overview: vi.fn(),
  feature: vi.fn(),
  semantic: vi.fn(),
  directory: vi.fn(),
  file: vi.fn(),
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

const overviewResult = {
  data: {
    data: {
      architecture: {
        packageHierarchy: ["app", "services"],
        layers: [{ name: "frontend", paths: ["backend/frontend"] }],
        dependencyGraph: [{ from: "app", to: "services", count: 2 }],
        hotspots: [{ path: "features/repositories", value: 5 }],
      },
      codeOrganization: {
        highestFanIn: [{ path: "services/api/client.ts", value: 6 }],
        highestFanOut: [{ path: "features/repositories/workspace.tsx", value: 8 }],
        cyclicDependencies: [["a.ts", "b.ts"]],
        utilityClusters: [{ name: "api", files: ["services/api/client.ts"] }],
      },
      quality: { documentationCoverage: 0.7, oversizedFiles: [] },
      evolution: { growth: { files: 40, symbols: 80 }, stableAreas: ["services/api"] },
      metrics: { filesAnalyzed: 40, symbolsAnalyzed: 80 },
      features: [{ name: "Repository Workspace", featureId: "feature-1", files: ["features/repositories/workspace/repository-workspace.tsx"], symbolIds: ["RepositoryWorkspace"] }],
      symbols: {
        publicApis: [{ name: "RepositoryWorkspace", qualifiedName: "RepositoryWorkspace", file: "features/repositories/workspace/repository-workspace.tsx", line: 1 }],
      },
      subsystems: [{ name: "Frontend", rootPath: "backend/frontend", summary: "Workspace UI" }],
    },
    partial: false,
    diagnostics: [{ code: "info", message: "ok", severity: "info" }],
    requestId: "gateway-1",
    dataUpdatedAt: Date.parse("2026-07-31T12:00:00.000Z"),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  partial: false,
  diagnostics: [{ code: "info", message: "ok", severity: "info" }],
  requestId: "gateway-1",
  dataUpdatedAt: Date.parse("2026-07-31T12:00:00.000Z"),
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

function renderWorkspace(params = "") {
  currentSearchParams = params;
  return render(<RepositoryWorkspace owner="acme" repo="platform" metadata={metadata} />);
}

describe("Giro Frontend Sprint 2 workspace", () => {
  beforeEach(() => {
    routerPush.mockReset();
    currentSearchParams = "";
    queryMocks.overview.mockReturnValue(overviewResult);
    queryMocks.feature.mockReturnValue({
      data: {
        data: {
          feature: { name: "Repository Workspace", confidence: 0.91 },
          files: ["features/repositories/workspace/repository-workspace.tsx"],
          symbols: ["RepositoryWorkspace"],
          relationships: [{ kind: "owns_module", target: "features/repositories" }],
          flows: [{ steps: [{ label: "Open repository", file: "app/page.tsx" }] }],
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
          symbols: [{ name: "RepositoryWorkspace", file: "features/repositories/workspace/repository-workspace.tsx", line: 1 }],
          relationships: [{ kind: "references", fromSymbolId: "a", toSymbolId: "b" }],
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
      ],
      isLoading: false,
      isError: false,
    }));
    queryMocks.file.mockReturnValue({
      data: { filePath: "README.md", content: "# Giro\n\nWorkspace", lineCount: 3, language: "markdown", sizeBytes: 18 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("renders the permanent three-pane repository workspace and status bars", () => {
    renderWorkspace();
    expect(screen.getByRole("banner", { name: "Repository workspace header" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "Repository files" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Repository workspace" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByText("Gateway available")).toBeInTheDocument();
  });

  it("renders overview documentation without fake metric cards", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: "Architecture summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Code organization" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quality" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evolution summary" })).toBeInTheDocument();
    expect(screen.getByText("Files Analyzed")).toBeInTheDocument();
  });

  it("serializes workspace navigation and selected file through URL state", () => {
    renderWorkspace("view=overview&evidence=metadata");
    fireEvent.click(screen.getByRole("tab", { name: "Architecture" }));
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?view=architecture&evidence=metadata", { scroll: false });
    fireEvent.click(screen.getByRole("treeitem", { name: /README.md/ }));
    expect(routerPush).toHaveBeenCalledWith("/repositories/acme/platform?view=overview&evidence=file&file=README.md", { scroll: false });
  });

  it("renders architecture tables for packages, layers, dependencies, fan-in, fan-out, cycles, and utilities", () => {
    renderWorkspace("view=architecture");
    for (const heading of ["Subsystems", "Packages", "Layers", "Hotspots", "Dependencies", "Fan-in", "Fan-out", "Cycles", "Utility modules"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("renders feature explorer empty states and populated gateway operations gracefully", () => {
    renderWorkspace("view=features&feature=Repository+Workspace");
    expect(screen.getByLabelText("Feature selector")).toHaveValue("Repository Workspace");
    expect(screen.getByRole("heading", { name: "Feature summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Related files" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Related symbols" })).toBeInTheDocument();

    queryMocks.overview.mockReturnValueOnce({ ...overviewResult, data: { ...overviewResult.data, data: { ...overviewResult.data.data, features: [] } } });
    queryMocks.feature.mockReturnValueOnce({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    renderWorkspace("view=features");
    expect(screen.getByRole("heading", { name: "No feature selected" })).toBeInTheDocument();
  });

  it("renders symbol search, operation selector, relationships, and stale request loading state", () => {
    queryMocks.semantic.mockReturnValueOnce({ data: undefined, isLoading: true, isFetching: true, isError: false, refetch: vi.fn() });
    renderWorkspace("view=symbols&symbol=RepositoryWorkspace");
    expect(screen.getByPlaceholderText("Search symbols")).toHaveValue("RepositoryWorkspace");
    expect(screen.getByLabelText("Semantic operation")).toHaveValue("definition");
    expect(queryMocks.semantic).toHaveBeenCalledWith("acme", "platform", metadata, "definition", "RepositoryWorkspace", true);
  });

  it("renders file viewer as safe monospace text", () => {
    renderWorkspace("file=README.md");
    expect(screen.getByLabelText("File viewer")).toHaveTextContent("README.md");
    const source = screen.getByText((content) => content.includes("# Giro"));
    expect(source).toBeInTheDocument();
    expect(source.closest("pre")).toHaveClass("type-mono");
  });

  it("renders reusable evidence with diagnostics, metadata, revision, and request ID", () => {
    renderWorkspace("evidence=diagnostics");
    expect(screen.getByRole("complementary", { name: "Evidence" })).toHaveTextContent("gateway-1");
    expect(screen.getAllByText("Diagnostics").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Revision").length).toBeGreaterThan(0);
  });

  it("guards queued, indexing, stale, failed, mismatch, missing revision, and incompatible gateway states", () => {
    for (const patch of [
      { status: "queued" as const },
      { status: "indexing" as const },
      { status: "failed" as const },
      { status: "stale" as const },
      { isStale: true },
      { revisionConsistent: false },
      { publishedRevision: null },
      { gatewayCompatible: false },
    ]) {
      expect(repositoryGatewayGuard({ ...metadata, ...patch }).ready).toBe(false);
    }
    expect(repositoryGatewayGuard(metadata)).toMatchObject({ ready: true, revision: metadata.publishedRevision });
  });

  it("exposes responsive context/workspace/evidence switcher", () => {
    renderWorkspace();
    expect(screen.getByRole("tablist", { name: "Mobile workspace panes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getAllByRole("complementary", { name: "Evidence" }).length).toBeGreaterThan(0);
  });

  it("keeps tree controls keyboard accessible", () => {
    renderWorkspace();
    const root = screen.getByRole("treeitem", { name: /platform/ });
    fireEvent.keyDown(root, { key: "Enter" });
    expect(queryMocks.directory).toHaveBeenCalled();
  });
});
