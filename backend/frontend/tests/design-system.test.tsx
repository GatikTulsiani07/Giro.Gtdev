import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchX } from "lucide-react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/overlays";
import { RepositoryStatusBadge, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/form-controls";
import { Tabs } from "@/components/ui/tabs";

describe("design system primitives", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  });

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
    render(<Tabs items={[{ id: "summary", label: "Summary", panelId: "summary-panel" }, { id: "files", label: "Files", panelId: "files-panel" }]} value="summary" onValueChange={onValueChange} />);
    const summaryTab = screen.getByRole("tab", { name: "Summary" });
    expect(summaryTab).toHaveAttribute("id", "summary-panel-tab");
    expect(summaryTab).toHaveAttribute("aria-controls", "summary-panel");
    fireEvent.keyDown(summaryTab, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalledWith("files");
  });

  it("names modal dialogs, traps boundary focus, and restores the trigger", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open details</button>{open ? <Modal open title="Repository details" description="Inspect repository metadata." onClose={() => setOpen(false)} footer={<button type="button">Done</button>}>Dialog body</Modal> : null}</>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open details" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Repository details" });
    expect(dialog).toHaveAccessibleDescription("Inspect repository metadata.");
    const close = screen.getByRole("button", { name: "Close dialog" });
    const done = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("supports nested, compact empty-state semantics", () => {
    render(<section><h2>Evidence</h2><EmptyState compact headingLevel={3} icon={SearchX} title="No evidence" description="Run a repository search first." /></section>);
    expect(screen.getByRole("heading", { level: 2, name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "No evidence" })).toBeInTheDocument();
    expect(screen.getByText("No evidence").parentElement).toHaveClass("min-h-40");
  });
});
