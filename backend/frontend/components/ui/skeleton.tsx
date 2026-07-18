import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton-delayed relative overflow-hidden rounded-control bg-inset before:absolute before:inset-y-0 before:left-0 before:w-1/3 before:-translate-x-full before:animate-shimmer before:bg-foreground/[0.04] motion-reduce:before:hidden", className)} {...props} />;
}
