import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Status variants pair a color with a text label by design — DESIGN.md's
 * positive/negative hues never carry meaning on their own.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        positive: "border-terminal-positive/40 bg-terminal-positive/10 text-terminal-positive",
        negative: "border-terminal-negative/40 bg-terminal-negative/10 text-terminal-negative",
        accent: "border-terminal-accent/40 bg-terminal-accent/10 text-terminal-accent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
