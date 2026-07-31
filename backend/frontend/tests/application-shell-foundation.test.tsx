import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";

vi.mock("@/features/auth/auth-context", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: () => <aside aria-label="Application navigation">Navigation</aside>,
}));
vi.mock("@/components/layout/top-nav", () => ({
  TopNav: () => <header>Repository header</header>,
}));

describe("permanent application shell", () => {
  it("provides navigation, header, main, optional right panel, and status landmarks", () => {
    render(<AppShell rightPanel={<p>Evidence</p>}><h1>Dashboard</h1></AppShell>);
    expect(screen.getByRole("complementary", { name: "Application navigation" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Repository header");
    expect(screen.getByRole("main")).toHaveTextContent("Dashboard");
    expect(screen.getByRole("complementary", { name: "Context panel" })).toHaveTextContent("Evidence");
    expect(screen.getByRole("contentinfo", { name: "Application status" })).toHaveTextContent("API v1");
  });
});
