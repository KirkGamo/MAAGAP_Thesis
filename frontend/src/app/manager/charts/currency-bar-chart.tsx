"use client";

import { BarChart } from "@/components/tremor/bar-chart";
import type { AvailableChartColorsKeys } from "@/components/tremor/chart-utils";

/**
 * Client-side BarChart shell for peso-valued charts (see
 * count-bar-chart.tsx for why formatters live in a "use client" module
 * rather than being passed from the Server Component page). Compact
 * notation ("₱12.4M") keeps the axis ticks readable at municipal budget
 * magnitudes -- exact figures remain visible in the tooltip via the same
 * formatter.
 */

const phpCompact = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatPhp = (value: number) => phpCompact.format(value);

export interface CurrencyBarChartProps {
  data: Record<string, string | number>[];
  index: string;
  categories: string[];
  colors: AvailableChartColorsKeys[];
  layout?: "vertical" | "horizontal";
  showLegend?: boolean;
  yAxisWidth?: number;
  className?: string;
}

export function CurrencyBarChart({
  data,
  index,
  categories,
  colors,
  layout = "horizontal",
  showLegend = true,
  yAxisWidth = 56,
  className,
}: CurrencyBarChartProps) {
  return (
    <BarChart
      className={className}
      data={data}
      index={index}
      categories={categories}
      colors={colors}
      layout={layout}
      showLegend={showLegend}
      yAxisWidth={yAxisWidth}
      valueFormatter={formatPhp}
    />
  );
}
