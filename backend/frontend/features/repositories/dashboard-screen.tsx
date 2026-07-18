"use client";

import Link from "next/link";
import { ArrowRight, FolderGit2, GitBranch, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepositories } from "@/hooks/use-repositories";
import { useSessions } from "@/hooks/use-sessions";
import { RepositoryCard } from "./repository-card";

export function DashboardScreen() {
  const repositories = useRepositories();
  const sessions = useSessions();

  return (
    <div className="layout-standard layout-gutter py-10 max-[820px]:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="type-section-eyebrow text-muted-foreground">Workspace</p><h1 className="mt-2 type-page-title">Repository <span className="italic text-primary">intelligence</span><span className="not-italic">.</span></h1><p className="mt-2 type-body text-text-secondary">Connect codebases, inspect evidence, and continue grounded conversations.</p></div>
        <Button variant="accent" asChild><Link href="/repositories/connect"><Plus className="size-4" />Connect repository</Link></Button>
      </div>
      <section aria-labelledby="repositories-heading" className="mt-7">
        <div className="mb-3 flex items-end justify-between"><div><h2 id="repositories-heading" className="type-section-eyebrow text-muted-foreground">Repositories</h2><p className="mt-2 type-compact text-text-secondary">Indexed repositories available for grounded questions</p></div><span className="type-metadata text-muted-foreground">{repositories.data?.count ?? 0} total</span></div>
        {repositories.isError ? <ErrorState error={repositories.error} retry={() => void repositories.refetch()} /> : null}
        {repositories.isLoading ? <div className="divide-y divide-border-subtle border-y border-border-subtle">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-20" />)}</div> : null}
        {repositories.data?.repositories.length ? <div className="divide-y divide-border-subtle border-y border-border-subtle">{repositories.data.repositories.map((repository) => <RepositoryCard key={`${repository.owner}/${repository.repo}`} repository={repository} />)}</div> : null}
        {repositories.data?.repositories.length === 0 ? <EmptyState icon={FolderGit2} title="Connect your first repository" description="Index a GitHub repository to unlock summaries, grounded Q&A, and retrieval inspection." action={<Button asChild size="sm"><Link href="/repositories/connect"><GitBranch className="size-4" />Connect repository</Link></Button>} /> : null}
      </section>
      <section aria-labelledby="sessions-heading" className="mt-7"><div className="mb-3"><h2 id="sessions-heading" className="type-section-eyebrow text-muted-foreground">Recent sessions</h2><p className="mt-2 type-compact text-text-secondary">Continue repository-scoped work</p></div><div className="divide-y divide-border-subtle border-y border-border-subtle">
          {sessions.isError ? <div className="p-3"><ErrorState error={sessions.error} retry={() => void sessions.refetch()} compact /></div> : null}
          {sessions.isLoading ? <div><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : null}
          {sessions.data?.sessions.slice(0, 5).map((session) => <Link key={session.id} href={`/chat/${session.id}`} className="flex min-h-10 items-center gap-3 px-3 py-2 transition-colors duration-[150ms] hover:bg-hover focus-ring"><MessageSquare className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate type-compact-strong">{session.title}</span><span className="block truncate type-metadata text-muted-foreground">{session.owner}/{session.repo} · {session.messageCount} messages</span></span><ArrowRight className="size-3.5 text-muted-foreground" /></Link>)}
          {!sessions.isLoading && sessions.data?.sessions.length === 0 ? <p className="p-6 type-body text-muted-foreground">No sessions yet. Open a repository to begin.</p> : null}
        </div></section>
    </div>
  );
}
