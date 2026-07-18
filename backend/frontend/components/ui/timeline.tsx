import type { ReactNode } from "react";
import { Check, Circle, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineState = "complete" | "active" | "pending" | "failed";

export function Timeline({ children, label }: { children: ReactNode; label: string }) {
  return <ol aria-label={label} className="relative before:absolute before:bottom-5 before:left-[5px] before:top-5 before:w-px before:bg-border-subtle">{children}</ol>;
}

export function TimelineItem({ state, title, metadata }: { state: TimelineState; title: string; metadata?: ReactNode }) {
  const Icon = state === "complete" ? Check : state === "active" ? LoaderCircle : state === "failed" ? X : Circle;
  return <li className="relative flex min-h-10 items-center gap-3 pl-[22px]"><span className={cn("absolute left-0 z-10 grid size-2.5 place-items-center rounded-full bg-panel", state === "complete" && "text-success", state === "active" && "text-info", state === "failed" && "text-danger", state === "pending" && "text-muted-foreground")}><Icon className={cn("size-2.5", state === "active" && "animate-spin motion-reduce:animate-none")} /></span><span className={cn("type-compact", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{title}</span>{metadata ? <span className="ml-auto type-metadata text-muted-foreground">{metadata}</span> : null}</li>;
}
