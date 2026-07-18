"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { clamp } from "@/lib/utils";
import { useIndexingProgress } from "@/hooks/use-indexing-progress";
import type { IndexingStage } from "@/types/api";

const stages: Array<{ id: IndexingStage; label: string }> = [
  { id: "queued", label: "Queued" }, { id: "cloning", label: "Cloning" }, { id: "parsing", label: "Parsing" },
  { id: "chunking", label: "Chunking" }, { id: "embedding", label: "Embedding" }, { id: "uploading_vectors", label: "Uploading vectors" },
  { id: "finalizing", label: "Finalizing" }, { id: "completed", label: "Completed" },
];

export function IndexingProgressView({ owner, repo, jobId }: { owner: string; repo: string; jobId?: string }) {
  const router = useRouter();
  const { progress, connected, disconnected, reconnecting, streamError, retry } = useIndexingProgress(`${owner}/${repo}`);
  const current = progress?.stage ?? "queued";
  const failed = current === "failed";
  const lastStage = useRef<IndexingStage>("queued");
  if (!failed) lastStage.current = current;
  const timelineStage = failed ? lastStage.current : current;
  const currentIndex = stages.findIndex((stage) => stage.id === timelineStage);
  const connectionLabel = connected ? "Live" : reconnecting ? "Reconnecting" : disconnected ? "Disconnected" : "Connecting";
  const connectionTone = connected ? "success" : reconnecting ? "warning" : disconnected ? "danger" : "info";
  const announcedStage = failed ? "Failed" : stages.find((stage) => stage.id === current)?.label ?? current;

  useEffect(() => {
    if (current !== "completed") return;
    const timer = window.setTimeout(() => router.replace(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`), 900);
    return () => window.clearTimeout(timer);
  }, [current, owner, repo, router]);

  return (
    <div className="layout-editorial layout-gutter py-10 max-[820px]:py-8">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Indexing {announcedStage}, {Math.round(clamp(progress?.percentage ?? 0))} percent. {progress?.message ?? "Indexing job queued."}</p>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge label={connectionLabel} tone={connectionTone} />{disconnected ? <span className="flex items-center gap-1.5 type-compact text-warning"><WifiOff className="size-3.5" />{reconnecting ? "Reconnecting automatically" : "Progress stream disconnected"}</span> : null}</div>
      <h1 className="mt-5 break-words type-page-title">Indexing <span className="italic text-primary">{owner}/{repo}</span><span className="not-italic">.</span></h1>
      <p className="mt-2 type-body text-text-secondary">Building repository intelligence. You can safely leave this screen and return.</p>
      <Panel className="mt-7 overflow-hidden border border-border-subtle p-0">
        <div className="border-b border-border-subtle p-6"><div className="flex items-end justify-between gap-4"><div><p className="type-body-strong">{failed ? "Indexing failed" : progress?.message ?? "Indexing job queued."}</p><p className="mt-1 type-metadata text-muted-foreground">JOB {jobId ?? progress?.jobId ?? "PENDING"}</p>{progress?.timestamp ? <p className="mt-1 type-metadata text-muted-foreground">UPDATED {new Date(progress.timestamp).toLocaleTimeString()}</p> : null}</div><span className="type-mono-strong tabular-nums">{Math.round(clamp(progress?.percentage ?? 0))}%</span></div><Progress className="mt-4" value={progress?.percentage ?? 0} tone={failed ? "danger" : current === "completed" ? "success" : "info"} /></div>
        <div className="p-6"><Timeline label="Indexing stages">
          {stages.map((stage, index) => {
            const complete = current === "completed" || index < currentIndex;
            const active = index === currentIndex && !failed;
            const stageFailed = failed && index === currentIndex;
            return <TimelineItem key={stage.id} state={stageFailed ? "failed" : complete ? "complete" : active ? "active" : "pending"} title={stage.label} metadata={stageFailed ? "Failed" : complete ? "Complete" : active ? "In progress" : "Pending"} />;
          })}
        </Timeline></div>
      </Panel>
      {streamError && !reconnecting && !failed ? <div className="mt-4"><ErrorState error={streamError} retry={retry} compact /></div> : null}
      {failed ? <InlineAlert tone="danger" className="mt-4"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="type-compact-strong text-danger">{progress?.message ?? "Indexing could not be completed."}</p><p className="mt-1">Return to repository connection to retry through the supported workflow.</p></div><Button variant="secondary" size="sm" onClick={() => router.push("/repositories/connect")}><RefreshCcw className="size-3.5" />Retry</Button></div></InlineAlert> : null}
    </div>
  );
}
