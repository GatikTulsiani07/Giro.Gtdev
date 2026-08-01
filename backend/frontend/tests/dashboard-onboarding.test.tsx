import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen } from "@/features/repositories/dashboard-screen";

const state = vi.hoisted(() => ({ loading: false }));

vi.mock("@/hooks/use-repositories", () => ({
  useRepositories: () => ({
    data: state.loading ? undefined : { repositories: [], count: 0 },
    isLoading: state.loading,
    isError: false,
  }),
}));
vi.mock("@/hooks/use-sessions", () => ({ useSessions: () => ({ data: { sessions: [] }, isLoading: false, isError: false }) }));

describe("empty dashboard onboarding", () => {
  beforeEach(() => { state.loading = false; });

  it("presents the repository workflow in order with one primary connection action", () => {
    render(<DashboardScreen />);
    expect(screen.getByRole("heading", { name: "Connect your first repository." })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Developer onboarding steps" })).getAllByRole("listitem");
    expect(steps.map((step) => within(step).getByRole("heading").textContent)).toEqual([
      "Connect Repository",
      "Wait for Index",
      "Open Workspace",
      "Ask First Question",
      "Create First Session",
      "Explore Architecture",
    ]);
    expect(screen.getAllByRole("link", { name: "Connect repository" })[0]).toHaveAttribute("href", "/repositories/connect");
    expect(screen.getByRole("complementary", { name: "Demo repository walkthrough" })).toHaveTextContent("giro-demo/sample-platform");
    expect(screen.getByRole("link", { name: /Open walkthrough/ })).toHaveAttribute("href", "/repositories/giro-demo/sample-platform");
    expect(screen.getByRole("link", { name: /Explore architecture/ })).toHaveAttribute("href", "/repositories/giro-demo/sample-platform?view=architecture&feature=Authentication");
    expect(screen.queryByRole("heading", { name: "Recent sessions" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Engineering command center")).not.toBeInTheDocument();
  });

  it("announces the repository-shaped loading state", () => {
    state.loading = true;
    render(<DashboardScreen />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading dashboard repositories and investigations.",
    );
    expect(screen.getByLabelText("Engineering command center")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("list", { name: "Developer onboarding steps" })).not.toBeInTheDocument();
  });
});
