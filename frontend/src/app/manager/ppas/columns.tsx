"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MapPin } from "lucide-react";
import { Badge, riskTierVariant, statusVariant } from "@/components/ui/badge";
import { MarqueeText } from "./marquee-text";

/** One row of the PPAs table -- mirrors exactly the fields page.tsx selects
 * from `projects` (see its `.select(...)` call). Kept as its own type here
 * rather than importing the full Database["projects"]["Row"] shape, since
 * this table only ever renders this subset of columns. */
export interface PpaRow {
  id: string;
  project_key: string;
  name_of_project: string;
  municipality: string | null;
  status: string | null;
  risk_tier: string | null;
  risk_probability: number | null;
  amount_php: number | null;
  project_type: string | null;
  date_last_monitored: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  not_yet_implemented: "Not Yet Implemented",
  for_bidding: "For Bidding",
  on_going: "On-going",
  completed: "Completed",
  refunded: "Refunded",
};

/**
 * Phase 13: column definitions for the PPAs tab's TanStack Table
 * DataTable (see data-table.tsx). Column *headers* here are plain text --
 * this table doesn't wire up interactive header-click sorting, unlike the
 * typical shadcn DataTable recipe. That's deliberate, not an oversight:
 * the underlying data is paginated server-side (only the current 50-row
 * page ever reaches the browser), so a client-side sort here could only
 * ever reorder the 50 rows already on screen -- it would look like "sort
 * by risk tier" but silently ignore the other ~3,950 rows, which is worse
 * than no sort control at all. The table is already ordered by
 * risk_probability descending at the query level (see page.tsx), which is
 * the ordering that actually matters for this dashboard's purpose.
 */
export const ppaColumns: ColumnDef<PpaRow>[] = [
  {
    accessorKey: "name_of_project",
    header: "Project",
    // Phase 16: the one column the Toggle Columns control (data-table.tsx)
    // can't hide -- with every other column hidden this is still enough to
    // identify a row and follow its link.
    enableHiding: false,
    // Phase 21: fixed width (w-56) so this column stops changing width
    // row-to-row with project-name length -- long names are clipped, with
    // MarqueeText revealing the full name on hover instead of a plain
    // permanent ellipsis.
    cell: ({ row }) => (
      <div className="flex w-56 items-center gap-2.5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-xs font-semibold text-brand-navy"
          aria-hidden="true"
        >
          {row.original.name_of_project.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/manager/ppas/${row.original.id}`} className="block hover:underline">
            <MarqueeText text={row.original.name_of_project} className="font-medium text-slate-900" />
          </Link>
          <div className="truncate text-xs text-slate-400">{row.original.project_key}</div>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "municipality",
    header: "Municipality",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 text-slate-600">
        <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        {row.original.municipality ?? "—"}
      </span>
    ),
  },
  // Phase 22: Budget and Project Type were already filterable (see
  // filters.ts / ppa-filter-sidebar.tsx) but weren't visible as columns --
  // a Manager filtering by either had no way to actually see the value
  // that matched. amount_php/project_type were added to page.tsx's
  // `.select(...)` alongside this. Also per explicit request, swapped into
  // Status's and Risk Tier's old positions (Status/Risk Tier moved to
  // where these used to sit, at the end).
  {
    accessorKey: "amount_php",
    header: "Budget",
    cell: ({ row }) =>
      row.original.amount_php != null ? (
        <span className="tabular-nums text-slate-700">
          ₱{row.original.amount_php.toLocaleString()}
        </span>
      ) : (
        "—"
      ),
  },
  {
    accessorKey: "project_type",
    header: "Project Type",
    cell: ({ row }) =>
      row.original.project_type ? (
        <span className="text-slate-600">{row.original.project_type}</span>
      ) : (
        <span className="text-slate-400">Unclassified</span>
      ),
  },
  {
    accessorKey: "risk_probability",
    header: "P(RedFlag)",
    cell: ({ row }) =>
      row.original.risk_probability != null
        ? `${(row.original.risk_probability * 100).toFixed(1)}%`
        : "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) =>
      row.original.status ? (
        <Badge variant={statusVariant(row.original.status)}>
          {STATUS_LABELS[row.original.status] ?? row.original.status}
        </Badge>
      ) : (
        "—"
      ),
  },
  {
    // Most recent DATE MONITORED from the source monitoring sheet (see
    // add_projects_date_last_monitored.sql / seed_supabase.py's
    // build_project_rows()) -- distinct from monitoring_reports.visited_at,
    // which only tracks NEW reports filed through this app.
    accessorKey: "date_last_monitored",
    header: "Last Monitored",
    cell: ({ row }) =>
      row.original.date_last_monitored ? (
        <span className="text-slate-600">
          {new Date(row.original.date_last_monitored).toLocaleDateString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      ),
  },
  {
    accessorKey: "risk_tier",
    header: "Risk Tier",
    cell: ({ row }) =>
      row.original.risk_tier ? (
        <Badge variant={riskTierVariant(row.original.risk_tier)}>{row.original.risk_tier}</Badge>
      ) : (
        <span className="text-slate-400">Unscored</span>
      ),
  },
];
