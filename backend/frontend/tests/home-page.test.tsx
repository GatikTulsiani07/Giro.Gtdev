import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";

describe("public Giro homepage", () => {
  it("presents the supported repository-intelligence workflow with real sign-in destinations", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: /Understand the repository before changing it/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Sign in/ }).every((link) => link.getAttribute("href") === "/login")).toBe(true);
    expect(screen.getByText("Repository summaries and detected technology")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trace an answer back to indexed repository context." })).toBeInTheDocument();
    expect(screen.getByText(/Source URLs are not currently exposed/)).toBeInTheDocument();
  });

  it("keeps Web available and labels unsupported products as coming-soon concepts", () => {
    render(<HomePage />);
    const previews = screen.getByRole("tablist", { name: "Platform previews" });
    expect(within(previews).getByRole("tab", { name: /Web AVAILABLE/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(previews).getByRole("tab", { name: /IDE COMING SOON/ }));
    expect(screen.getByText("Coming soon concept")).toBeInTheDocument();
    expect(screen.getByText("No IDE extension ships today")).toBeInTheDocument();
    expect(screen.getByText(/does not represent completed functionality/)).toBeInTheDocument();
  });

  it("provides an accessible pause control for the platform preview", () => {
    render(<HomePage />);
    const pause = screen.getByRole("button", { name: "Pause preview" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: "Play preview" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not autoplay the platform preview when reduced motion is requested", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    render(<HomePage />);
    expect(screen.getByRole("button", { name: "Play preview" })).toHaveAttribute("aria-pressed", "true");
  });

  it("states the current provider implementation without claiming Anthropic support", () => {
    render(<HomePage />);
    expect(screen.getByText("Current provider implementation")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1-mini")).toBeInTheDocument();
    expect(screen.getByText("text-embedding-3-small")).toBeInTheDocument();
    expect(screen.getByText(/Anthropic models.*are not implemented/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude Opus 4\.8.*available/i)).not.toBeInTheDocument();
  });
});
