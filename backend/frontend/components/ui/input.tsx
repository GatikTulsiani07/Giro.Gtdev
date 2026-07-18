import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn("h-10 w-full rounded-control border border-border bg-interactive px-2.5 type-compact text-foreground outline-none transition-colors duration-[150ms] placeholder:text-muted-foreground focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-text-disabled disabled:opacity-60 max-[820px]:h-11", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";
