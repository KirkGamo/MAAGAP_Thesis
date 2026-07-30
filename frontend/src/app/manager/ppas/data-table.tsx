"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import { Download, SlidersHorizontal, Check } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PpaSearchBar } from "./ppa-search-bar";
import { PpaControlsToggle } from "./ppa-controls-toggle";

export interface PpaTableParams {
  q?: string;
  risk_tier?: string;
  status?: string;
  project_type?: string;
  municipality?: string;
  revenue_min?: string;
  revenue_max?: string;
  risk_min?: string;
  risk_max?: string;
  view?: string;
  controls?: string;
}

interface PpasDataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  params: PpaTableParams;
  exportHref: string;
}

const COLUMN_VISIBILITY_STORAGE_KEY = "maagap-ppa-column-visibility";

/** Rebuilds the same "rewrite the URL, only change `page`" href every other
 * PPAs control uses (ppa-filter-sidebar.tsx, view-toggle.tsx) -- duplicated
 * here rather than passed down as a prop function from the Server Component
 * page, since Server -> Client Component props can't carry functions (see
 * Phase 10's fix for the same class of error on BarChart's valueFormatter). */
function buildHref(params: PpaTableParams, targetPage: number): string {
  const next = new URLSearchParams();
  if (params.q) next.set("q", params.q);
  if (params.risk_tier) next.set("risk_tier", params.risk_tier);
  if (params.status) next.set("status", params.status);
  if (params.project_type) next.set("project_type", params.project_type);
  if (params.municipality) next.set("municipality", params.municipality);
  if (params.revenue_min) next.set("revenue_min", params.revenue_min);
  if (params.revenue_max) next.set("revenue_max", params.revenue_max);
  if (params.risk_min) next.set("risk_min", params.risk_min);
  if (params.risk_max) next.set("risk_max", params.risk_max);
  if (params.view) next.set("view", params.view);
  if (params.controls) next.set("controls", params.controls);
  if (targetPage > 1) next.set("page", String(targetPage));
  const qs = next.toString();
  return qs ? `/manager/ppas?${qs}` : "/manager/ppas";
}

/** Windowed page-number list (1 … 4 5 [6] 7 8 … 81), matching the reference
 * dashboard's numbered pagination instead of a bare "Page X of Y" label --
 * with ~81 pages at 50 rows/page over 4,039 projects, showing every page
 * number would be unusable, so this always keeps the first, last, and a
 * small window around the current page, collapsing the rest into "…". */
function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 1) return [1];
  const delta = 1;
  const pages: (number | "ellipsis")[] = [1];
  const rangeStart = Math.max(2, current - delta);
  const rangeEnd = Math.min(total - 1, current + delta);

  if (rangeStart > 2) pages.push("ellipsis");
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (rangeEnd < total - 1) pages.push("ellipsis");
  if (total > 1) pages.push(total);

  return pages;
}

/**
 * Phase 13: the shadcn/ui "DataTable" pattern (TanStack Table for column
 * definitions + rendering) applied to the PPAs tab, replacing a hand-rolled
 * <Table> that mapped `projects` directly. Pagination stays server-driven
 * (`manualPagination: true`, `pageCount` from the exact count page.tsx's
 * query already computes) rather than loading the full ~4,000-row filtered
 * set into the browser and paginating client-side -- that would "fix" the
 * DOM node count but reintroduce the exact large-payload problem this
 * dashboard already solved with .range()-based pagination. TanStack Table
 * here is a rendering/column layer over server-paginated data, not a
 * second data-fetching layer.
 *
 * Phase 16 adds a toolbar above the table: the free-text search input
 * (see ppa-search-bar.tsx -- Phase 19 pulled it back out into its own file
 * so the Map view could reuse it too), a live row count, a
 * "Toggle Columns" dropdown (TanStack's built-in `columnVisibility` state,
 * persisted to localStorage so the Manager's column choices survive a
 * reload -- purely a display preference, not data, so localStorage is the
 * right tool here unlike in a sandboxed artifact), and an Export link that
 * downloads a CSV of every row matching the current filters via
 * export/route.ts.
 */
export function PpasDataTable<TData>({
  columns,
  data,
  page,
  totalPages,
  totalCount,
  pageSize,
  params,
  exportHref,
}: PpasDataTableProps<TData>) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // Read the saved column-visibility preference once on mount. Done in an
  // effect (not useState's initializer) because localStorage isn't
  // available during server-side rendering, and this table is otherwise
  // rendered inside a Server Component page -- reading it eagerly would
  // cause a hydration mismatch.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) setColumnVisibility(JSON.parse(saved));
    } catch {
      // Corrupt or inaccessible localStorage -- fall back to every column
      // visible, which is the same as never having saved a preference.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch {
      // Storage full/unavailable (e.g. private browsing) -- the toggle
      // still works for the current session, it just won't persist.
    }
  }, [columnVisibility]);

  const table = useReactTable({
    data,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const from = (page - 1) * pageSize;
  const rows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-navy/10 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PpaControlsToggle />
          <PpaSearchBar />
        </div>
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-sm text-slate-500">{totalCount.toLocaleString()} project(s)</span>

          <DropdownMenuPrimitive.Root>
            <DropdownMenuPrimitive.Trigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                Columns
              </Button>
            </DropdownMenuPrimitive.Trigger>
            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.Content
                align="end"
                sideOffset={8}
                className="z-50 w-48 rounded-lg border border-brand-navy/10 bg-white p-1 shadow-lg"
              >
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <DropdownMenuPrimitive.CheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-navy outline-none transition-colors data-[highlighted]:bg-brand-surface"
                    >
                      <span className="flex size-4 items-center justify-center">
                        <DropdownMenuPrimitive.ItemIndicator>
                          <Check className="size-4 text-brand-blue" aria-hidden="true" />
                        </DropdownMenuPrimitive.ItemIndicator>
                      </span>
                      {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
                    </DropdownMenuPrimitive.CheckboxItem>
                  ))}
              </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
          </DropdownMenuPrimitive.Root>

          <Button asChild variant="outline" size="sm">
            <a href={exportHref}>
              <Download className="size-4" aria-hidden="true" />
              Export
            </a>
          </Button>
        </div>
      </div>

      {/* Phase 17: its own vertical scroll instead of letting a full
          50-row page push the whole page tall -- the header stays
          `sticky` within this scroll region so column names never scroll
          out of view while browsing the rest of the page. Phase 20:
          `min-h-0 flex-1` (was a hardcoded `max-h-[560px]`) so this fills
          whatever's left of the parent Card's shared `lg:h-[700px]`
          instead of the Card's total height being however tall 560px of
          rows + the toolbar + pagination happen to add up to. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-5 text-center text-slate-400">
                  No projects match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {totalCount > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-brand-navy/10 px-5 py-3 text-sm text-slate-500">
          <span>
            Showing {from + 1}–{Math.min(from + pageSize, totalCount)} of {totalCount}
          </span>
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm">
              <Link
                href={buildHref(params, page - 1)}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
                className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
              >
                Previous
              </Link>
            </Button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="px-1.5 text-slate-400">
                  …
                </span>
              ) : (
                <Link
                  key={p}
                  href={buildHref(params, p)}
                  aria-current={p === page ? "page" : undefined}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                    p === page
                      ? "bg-brand-navy font-medium text-white"
                      : "text-slate-600 hover:bg-brand-surface"
                  )}
                >
                  {p}
                </Link>
              )
            )}
            <Button asChild variant="outline" size="sm">
              <Link
                href={buildHref(params, page + 1)}
                aria-disabled={page >= totalPages}
                tabIndex={page >= totalPages ? -1 : undefined}
                className={page >= totalPages ? "pointer-events-none opacity-50" : undefined}
              >
                Next
              </Link>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
