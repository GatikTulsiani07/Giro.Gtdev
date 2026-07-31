"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";
import {
  PageContainer,
  RepositoryBadge,
  RevisionBadge,
  UnavailablePlaceholder,
} from "@/components/ui/foundation";
import { Skeleton } from "@/components/ui/skeleton";
import { RepositoryStatusBadge } from "@/components/ui/status-badge";
import { useRepositoryMetadataById } from "@/hooks/use-repositories";
import { useRepository } from "./repository-context";

export function RepositoryFoundation({ owner, repo }: { owner: string; repo: string }) {
  const query = useRepositoryMetadataById(owner, repo);
  const { selectRepository, clearRepository } = useRepository();
  const metadata = query.data?.repository;

  useEffect(() => {
    if (metadata) selectRepository(metadata);
    return clearRepository;
  }, [clearRepository, metadata, selectRepository]);

  if (query.isLoading) return <RepositoryFoundationLoading />;
  if (query.isError) return <PageContainer><ErrorState error={query.error} retry={() => void query.refetch()} /></PageContainer>;
  if (!metadata) return null;

  return (
    <div className="flex min-h-full flex-col">
      <PageContainer className="flex-1">
        <header className="border-b border-border-subtle pb-6">
          <p className="type-section-eyebrow text-muted-foreground">Repository workspace</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="type-page-title">{metadata.displayName}.</h1>
            <RepositoryStatusBadge status={metadata.status} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <RepositoryBadge repositoryId={metadata.repositoryId} />
            <RevisionBadge revision={metadata.publishedRevision} />
          </div>
        </header>
        <div className="mt-7 grid min-h-[420px] gap-6 laptop:grid-cols-[220px_minmax(0,1fr)_260px]">
          <aside aria-label="Repository context placeholder" className="border-r border-border-subtle pr-6">
            <UnavailablePlaceholder title="Repository context" />
          </aside>
          <main aria-label="Repository workspace placeholder" className="min-w-0">
            <UnavailablePlaceholder title="Engineering workspace" />
          </main>
          <aside aria-label="Repository evidence placeholder" className="border-l border-border-subtle pl-6">
            <UnavailablePlaceholder title="Evidence panel" />
          </aside>
        </div>
      </PageContainer>
      <div role="status" className="flex min-h-8 items-center gap-3 border-t border-border-subtle bg-inset px-4 type-metadata text-muted-foreground">
        <span>{metadata.repositoryId}</span><span aria-hidden="true">·</span>
        <span>{metadata.publishedRevision ? `revision ${metadata.publishedRevision.slice(0, 8)}` : "no published revision"}</span><span aria-hidden="true">·</span>
        <span>{metadata.status}</span>
      </div>
    </div>
  );
}

function RepositoryFoundationLoading() {
  return (
    <PageContainer>
      <div role="status" aria-label="Loading repository context">
        <Skeleton className="h-3 w-28" /><Skeleton className="mt-3 h-12 w-64" />
        <div className="mt-5 flex gap-2"><Skeleton className="h-6 w-36" /><Skeleton className="h-6 w-20" /></div>
        <div className="mt-8 grid gap-6 laptop:grid-cols-[220px_minmax(0,1fr)_260px]">
          <Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" />
        </div>
      </div>
    </PageContainer>
  );
}
