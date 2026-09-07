import { createClient } from "@/lib/supabase/server";
import { currentWeekMonday } from "@/lib/current-week";
import { Card } from "@/components/tremor/card";
import { DAILY_CAPACITY, WEEKLY_CAPACITY } from "../schedule/capacity";
import { InviteInspectorForm } from "./invite-inspector-form";
import { RosterReadiness, readinessHeadline } from "./roster-readiness";
import { SlotCard } from "./slot-card";
import { UnrosteredTable } from "./unrostered-table";
import {
  buildSlotRows,
  buildWeekLoads,
  summarizeRoster,
  undeployableVisits,
  unrosteredProfiles,
  type InspectorProfile,
} from "./lib/roster";

/**
 * The optimizer's roster slots, read from its latest solve rather than a
 * hardcoded "Inspector_1".."Inspector_6" -- INSPECTOR_COUNT lives in
 * optimization_engine.py and duplicating it here is exactly the drift
 * slug-field.tsx warned about. Best-effort: the ML service is a separate
 * process and is usually absent next to a deployed frontend, so an
 * unreachable/slow/errored fetch returns null and the page renders the
 * roster from Supabase alone (see RosterReadiness's offline chip).
 */
interface SolverRoster {
  slots: string[];
  /** Visits the latest solve routes to each slot. */
  countBySlot: Record<string, number>;
  totalRows: number;
}

async function fetchSolverRoster(): Promise<SolverRoster | null> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/latest-schedule`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      rows?: { inspector?: string }[];
      summary?: { inspectors_used?: string[] } | null;
    };
    const rows = data.rows ?? [];
    const countBySlot: Record<string, number> = {};
    for (const row of rows) {
      if (row.inspector) countBySlot[row.inspector] = (countBySlot[row.inspector] ?? 0) + 1;
    }
    const summarySlots = data.summary?.inspectors_used;
    const slots =
      Array.isArray(summarySlots) && summarySlots.length > 0
        ? summarySlots
        : Object.keys(countBySlot);
    if (slots.length === 0) return null;
    return { slots, countBySlot, totalRows: rows.length };
  } catch {
    return null;
  }
}

/**
 * Inspectors tab, rebuilt as a roster-readiness console (see
 * INSPECTORS_TAB_IMPROVEMENT_PLAN.md).
 *
 * The tab used to be a four-column table -- name, joined, a free-text
 * optimization-slot box, status -- which said nothing about the one fact
 * that governs whether the prescriptive half of this system works at
 * all: the optimizer allocates to a fixed set of roster slots, and any
 * slot with no profile bound to it silently drops its share of the solve
 * at deploy time. Slots are now the primary objects on the page, each
 * either filled by a person or drawn as a gap to close.
 *
 * Layout follows the same single-viewport contract as the Overview and
 * Schedule tabs: at lg+ the page pins to the viewport remainder and
 * never scrolls; the slot grid and the unrostered table each own their
 * internal scroll so any roster size is absorbed without the page
 * itself growing. Below lg everything stacks and scrolls normally.
 *
 * Deliberately still excluded (unchanged scope decision from this tab's
 * first version): per-inspector contact details and capacity fields --
 * `profiles` has no such columns and the 3/day, 12/week figures are
 * global solver assumptions, not per-person data.
 */
export default async function InspectorsPage() {
  const supabase = await createClient();

  const [{ data: profileRows, error }, { data: scheduleRows }, solverRoster] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, active, inspector_slug, created_at")
      .eq("role", "inspector")
      .order("full_name"),
    // Deployed load for the current week only -- inspector_schedules
    // accumulates every week ever deployed (the Phase 14 note on the
    // Schedule page), so an unscoped read would inflate every capacity
    // chip with historical visits.
    supabase
      .from("inspector_schedules")
      .select("inspector_id, scheduled_day")
      .eq("week_of", currentWeekMonday()),
    fetchSolverRoster(),
  ]);

  const profiles = (profileRows ?? []) as InspectorProfile[];
  const slotRows = buildSlotRows(solverRoster?.slots ?? [], profiles);
  const summary = summarizeRoster(slotRows, profiles);
  const unrostered = unrosteredProfiles(profiles);
  const weekLoads = buildWeekLoads(scheduleRows ?? []);
  const undeployable = solverRoster
    ? undeployableVisits(slotRows, solverRoster.countBySlot)
    : 0;

  // Composed as plain strings, not JSX text: this repo's Next build fuses
  // boundary whitespace around entities (Overview/Schedule convention).
  const slotsExplainer =
    "The optimizer allocates every site visit to a numbered roster slot rather than to a person. " +
    "Binding a real inspector to a slot is what lets a deployed schedule reach them — visits " +
    "routed to an empty slot are skipped at deploy time and nobody is sent.";
  const capacityNote =
    `Solver assumptions: ${DAILY_CAPACITY} visits per inspector per day, ${WEEKLY_CAPACITY} per week. ` +
    "These are global planning figures, not per-person settings.";

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-navy">Inspectors</h1>
          <p className="text-xs text-slate-500">
            {readinessHeadline(summary, solverRoster !== null, undeployable, solverRoster?.totalRows ?? 0)}
          </p>
        </div>
        <InviteInspectorForm />
      </div>

      <div className="shrink-0">
        <RosterReadiness
          summary={summary}
          serviceReachable={solverRoster !== null}
          undeployable={undeployable}
        />
      </div>

      {error && (
        <p className="shrink-0 text-sm text-red-600">Could not load inspectors: {error.message}</p>
      )}

      {/* Two panes, matching the Schedule tab's shape: the roster itself
          on the left, everything that explains or supplements it on the
          right, so a small roster doesn't leave the viewport empty. */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.5fr_1fr]">
        <Card className="flex flex-col p-4 lg:min-h-0">
          <p className="mb-2 shrink-0 text-sm font-semibold text-brand-navy">Optimizer slots</p>
          {/* The grid uses auto-rows-min + content-start so cards keep
              their natural height instead of stretching to fill the pane
              (a roster smaller than the viewport would otherwise render a
              few words inside 300px-tall boxes), and scrolls inside the
              card once the roster outgrows it. */}
          {slotRows.length > 0 ? (
            <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-2 overflow-y-auto pr-1 xl:grid-cols-3">
              {slotRows.map((row) => (
                <SlotCard
                  key={row.slot}
                  row={row}
                  load={row.profile ? weekLoads[row.profile.id] : undefined}
                  proposedVisits={solverRoster?.countBySlot[row.slot] ?? 0}
                  solveKnown={solverRoster !== null}
                />
              ))}
            </div>
          ) : (
            <p className="p-4 text-center text-sm text-slate-400">
              No optimizer slots yet — assign one to an inspector, or run the optimizer so its
              roster can be read.
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-3 lg:min-h-0">
          <Card className="flex flex-col p-4 lg:min-h-0 lg:flex-1">
            <p className="mb-1 shrink-0 text-sm font-semibold text-brand-navy">No optimizer slot</p>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <UnrosteredTable profiles={unrostered} />
            </div>
          </Card>

          <Card className="shrink-0 p-4">
            <p className="text-sm font-semibold text-brand-navy">How slots work</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{slotsExplainer}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{capacityNote}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
