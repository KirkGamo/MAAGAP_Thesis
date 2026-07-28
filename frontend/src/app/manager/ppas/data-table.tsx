"use client";

import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
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

export interface PpaTableParams {
  q?: string;
  risk_tier?: string;
  status?: string;
  view?: string;
}

interface PpasDataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  params: PpaTableParams;
}

/** Rebuilds the same "rewrite the URL, only change `page`" href every other
 * PPAs control uses (ppa-filters.tsx, view-toggle.tsx) -- duplicated here
 * rather than passed down as a prop function from the Server Component
 * page, since Server -> Client Component props can't carry functions (see
 * Phase 10's fix for the same class of error on BarChart's valueFormatter). */
function buildHref(params: PpaTableParams, targetPage: number): string {
  const next = new URLSearchParams();
  if (params.q) next.set("q", params.q);
  if (params.risk_tier) next.set("risk_tier", params.risk_tier);
  if (params.status) next.set("status", params.status);
  if (params.view) next.set("view", params.view);
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
 */
export function PpasDataTable<TData>({
  columns,
  data,
  page,
  totalPages,
  totalCount,
  pageSize,
  params,
}: PpasDataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const from = (page - 1) * pageSize;
  const rows = table.getRowModel().rows;

  return (
    <>
      <Table>
        <TableHeader>
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
              <TableCell colSpan={columns.length} className="p-5 text-center text-slate-400">
                No projects match the current filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-navy/10 px-5 py-3 text-sm text-slate-500">
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
