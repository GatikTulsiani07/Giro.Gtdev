import { BarChart3, Braces, Database, GitFork, Layers3, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { HybridRetrievalResult } from "@/types/api";

export function RetrievalInspector({ retrieval, loading, error }: { retrieval: HybridRetrievalResult | null; loading: boolean; error: string | null }) {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel" aria-label="Retrieval inspector">
      <div className="border-b border-border p-4"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-primary" /><h2 className="text-sm font-medium">Retrieval inspector</h2></div><p className="mt-1 text-xs text-muted-foreground">Public hybrid retrieval metadata</p></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? <div className="space-y-2">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-md bg-foreground/[0.04] motion-reduce:animate-none" />)}</div> : null}
        {error ? <div role="alert" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">The answer can still complete, but retrieval diagnostics were unavailable: {error}</div> : null}
        {!loading && !error && !retrieval ? <EmptyState icon={SearchX} title="No retrieval run yet" description="Ask a question to inspect ranking signals and retrieved chunks." /> : null}
        {retrieval ? <div className="space-y-2">{retrieval.results.map((result, index) => {
          const citation = retrieval.citations?.find((item) => item.relativeFilePath === result.filePath || result.filePath.endsWith(item.relativeFilePath));
          return <article key={`${result.chunkId ?? result.filePath}-${result.startLine}`} className="rounded-md border border-border bg-background/25 p-3"><div className="flex items-start gap-2"><span className="grid size-6 shrink-0 place-items-center rounded bg-primary/10 font-mono text-[10px] text-primary">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate font-mono text-[11px]">{result.filePath}</p><p className="mt-1 text-[10px] text-muted-foreground">L{result.startLine}–{result.endLine} · {result.language}</p></div><span className="font-mono text-xs">{result.score.toFixed(3)}</span></div><div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground"><Signal icon={Database} label="Semantic" value={result.signals.semantic} /><Signal icon={Layers3} label="Keyword" value={result.signals.keyword} /><Signal icon={Braces} label="Symbol" value={result.signals.symbol} /><Signal icon={GitFork} label="Graph" value={result.signals.graph} /></div><div className="mt-3 flex flex-wrap gap-1"><Badge className="text-muted-foreground">source {result.source}</Badge>{citation ? <Badge className="max-w-full truncate text-muted-foreground">version {citation.repositoryVersion}</Badge> : null}<Badge className="text-muted-foreground">stitched: not exposed</Badge><Badge className="text-muted-foreground">expanded: not exposed</Badge></div></article>;
        })}</div> : null}
      </div>
      {retrieval ? <div className="border-t border-border p-3"><div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground"><span>Returned</span><span className="text-right font-mono text-foreground">{retrieval.stats.returned}</span><span>Semantic</span><span className="text-right font-mono text-foreground">{retrieval.stats.semanticResults}</span><span>Keyword</span><span className="text-right font-mono text-foreground">{retrieval.stats.keywordResults}</span><span>Graph boosted</span><span className="text-right font-mono text-foreground">{retrieval.stats.graphBoosted}</span></div></div> : null}
    </aside>
  );
}

function Signal({ icon: Icon, label, value }: { icon: typeof Database; label: string; value?: number }) { return <span className="flex items-center gap-1 rounded bg-foreground/[0.03] px-1.5 py-1"><Icon className="size-2.5" />{label}<span className="ml-auto font-mono text-foreground">{value === undefined ? "—" : value.toFixed(2)}</span></span>; }
