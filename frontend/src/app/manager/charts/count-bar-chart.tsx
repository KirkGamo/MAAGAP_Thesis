"use client";

import { BarChart } from "@/components/tremor/bar-chart";
import type { AvailableChartColorsKeys } from "@/components/tremor/chart-utils";

/**
 * Thin client-side shell over the vendored Tremor BarChart for
 * count-valued demographic charts. Exists because the Overview page is a
 * Server Component and functions can't cross the server/client boundary
 * as props (the documented Phase 10 constraint that previously forced the
 * risk-by-municipality chart to fall back to BarChart's default
 * formatter) -- the thousands-separator formatter lives HERE, inside the
 * client module, and the page passes only serializable data.
 */

const formatCount = (value: number) => value.toLocaleString();

export interface CountBarChartProps {
  data: Record<string, string | number>[];
  index: string;
  categories: string[];
  colors: AvailableChartColorsKeys[];
  layout?: "vertical" | "horizontal";
  type?: "default" | "stacked" | "percent";
  showLegend?: boolean;
  showYAxis?: boolean;
  yAxisWidth?: number;
  className?: string;
}

export function CountBarChart({
  data,
  index,
  categories,
  colors,
  layout = "horizontal",
  type = "default",
  showLegend = true,
  showYAxis = true,
  yAxisWidth = 40,
  className,
}: CountBarChartProps) {
  return (
    <BarChart
      className={className}
      data={data}
      index={index}
      categories={categories}
      colors={colors}
      layout={layout}
      type={type}
      showLegend={showLegend}
      showYAxis={showYAxis}
      yAxisWidth={yAxisWidth}
      valueFormatter={formatCount}
      allowDecimals={false}
    />
  );
}
