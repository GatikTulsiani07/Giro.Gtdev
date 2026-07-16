import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepositoryOverview } from "@/features/repositories/repository-overview";
import { repository } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-sessions", () => ({ useCreateSession: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }));
vi.mock("@/hooks/use-repositories", () => ({
  useRepositories: () => ({ data: { repositories: [repository], count: 1 } }),
  useRepository: () => ({
    dashboard: {
      isLoading: false,
      isError: false,
      data: {
        repository: "acme/platform",
        status: { health: { status: "healthy" } },
        metrics: { files: 42, chunks: 120, symbols: 88, graphNodes: 57, graphEdges: 93 },
      },
    },
    summary: {
      data: {
        summary: {
          repositoryVersion: "job-1:1",
          purpose: "A repository intelligence platform",
          languages: [{ name: "TypeScript" }],
          frameworks: [{ name: "Hono" }],
          apiSurface: [{ name: "sessions" }],
          entrypoints: [{ name: "server", path: "src/index.ts", kind: "server" }],
          dependencyOverview: {
            centralModules: ["retrieval"],
            totalNodes: 57,
            totalEdges: 93,
            dependencyHotspots: [],
            circularDependencies: [],
          },
        },
      },
    },
  }),
}));

describe("repository page", () => {
  it("renders overview, intelligence, entrypoints, and indexing metadata", () => {
    render(<RepositoryOverview owner="acme" repo="platform" />);
    expect(screen.getByRole("heading", { name: "platform" })).toBeInTheDocument();
    expect(screen.getByText("A repository intelligence platform")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("job-1:1")).toBeInTheDocument();
  });
});
