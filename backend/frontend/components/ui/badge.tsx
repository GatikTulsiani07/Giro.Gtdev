import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex min-h-[18px] items-center gap-1 rounded-badge bg-inset px-1.5 type-metadata text-muted-foreground", className)} {...props} />;
}
