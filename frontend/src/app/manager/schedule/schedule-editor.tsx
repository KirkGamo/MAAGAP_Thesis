"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateAssignment, removeAssignment, addAssignment } from "@/actions/schedule";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export interface EditableAssignment {
  id: string;
  projectKey: string;
  projectName: string;
  inspectorId: string | null;
  scheduledDay: string;
  cluster: string | null;
}

export interface InspectorOption {
  id: string;
  full_name: string | null;
}

/**
 * Phase 12.2: lets a Manager override the PuLP-optimized schedule after
 * it's been deployed -- reassign an assignment's inspector or day, remove
 * one, or add a manual assignment the optimizer missed. Sits below the
 * routing map / per-inspector cards on /manager/schedule as the "make
 * changes here" view; those stay read-only summaries.
 *
 * Each <select> commits immediately (no separate Save button) via
 * actions/schedule.ts's updateAssignment -- consistent with
 * active-toggle.tsx's pattern elsewhere in this codebase of committing on
 * change rather than batching edits.
 */
export function ScheduleEditor({
  assignments,
  inspectors,
}: {
  assignments: EditableAssignment[];
  inspectors: InspectorOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const [newProjectKey, setNewProjectKey] = useState("");
  const [newInspectorId, setNewInspectorId] = useState(inspectors[0]?.id ?? "");
  const [newDay, setNewDay] = useState<string>("Mon");
  const [newCluster, setNewCluster] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  function handleInspectorChange(id: string, inspectorId: string) {
    setRowError(null);
    startTransition(async () => {
      const res = await updateAssignment(id, { inspectorId });
      if (res.success) {
        router.refresh();
      } else {
        setRowError({ id, message: res.error });
      }
    });
  }

  function handleDayChange(id: string, scheduledDay: string) {
    setRowError(null);
    startTransition(async () => {
      const res = await updateAssignment(id, { scheduledDay });
      if (res.success) {
        router.refresh();
      } else {
        setRowError({ id, message: res.error });
      }
    });
  }

  function handleRemove(id: string) {
    setRowError(null);
    startTransition(async () => {
      const res = await removeAssignment(id);
      if (res.success) {
        router.refresh();
      } else {
        setRowError({ id, message: res.error });
      }
    });
  }

  function handleAdd() {
    setAddError(null);
    setAddSuccess(null);
    startTransition(async () => {
      const res = await addAssignment({
        projectKey: newProjectKey,
        inspectorId: newInspectorId,
        scheduledDay: newDay,
        cluster: newCluster,
      });
      if (res.success) {
        setNewProjectKey("");
        setNewCluster("");
        setAddSuccess(res.message ?? "Added.");
        router.refresh();
      } else {
        setAddError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Inspector</TableHead>
            <TableHead>Day</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignments.map((a) => (
            <Fragment key={a.id}>
              <TableRow>
                <TableCell>
                  <div className="font-medium text-slate-800">{a.projectName}</div>
                  <div className="text-xs text-slate-400">{a.projectKey}</div>
                </TableCell>
                <TableCell>
                  <select
                    className="h-8 rounded-md border border-slate-200 px-2 text-sm"
                    value={a.inspectorId ?? ""}
                    disabled={isPending}
                    onChange={(e) => handleInspectorChange(a.id, e.target.value)}
                  >
                    {!a.inspectorId && <option value="">Unassigned</option>}
                    {inspectors.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.full_name ?? "Unnamed"}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <select
                    className="h-8 rounded-md border border-slate-200 px-2 text-sm"
                    value={a.scheduledDay}
                    disabled={isPending}
                    onChange={(e) => handleDayChange(a.id, e.target.value)}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleRemove(a.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
              {rowError?.id === a.id && (
                <TableRow>
                  <TableCell colSpan={4} className="pt-0 text-xs text-red-600">
                    {rowError.message}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {assignments.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-slate-400">
                No assignments yet — add one below.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Add assignment
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newProjectKey}
            onChange={(e) => setNewProjectKey(e.target.value)}
            placeholder="Project key (from the PPAs tab)"
            className="h-8 w-56 text-sm"
          />
          <select
            className="h-8 rounded-md border border-slate-200 px-2 text-sm"
            value={newInspectorId}
            onChange={(e) => setNewInspectorId(e.target.value)}
          >
            {inspectors.length === 0 && <option value="">No active inspectors</option>}
            {inspectors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.full_name ?? "Unnamed"}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-slate-200 px-2 text-sm"
            value={newDay}
            onChange={(e) => setNewDay(e.target.value)}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <Input
            value={newCluster}
            onChange={(e) => setNewCluster(e.target.value)}
            placeholder="Cluster (optional)"
            className="h-8 w-32 text-sm"
          />
          <Button
            size="sm"
            disabled={isPending || !newProjectKey.trim() || !newInspectorId}
            onClick={handleAdd}
          >
            {isPending ? "Adding..." : "Add"}
          </Button>
        </div>
        {addError && <p className="text-xs text-red-600">{addError}</p>}
        {addSuccess && <p className="text-xs text-emerald-700">{addSuccess}</p>}
      </div>
    </div>
  );
}
