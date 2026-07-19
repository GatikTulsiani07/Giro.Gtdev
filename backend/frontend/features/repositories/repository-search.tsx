"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SearchInput } from "@/components/ui/form-controls";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadingState } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import {
  filterIndexedEvidence,
  indexedEvidenceResultKey,
  normalizeEvidenceFilter,
  RepositorySearchResults,
  repositoryIntelligenceResultKey,
  type EvidenceFilter,
} from "@/features/repositories/repository-search-results";
import { MAX_REPOSITORY_SEARCH_QUERY_LENGTH, useRepositorySearch } from "@/hooks/use-repository-search";
import { repositoryKeys } from "@/hooks/use-repositories";
import { extractRepositorySearchCategories, type RepositoryExplorerItem } from "@/lib/repository-explorer";
import type { RepositorySummary, RetrievalResult } from "@/types/api";

const SEARCH_EXAMPLES = [
  "authentication flow",
  "database access",
  "API routes",
  "entry points",
  "error handling",
  "background jobs",
] as const;

export function RepositorySearch({ owner, repo }: { owner: string; repo: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const submittedQuery = searchParams.get("q") ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(submittedQuery);
  const search = useRepositorySearch(owner, repo, submittedQuery);
  const repositoryPath = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const cachedSummary = queryClient.getQueryData<{ summary: RepositorySummary }>(repositoryKeys.summary(owner, repo))?.summary;
  const intelligence = extractRepositorySearchCategories(cachedSummary, search.query);
  const evidenceFilter = normalizeEvidenceFilter(searchParams.get("kind"));
  const evidence = filterIndexedEvidence(search.data?.results ?? [], evidenceFilter);

  useEffect(() => setDraft(submittedQuery), [submittedQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    const normalizedDraft = draft.trim();
    if (normalizedDraft) nextSearchParams.set("q", normalizedDraft);
    else nextSearchParams.delete("q");
    nextSearchParams.delete("result");
    const suffix = nextSearchParams.toString();
    router.push(`${repositoryPath}/search${suffix ? `?${suffix}` : ""}`, { scroll: false });
  }

  function updateResult(result: string) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("result", result);
    router.push(`${repositoryPath}/search?${nextSearchParams.toString()}`, { scroll: false });
  }

  function updateFilter(filter: EvidenceFilter) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("kind", filter);
    nextSearchParams.delete("result");
    router.push(`${repositoryPath}/search?${nextSearchParams.toString()}`, { scroll: false });
  }

  function selectIntelligence(item: RepositoryExplorerItem) {
    updateResult(repositoryIntelligenceResultKey(item));
  }

  function selectEvidence(item: RetrievalResult) {
    updateResult(indexedEvidenceResultKey(item));
  }

  function selectExample(example: string) {
    setDraft(example);
    inputRef.current?.focus();
  }

  const reconnect = search.repositoryStatus.label === "Failed" || search.repositoryStatus.label === "Disconnected";
  const readinessHref = reconnect ? "/repositories/connect" : `${repositoryPath}/indexing`;
  const readinessAction = reconnect ? "Connect repository" : "View indexing";

  return (
    <div className="layout-standard layout-gutter py-10 max-[820px]:py-8">
      <header className="border-b border-border-subtle pb-7">
        <p className="type-section-eyebrow text-muted-foreground">Repository search · {owner}/{repo}</p>
        <h1 className="mt-2 type-page-title">Search <span className="italic text-primary">repository</span><span className="not-italic">.</span></h1>
        <p className="mt-2 max-w-[68ch] type-body text-text-secondary">Search indexed code, symbols, paths, and repository concepts without creating a chat session or generating an answer.</p>
        {submittedQuery ? <div className="mt-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"><span className="type-metadata-label text-muted-foreground">Current query</span><span className="min-w-0 break-words type-mono text-foreground">{submittedQuery}</span></div> : null}
      </header>

      <form onSubmit={submit} className="mt-7 flex max-w-[680px] items-start gap-2">
        <label htmlFor="repository-search-query" className="sr-only">Search repository</label>
        <div className="min-w-0 flex-1"><SearchInput
            ref={inputRef}
            id="repository-search-query"
            name="q"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onClear={() => setDraft("")}
            maxLength={MAX_REPOSITORY_SEARCH_QUERY_LENGTH}
            placeholder="Search repository context…"
          /></div>
        <Button type="submit" variant="accent"><Search className="size-4" />Search</Button>
      </form>

      {!submittedQuery ? <section aria-labelledby="search-examples-heading" className="mt-5 max-w-[680px]"><h2 id="search-examples-heading" className="type-metadata-label text-muted-foreground">Example queries</h2><div className="mt-2 flex flex-wrap gap-2">{SEARCH_EXAMPLES.map((example) => <Button key={example} type="button" variant="secondary" size="sm" onClick={() => selectExample(example)}>{example}</Button>)}</div></section> : null}

      <div className="mt-7">
        {search.checkingReadiness ? <LoadingState label="Checking repository readiness…" /> : null}
        {!search.checkingReadiness && search.error ? <section aria-labelledby="search-error-heading" className="max-w-[760px]"><p className="type-section-eyebrow text-muted-foreground">Search interrupted</p><h2 id="search-error-heading" className="mt-2 type-section-title">Repository search unavailable</h2><p className="mt-2 type-compact text-text-secondary">Your query is preserved. Retry the request or refine it in the search field above.</p><div className="mt-4"><ErrorState error={search.error} retry={search.retry ? () => void search.retry?.() : undefined} /></div></section> : null}
        {!search.checkingReadiness && !search.error && !search.ready ? <InlineAlert tone={search.repositoryStatus.label === "Failed" ? "danger" : "warning"}><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="type-compact-strong">{search.repositoryStatus.label} repository</p><p className="mt-1">{search.repositoryStatus.label === "Failed" ? "Indexing failed. Reconnect the repository before searching." : search.repositoryStatus.label === "Stale" ? "Repository evidence is stale. Reindex before searching." : "Repository intelligence must be ready before searching."}</p></div><Button asChild variant="secondary" size="sm"><Link href={readinessHref}>{readinessAction}<ArrowRight className="size-3.5" /></Link></Button></div></InlineAlert> : null}
        {!search.checkingReadiness && search.ready && search.loading ? <RepositorySearchSkeleton owner={owner} repo={repo} /> : null}
        {!search.checkingReadiness && search.ready && search.success ? <RepositorySearchResults owner={owner} repo={repo} query={search.query} intelligence={intelligence} evidence={evidence} selectedResult={searchParams.get("result")} filter={evidenceFilter} restoreFocus={Boolean(searchParams.get("result"))} onSelectIntelligence={selectIntelligence} onSelectEvidence={selectEvidence} onFilterChange={updateFilter} onReturnToSearch={() => inputRef.current?.focus()} /> : null}
        {!search.checkingReadiness && search.ready && search.idle && !search.query ? <div className="max-w-[680px] border-y border-border-subtle"><EmptyState compact icon={Search} title="Ready to search this repository" description="Choose an example or enter a technical concept, file, or symbol name. Results remain grounded in indexed repository evidence." /></div> : null}
      </div>
    </div>
  );
}

function RepositorySearchSkeleton({ owner, repo }: { owner: string; repo: string }) {
  return <section role="status" aria-live="polite" aria-label={`Searching ${owner}/${repo}`}><div className="flex items-end justify-between gap-4"><div><Skeleton className="h-6 w-44" /><Skeleton className="mt-2 h-4 w-64 max-w-full" /></div><Skeleton className="h-8 w-48" /></div><div className="mt-5 grid gap-7 laptop:grid-cols-[minmax(0,1fr)_360px]"><div className="border-y border-border-subtle">{Array.from({ length: 4 }, (_, index) => <div key={index} className="border-b border-border-subtle px-3 py-3 last:border-b-0"><div className="flex items-center justify-between gap-4"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-12" /></div><Skeleton className="mt-2 h-3 w-1/3" /><Skeleton className="mt-3 h-9 w-full" /></div>)}</div><div className="hidden laptop:block"><Skeleton className="h-72 w-full" /></div></div></section>;
}
