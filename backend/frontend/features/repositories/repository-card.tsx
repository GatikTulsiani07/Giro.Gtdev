import Link from "next/link";
import { ArrowUpRight, Braces, FileCode2, GitFork, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { IndexedRepository } from "@/types/api";

export function RepositoryCard({ repository }: { repository: IndexedRepository }) {
  return (
    <Card className="group p-5 transition-colors hover:border-foreground/20 motion-reduce:transition-none">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="text-xs text-muted-foreground">{repository.owner}</p><h3 className="mt-1 truncate text-base font-medium">{repository.repo}</h3></div>
        <Badge className="border-primary/30 bg-primary/10 text-primary">{repository.status}</Badge>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><FileCode2 className="size-3" />{repository.fileCount.toLocaleString()} files</span>
        <span className="flex items-center gap-1.5"><Braces className="size-3" />{repository.symbolCount.toLocaleString()} symbols</span>
        <span className="flex items-center gap-1.5"><GitFork className="size-3" />{repository.graphEdgeCount.toLocaleString()} edges</span>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="text-[11px] text-muted-foreground">Indexed {formatDate(repository.indexedAt)}</span>
        <div className="flex gap-1">
          <Link aria-label={`Open ${repository.repo}`} href={`/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`} className="rounded p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-ring"><ArrowUpRight className="size-4" /></Link>
          <Link aria-label={`View sessions for ${repository.repo}`} href={`/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`} className="rounded p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-ring"><MessageSquareText className="size-4" /></Link>
        </div>
      </div>
    </Card>
  );
}
