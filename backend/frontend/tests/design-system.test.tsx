import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
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
});
