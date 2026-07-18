import { AlertTriangle, Check, CircleMinus, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConfidenceLevel, RetrievalConfidence } from "@/types/api";

const styles: Record<ConfidenceLevel, string> = {
  high: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  low: "bg-danger/10 text-danger",
  insufficient: "bg-inset text-text-secondary",
};
const icons = { high: Check, medium: Info, low: AlertTriangle, insufficient: CircleMinus };
const explanations: Record<ConfidenceLevel, string> = {
  high: "Repository evidence supports this answer.",
  medium: "Repository evidence supports the answer with qualifications.",
  low: "Repository evidence is limited; verify the cited files.",
  insufficient: "Repository evidence is insufficient for a reliable answer.",
};

export function ConfidenceBadge({ confidence, compact = false }: { confidence: RetrievalConfidence; compact?: boolean }) {
  const Icon = icons[confidence.level];
  return <div><div className="flex flex-wrap items-center gap-2"><Badge className={cn("capitalize", styles[confidence.level])}><Icon className="size-3" aria-hidden="true" />{confidence.level}</Badge><span className="type-metadata text-muted-foreground">{Math.round(confidence.score * 100)}%</span>{!compact ? <span className="type-compact text-text-secondary">{explanations[confidence.level]}</span> : null}</div>{!compact && confidence.reasons.length ? <details className="mt-2"><summary className="w-fit cursor-pointer rounded-control type-metadata text-muted-foreground focus-ring">WHY THIS CONFIDENCE</summary><ul className="mt-2 space-y-1 pl-4 type-compact text-text-secondary">{confidence.reasons.map((reason) => <li key={reason}>{reason.replaceAll("_", " ")}</li>)}</ul></details> : null}</div>;
}
