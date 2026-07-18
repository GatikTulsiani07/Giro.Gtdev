"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/features/auth/auth-context";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden"><TopNav /><main className="min-h-0 flex-1 overflow-auto overflow-x-hidden">{children}</main></div>
      </div>
    </AuthGuard>
  );
}
