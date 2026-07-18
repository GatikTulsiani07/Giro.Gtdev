import Link from "next/link";
import { ArrowUpRight, Braces, FileCode2, GitFork } from "lucide-react";
import { RepositoryStatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import type { IndexedRepository } from "@/types/api";

export function RepositoryCard({ repository }: { repository: IndexedRepository }) {
  return (
    <article className="group flex min-h-20 items-center gap-4 px-3 py-3 transition-colors duration-[150ms] hover:bg-hover motion-reduce:transition-none max-[820px]:items-start">
      <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="type-metadata text-muted-foreground">{repository.owner}</p><h3 className="mt-1 truncate type-panel-title">{repository.repo}</h3></div>
        <RepositoryStatusBadge status={repository.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 type-metadata text-muted-foreground">
        <span className="flex items-center gap-1.5"><FileCode2 className="size-3" />{repository.fileCount.toLocaleString()} files</span>
        <span className="flex items-center gap-1.5"><Braces className="size-3" />{repository.symbolCount.toLocaleString()} symbols</span>
        <span className="flex items-center gap-1.5"><GitFork className="size-3" />{repository.graphEdgeCount.toLocaleString()} edges</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="type-metadata text-muted-foreground">Indexed {formatDate(repository.indexedAt)}</span>
      </div>
      </div>
      <Link aria-label={`Open ${repository.repo}`} href={`/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`} className="grid size-8 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground focus-ring max-[820px]:size-11"><ArrowUpRight className="size-4" /></Link>
    </article>
  );
}
