import { cn, clamp } from "@/lib/utils";

export function Progress({ value, tone = "info", className }: { value: number; tone?: "info" | "success" | "danger"; className?: string }) {
  const safeValue = clamp(value);
  return (
    <div className={cn("h-2 overflow-hidden rounded-badge bg-muted", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safeValue)}>
      <div className={cn("h-full rounded-badge transition-[width] duration-[150ms] ease-out motion-reduce:transition-none", tone === "success" ? "bg-success" : tone === "danger" ? "bg-danger" : "bg-info")} style={{ width: `${safeValue}%` }} />
    </div>
  );
}
