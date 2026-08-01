"use client";

import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRepositories } from "@/hooks/use-repositories";
import { useSessions } from "@/hooks/use-sessions";
import { DashboardCommandCenter } from "./dashboard-command-center";
import { DeveloperOnboarding } from "./developer-onboarding";

export function DashboardScreen() {
  const repositories = useRepositories();
  const sessions = useSessions();
  const hasRepositories = Boolean(repositories.data?.repositories.length);
  const empty = !repositories.isLoading && !repositories.isError && repositories.data?.repositories.length === 0;

  return (
    <div className="layout-standard layout-gutter py-10 max-[820px]:py-8">
      <header className="flex flex-col gap-4 border-b border-border-subtle pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="type-section-eyebrow text-muted-foreground">Workspace</p><h1 className="mt-2 type-page-title">Repository <span className="italic text-primary">intelligence</span><span className="not-italic">.</span></h1><p className="mt-2 type-body text-text-secondary">Connect codebases, inspect evidence, and continue grounded conversations.</p></div>
        {hasRepositories ? <Button variant="accent" asChild><Link href="/repositories/connect"><Plus className="size-4" />Connect repository</Link></Button> : null}
      </header>
      {empty ? <EmptyDashboardOnboarding /> : (
        <>
          <DashboardCommandCenter repositories={repositories.data?.repositories} repositoryCount={repositories.data?.count} repositoriesLoading={repositories.isLoading} repositoryError={repositories.isError ? repositories.error : undefined} onRetryRepositories={() => void repositories.refetch()} sessions={sessions.data?.sessions} sessionsLoading={sessions.isLoading} sessionError={sessions.isError ? sessions.error : undefined} onRetrySessions={() => void sessions.refetch()} />
          {!repositories.isLoading && !repositories.isError ? <DeveloperOnboarding compact /> : null}
        </>
      )}
    </div>
  );
}

function EmptyDashboardOnboarding() {
  return <section aria-labelledby="first-repository-heading" className="mt-10"><div className="max-w-[680px]"><p className="type-section-eyebrow text-muted-foreground">No repositories connected</p><h2 id="first-repository-heading" className="mt-2 type-section-title">Connect your first repository.</h2><p className="mt-3 type-body text-text-secondary">Giro becomes useful after it can index a repository. Connect a GitHub repository, watch indexing progress, then open the workspace to inspect architecture, evidence, files, features, symbols, and sessions.</p><Button asChild variant="accent" className="mt-6 w-full mobile:w-auto"><Link href="/repositories/connect"><GitBranch className="size-4" />Connect repository</Link></Button></div><DeveloperOnboarding /></section>;
}
