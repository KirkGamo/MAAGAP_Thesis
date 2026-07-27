// Tremor-style Metric text primitive [not an official Tremor Raw
// component -- Tremor Raw's component set (tremor.so/docs) does not ship
// a dedicated <Metric>; the classic @tremor/react npm package did, but
// that package isn't Tailwind-v4-compatible (see Card.tsx's comment).
// This is a small primitive built in the same conventions as Tremor Raw's
// other components (forwardRef, cx-merged className, a `tremor-id`
// marker) so KPI numbers inside a <Card> render consistently with the
// rest of the Tremor Raw components on this page.
import * as React from "react";
import { cn as cx } from "@/lib/utils";

export interface MetricProps extends React.ComponentPropsWithoutRef<"p"> {}

const Metric = React.forwardRef<HTMLParagraphElement, MetricProps>(
  ({ className, ...props }, forwardedRef) => (
    <p
      ref={forwardedRef}
      className={cx("text-3xl font-semibold text-gray-900", className)}
      tremor-id="tremor-raw"
      {...props}
    />
  )
);
Metric.displayName = "Metric";

export interface MetricLabelProps extends React.ComponentPropsWithoutRef<"p"> {}

const MetricLabel = React.forwardRef<HTMLParagraphElement, MetricLabelProps>(
  ({ className, ...props }, forwardedRef) => (
    <p
      ref={forwardedRef}
      className={cx("text-sm text-gray-500", className)}
      tremor-id="tremor-raw"
      {...props}
    />
  )
);
MetricLabel.displayName = "MetricLabel";

export { Metric, MetricLabel };
