"use client";

import { useQuery } from "@tanstack/react-query";
import { Menu, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/data-display";
import {
  BackendStatusBadge,
  RevisionBadge,
} from "@/components/ui/foundation";
import { RepositoryStatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/features/auth/auth-context";
import { useOptionalRepository } from "@/features/repositories/repository-context";
import { standardApiClient } from "@/services/api/client";
import { useUiStore } from "@/store/ui-store";

export function TopNav() {
  const pathname = usePathname();
  const { token } = useAuth();
  const repository = useOptionalRepository();
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const health = useQuery({
    queryKey: ["backend", "health"],
    queryFn: ({ signal }) => standardApiClient.get<Record<string, unknown>>(
      "/health", token as string, signal),
    enabled: Boolean(token),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs = [
    { label: "Giro", href: "/dashboard" },
    ...(repository?.repositoryId
      ? [{ label: repository.repositoryId }]
      : [{ label: segments[0] === "settings" ? "Settings" : "Workspace" }]),
  ];

  return (
    <header className="flex min-h-[52px] shrink-0 items-center gap-3 border-b border-border-subtle bg-background px-3 laptop:px-5">
      <Button aria-label="Open navigation" title="Open navigation" variant="ghost" size="icon" className="laptop:hidden" onClick={() => setSidebarOpen(true)}><Menu className="size-4" /></Button>
      <div className="min-w-0"><Breadcrumbs items={breadcrumbs} /></div>
      <div className="ml-auto hidden min-w-0 items-center gap-2 mobile:flex">
        {repository?.repositoryId ? <RepositoryStatusBadge status={repository.status} /> : null}
        {repository?.repositoryId ? <RevisionBadge revision={repository.publishedRevision} /> : null}
        <BackendStatusBadge available={health.isLoading ? null : !health.isError} />
        <label className="relative ml-1 hidden desktop:block">
          <span className="sr-only">Search Giro</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
          <input disabled placeholder="Search coming soon" className="h-8 w-48 rounded-control border border-border-subtle bg-inset pl-8 pr-3 type-compact text-muted-foreground disabled:cursor-not-allowed" />
        </label>
      </div>
    </header>
  );
}
