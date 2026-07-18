import { AlertTriangle, Check, Circle, Info, X } from "lucide-react";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export type CanonicalRepositoryStatus = "Disconnected" | "Queued" | "Indexing" | "Partial" | "Ready" | "Stale" | "Failed";

const toneStyles: Record<StatusTone, string> = {
  neutral: "bg-inset text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
};

const icons = { neutral: Circle, success: Check, warning: AlertTriangle, danger: X, info: Info };

export function StatusBadge({ label, tone = "neutral", className }: { label: string; tone?: StatusTone; className?: string }) {
  const Icon = icons[tone];
  return <Badge className={cn("capitalize", toneStyles[tone], className)}><Icon className="size-3" aria-hidden="true" />{label}</Badge>;
}

const repositoryStatuses: Record<string, { label: CanonicalRepositoryStatus; tone: StatusTone; ready: boolean }> = {
  disconnected: { label: "Disconnected", tone: "danger", ready: false },
  queued: { label: "Queued", tone: "info", ready: false },
  indexing: { label: "Indexing", tone: "info", ready: false },
  partial: { label: "Partial", tone: "warning", ready: false },
  indexed: { label: "Ready", tone: "success", ready: true },
  ready: { label: "Ready", tone: "success", ready: true },
  stale: { label: "Stale", tone: "warning", ready: false },
  failed: { label: "Failed", tone: "danger", ready: false },
};

export function getRepositoryStatus(status?: string | null) {
  return repositoryStatuses[status?.toLowerCase() ?? ""] ?? { label: "Disconnected" as const, tone: "danger" as const, ready: false };
}

export function RepositoryStatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const presentation = getRepositoryStatus(status);
  return <StatusBadge label={presentation.label} tone={presentation.tone} className={className} />;
}
