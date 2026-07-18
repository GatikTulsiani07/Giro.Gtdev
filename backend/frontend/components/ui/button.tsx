import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control type-compact-strong transition-[color,background-color,border-color,opacity] duration-[150ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px active:duration-[100ms] disabled:pointer-events-none disabled:text-text-disabled disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none max-[820px]:min-h-11",
  {
    variants: {
      variant: {
        default: "border border-foreground bg-foreground px-3 text-background hover:bg-foreground/90",
        accent: "border border-accent bg-primary px-3 text-primary-foreground hover:bg-accent-hover",
        secondary: "border border-border bg-interactive px-3 text-foreground hover:bg-hover",
        ghost: "px-3 text-text-secondary hover:bg-hover hover:text-foreground",
        destructive: "border border-danger bg-danger px-3 text-primary-foreground hover:bg-danger/85",
      },
      size: { default: "h-10", sm: "h-8 px-3", lg: "h-12 px-4", icon: "size-10 p-0 max-[820px]:size-11", "icon-sm": "size-8 p-0 max-[820px]:size-11" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
