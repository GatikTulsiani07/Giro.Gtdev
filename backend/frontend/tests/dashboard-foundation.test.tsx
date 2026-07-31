import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryDashboard } from "@/features/repositories/repository-dashboard";

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-repositories", () => ({
  useRepositoryMetadata: () => state.query,
}));

describe("repository dashboard foundation", () => {
  beforeEach(() => {
    state.query = { isLoading: false, isError: false, data: { repositories: [], count: 0 } };
  });

  it("announces its loading state", () => {
    state.query = { isLoading: true, isError: false, data: undefined };
    render(<RepositoryDashboard />);
    expect(screen.getByRole("status", { name: "Loading repositories" })).toBeInTheDocument();
  });

  it("renders the connect action for an empty repository list", () => {
    render(<RepositoryDashboard />);
    expect(screen.getByRole("heading", { name: "No repositories connected" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect repository" })).toHaveAttribute("href", "/repositories/connect");
  });

  it("renders a normalized error state with retry", () => {
    state.query = {
      isLoading: false, isError: true, error: new Error("failed"),
      data: undefined, refetch: vi.fn(),
    };
    render(<RepositoryDashboard />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
