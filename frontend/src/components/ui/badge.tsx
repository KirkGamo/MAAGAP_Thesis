import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-slate-900 text-slate-50",
        secondary: "border-transparent bg-slate-100 text-slate-900",
        outline: "text-slate-950",
        // Risk-tier variants (Chapter 3 thresholds: Low/Medium/High/Critical)
        low: "border-transparent bg-emerald-100 text-emerald-800",
        medium: "border-transparent bg-amber-100 text-amber-800",
        high: "border-transparent bg-orange-100 text-orange-800",
        critical: "border-transparent bg-red-100 text-red-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Maps a Chapter 3 risk tier string to the matching Badge variant. */
export function riskTierVariant(
  tier: string
): VariantProps<typeof badgeVariants>["variant"] {
  switch (tier) {
    case "Low":
      return "low";
    case "Medium":
      return "medium";
    case "High":
      return "high";
    case "Critical":
      return "critical";
    default:
      return "secondary";
  }
}

export { Badge, badgeVariants };
