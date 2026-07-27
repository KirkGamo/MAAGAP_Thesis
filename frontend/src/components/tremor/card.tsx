// Tremor Card [v1.0.0]
// Sourced verbatim from https://www.tremor.so/docs/ui/card (Tremor Raw --
// the actively-maintained, Tailwind-v4-compatible iteration of Tremor;
// the older @tremor/react npm package does not support Tailwind v4 as of
// this writing -- see docs/MODEL_IMPROVEMENT_STRATEGY.md-adjacent Phase 10
// notes / this branch's commit message for the compatibility research).
// Only the import path for `cx` was adjusted to this project's existing
// lib/utils.ts (`cn`), so this doesn't duplicate a second class-merge
// utility alongside the one already used by src/components/ui/*.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn as cx } from "@/lib/utils";

export interface CardProps extends React.ComponentPropsWithoutRef<"div"> {
  asChild?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, asChild, ...props }, forwardedRef) => {
    const Component = asChild ? Slot : "div";
    return (
      <Component
        ref={forwardedRef}
        className={cx(
          // base
          "relative w-full rounded-lg border p-6 text-left shadow-xs",
          // background color
          "bg-white",
          // border color
          "border-brand-navy/10",
          className
        )}
        tremor-id="tremor-raw"
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

export { Card };
