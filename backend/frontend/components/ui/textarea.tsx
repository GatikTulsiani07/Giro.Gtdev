import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn("min-h-24 w-full resize-y rounded-control border border-border bg-interactive px-2.5 py-3 type-compact text-foreground outline-none transition-colors duration-[150ms] placeholder:text-muted-foreground focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-text-disabled disabled:opacity-60 max-[820px]:min-h-11", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
