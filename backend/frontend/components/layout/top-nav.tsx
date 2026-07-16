"use client";

import { Menu, PanelRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/store/ui-store";

export function TopNav() {
  const { setSidebarOpen, toggleInspector } = useUiStore();
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-background/80 px-3 backdrop-blur sm:px-5">
      <Button aria-label="Open navigation" variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu className="size-4" /></Button>
      <div className="ml-2 hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><Search className="size-3.5" /><span>Repository workspace</span></div>
      <div className="ml-auto flex items-center gap-1">
        <Button aria-label="Toggle retrieval inspector" variant="ghost" size="icon" onClick={toggleInspector}><PanelRight className="size-4" /></Button>
        <div className="ml-2 grid size-7 place-items-center rounded-full border border-border bg-muted font-display text-sm italic text-muted-foreground" aria-label="Signed in">G</div>
      </div>
    </header>
  );
}
