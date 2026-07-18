import type { ReactNode } from "react";
import { AlertTriangle, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const styles = {
  info: { icon: Info, className: "border-info bg-info/5 text-info" },
  warning: { icon: AlertTriangle, className: "border-warning bg-warning/5 text-warning" },
  danger: { icon: AlertTriangle, className: "border-danger bg-danger/5 text-danger" },
  success: { icon: CircleCheck, className: "border-success bg-success/5 text-success" },
};

export function InlineAlert({ tone, children, className }: { tone: keyof typeof styles; children: ReactNode; className?: string }) {
  const item = styles[tone];
  const Icon = item.icon;
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-control border-0 border-l-2 p-4 type-compact", item.className, className)}><Icon className="mt-0.5 size-4 shrink-0" /> <div className="text-text-secondary">{children}</div></div>;
}
