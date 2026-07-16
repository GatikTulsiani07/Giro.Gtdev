import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConfidenceLevel, RetrievalConfidence } from "@/types/api";

const styles: Record<ConfidenceLevel, string> = {
  high: "border-primary/40 bg-primary/10 text-primary",
  medium: "border-lime-700/40 bg-lime-900/15 text-lime-300",
  low: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  insufficient: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function ConfidenceBadge({ confidence, compact = false }: { confidence: RetrievalConfidence; compact?: boolean }) {
  return (
    <div className={compact ? "" : "rounded-md border border-border bg-background/25 p-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("capitalize", styles[confidence.level])}>{confidence.level}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{Math.round(confidence.score * 100)}%</span>
        {!compact ? <span className="text-xs text-muted-foreground">{confidence.answerable ? "Evidence supports an answer" : "Insufficient evidence"}</span> : null}
      </div>
      {!compact && confidence.reasons.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Confidence reasons">{confidence.reasons.map((reason) => <span key={reason} className="rounded bg-foreground/[0.04] px-2 py-1 font-mono text-[10px] text-muted-foreground">{reason.replaceAll("_", " ")}</span>)}</div> : null}
    </div>
  );
}
