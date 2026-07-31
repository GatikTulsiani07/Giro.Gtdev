"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/features/auth/auth-context";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";

export function AppShell({ children, rightPanel }: { children: ReactNode; rightPanel?: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopNav />
          <div className="flex min-h-0 flex-1">
            <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-auto overflow-x-hidden">{children}</main>
            {rightPanel ? <aside aria-label="Context panel" className="hidden w-72 shrink-0 overflow-auto border-l border-border-subtle bg-panel desktop:block">{rightPanel}</aside> : null}
          </div>
          <footer aria-label="Application status" className="flex h-7 shrink-0 items-center border-t border-border-subtle bg-inset px-3 type-metadata text-muted-foreground">
            <span>Giro frontend</span><span className="mx-2" aria-hidden="true">·</span><span>API v1</span>
          </footer>
        </div>
      </div>
    </AuthGuard>
  );
}
