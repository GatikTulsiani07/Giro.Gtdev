"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/foundation";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepositoryMetadataById } from "@/hooks/use-repositories";
import { useRepository } from "./repository-context";
import { RepositoryWorkspace } from "./workspace/repository-workspace";

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

  return <RepositoryWorkspace owner={owner} repo={repo} metadata={metadata} />;
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
