"use client";

import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  PageContainer,
  RevisionBadge,
  SectionHeader,
} from "@/components/ui/foundation";
import { Skeleton } from "@/components/ui/skeleton";
import { RepositoryStatusBadge } from "@/components/ui/status-badge";
import { useRepositoryMetadata } from "@/hooks/use-repositories";
import { formatDate } from "@/lib/utils";
import type { RepositoryMetadata } from "@/types/api";

export function RepositoryDashboard() {
  const query = useRepositoryMetadata();
  const repositories = query.data?.repositories ?? [];
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Workspace"
        title="Repositories."
        description="Owned repositories and their published indexing state."
        action={repositories.length ? (
          <Button asChild variant="accent">
            <Link href="/repositories/connect"><Plus className="size-4" />Connect repository</Link>
          </Button>
        ) : undefined}
      />
      <section aria-labelledby="owned-repositories-heading" className="mt-8">
        <div className="flex items-center justify-between">
          <h2 id="owned-repositories-heading" className="type-section-title">Owned repositories</h2>
          {query.data ? <span className="type-metadata text-muted-foreground">{query.data.count} total</span> : null}
        </div>
        {query.isLoading ? <DashboardLoading /> : null}
        {query.isError ? <div className="mt-5"><ErrorState error={query.error} retry={() => void query.refetch()} /></div> : null}
        {!query.isLoading && !query.isError && repositories.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No repositories connected"
            description="Connect a GitHub repository to begin indexing its published revision."
            action={<Button asChild variant="accent"><Link href="/repositories/connect">Connect repository</Link></Button>}
          />
        ) : null}
        {repositories.length ? (
          <div className="mt-5 overflow-x-auto border-y border-border-subtle">
            <table aria-label="Owned repositories" className="w-full min-w-[760px] border-collapse text-left">
              <thead className="border-b border-border-subtle type-table-header text-muted-foreground">
                <tr><th className="px-3 py-3">Repository</th><th className="px-3 py-3">Lifecycle</th><th className="px-3 py-3">Revision</th><th className="px-3 py-3">Last indexed</th><th className="px-3 py-3">Last accessed</th></tr>
              </thead>
              <tbody>{repositories.map((repository) => <RepositoryRow key={repository.repositoryId} repository={repository} />)}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </PageContainer>
  );
}

function RepositoryRow({ repository }: { repository: RepositoryMetadata }) {
  const href = `/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  return (
    <tr className="border-b border-border-subtle type-compact last:border-b-0 hover:bg-hover">
      <td className="px-3 py-3"><Link href={href} className="rounded-control font-medium text-foreground hover:text-primary focus-ring">{repository.owner}/{repository.repo}</Link></td>
      <td className="px-3 py-3"><RepositoryStatusBadge status={repository.status} /></td>
      <td className="px-3 py-3"><RevisionBadge revision={repository.publishedRevision ?? repository.currentRevision} /></td>
      <td className="px-3 py-3 text-muted-foreground">{formatDate(repository.lastIndexedAt)}</td>
      <td className="px-3 py-3 text-muted-foreground">{formatDate(repository.lastAccessedAt)}</td>
    </tr>
  );
}

function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading repositories" className="mt-5 space-y-px border-y border-border-subtle">
      <span className="sr-only">Loading owned repositories.</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="grid grid-cols-[minmax(180px,1fr)_100px_100px] gap-4 px-3 py-4">
          <Skeleton className="h-4" /><Skeleton className="h-4" /><Skeleton className="h-4" />
        </div>
      ))}
    </div>
  );
}
