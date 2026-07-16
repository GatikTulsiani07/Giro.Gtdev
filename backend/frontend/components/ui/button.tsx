import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "border border-primary/40 bg-primary px-4 text-primary-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)] hover:bg-primary/85",
        secondary: "border border-border bg-muted px-4 text-foreground hover:bg-foreground/10",
        ghost: "px-3 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        destructive: "bg-red-500/10 px-4 text-red-300 hover:bg-red-500/20",
      },
      size: { default: "h-9", sm: "h-8 px-3 text-xs", icon: "size-9 p-0" },
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
