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
        <div className="flex items-center justify-between border-t border-brand-navy/10 px-5 py-3 text-sm text-slate-500">
          <span>
            Showing {from + 1}–{Math.min(from + pageSize, totalCount)} of {totalCount}
          </span>
          <div className="flex items-center gap-2">
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
            <span className="tabular-nums">
              Page {page} of {totalPages}
            </span>
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
