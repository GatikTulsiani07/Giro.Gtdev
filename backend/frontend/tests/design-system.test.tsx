import { fireEvent, render, screen } from "@testing-library/react";
import { SearchX } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RepositoryStatusBadge, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/form-controls";
import { Tabs } from "@/components/ui/tabs";

describe("design system primitives", () => {
  it("keeps controls labeled and exposes semantic state", () => {
    const onCheckedChange = vi.fn();
    render(<><Button>Connect repository</Button><StatusBadge label="Ready" tone="success" /><RepositoryStatusBadge status="indexed" /><Switch checked={false} onCheckedChange={onCheckedChange} label="Include archived sessions" /></>);
    expect(screen.getByRole("button", { name: "Connect repository" })).toBeInTheDocument();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    fireEvent.click(screen.getByRole("switch", { name: "Include archived sessions" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("supports arrow-key tab navigation", () => {
    const onValueChange = vi.fn();
    render(<Tabs items={[{ id: "summary", label: "Summary" }, { id: "files", label: "Files" }]} value="summary" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Summary" }), { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalledWith("files");
  });

  it("supports nested, compact empty-state semantics", () => {
    render(<section><h2>Evidence</h2><EmptyState compact headingLevel={3} icon={SearchX} title="No evidence" description="Run a repository search first." /></section>);
    expect(screen.getByRole("heading", { level: 2, name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "No evidence" })).toBeInTheDocument();
    expect(screen.getByText("No evidence").parentElement).toHaveClass("min-h-40");
  });
});
