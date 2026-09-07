/**
 * Pure helpers behind the Inspectors tab's roster view (see
 * INSPECTORS_TAB_IMPROVEMENT_PLAN.md at the repo root). No Supabase
 * client, no async -- these take already-fetched rows and return the
 * slot-centric shape the page renders, so the counting rules live in one
 * testable place.
 *
 * The organising idea: the optimizer allocates work to fixed roster
 * SLOTS ("Inspector_1".."Inspector_N", see optimization_engine.py's
 * INSPECTOR_COUNT), and `profiles.inspector_slug` binds a real person to
 * one. A slot with nobody bound to it is why optimizer output silently
 * fails to deploy, so slots -- not people -- are the primary objects
 * here.
 */

export interface InspectorProfile {
  id: string;
  full_name: string | null;
  active: boolean;
  inspector_slug: string | null;
  created_at: string;
}

export interface SlotRow {
  slot: string;
  /** The person bound to this slot, if any. */
  profile: InspectorProfile | null;
  /** False when the slot is held by a profile but the current solve
   * doesn't use it (e.g. a typo'd slug, or a roster that shrank) -- the
   * person still shows, flagged, rather than silently vanishing. */
  inCurrentSolve: boolean;
}

/**
 * Sorts "Inspector_2" before "Inspector_10" (plain string sort gets this
 * wrong) while still ordering slugs that carry no number sensibly.
 */
export function naturalSlotCompare(a: string, b: string): number {
  const numA = Number(a.match(/(\d+)\s*$/)?.[1]);
  const numB = Number(b.match(/(\d+)\s*$/)?.[1]);
  const prefixA = a.replace(/(\d+)\s*$/, "");
  const prefixB = b.replace(/(\d+)\s*$/, "");
  if (prefixA === prefixB && Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  return a.localeCompare(b);
}

/**
 * The slot grid's rows: every slot the current solve allocates to, UNION
 * every slot a profile already claims. The union matters in both
 * directions -- a solver slot with no profile is the deploy gap this tab
 * exists to surface, and a profile holding a slot the solver no longer
 * uses must not disappear from the roster just because the solve moved
 * on.
 *
 * `solverSlots` comes from the ML service (its latest solve), never from
 * a hardcoded 1..6 -- duplicating the roster size in Python and
 * TypeScript is exactly the drift slug-field.tsx warned about. When the
 * service is unreachable it is empty, and the grid degrades to the slots
 * already in use.
 */
export function buildSlotRows(
  solverSlots: string[],
  profiles: InspectorProfile[]
): SlotRow[] {
  const solverSet = new Set(solverSlots);
  const profileBySlot = new Map<string, InspectorProfile>();
  for (const profile of profiles) {
    if (profile.inspector_slug) profileBySlot.set(profile.inspector_slug, profile);
  }

  const allSlots = Array.from(new Set([...solverSlots, ...profileBySlot.keys()]));
  return allSlots.sort(naturalSlotCompare).map((slot) => ({
    slot,
    profile: profileBySlot.get(slot) ?? null,
    // With no solver list available, nothing can be judged out-of-solve.
    inCurrentSolve: solverSet.size === 0 || solverSet.has(slot),
  }));
}

export interface RosterSummary {
  totalSlots: number;
  filledSlots: number;
  emptySlots: number;
  activeInspectors: number;
  /** Inspector profiles with no slot at all -- invited but never bound,
   * so the optimizer can never route work to them. */
  unrostered: number;
  /** Slots held by someone who can't sign in. Deploy still writes their
   * rows, so this is a warning, not an undeployable count. */
  inactiveInSlot: number;
}

export function summarizeRoster(
  slotRows: SlotRow[],
  profiles: InspectorProfile[]
): RosterSummary {
  const filledSlots = slotRows.filter((row) => row.profile).length;
  return {
    totalSlots: slotRows.length,
    filledSlots,
    emptySlots: slotRows.length - filledSlots,
    activeInspectors: profiles.filter((p) => p.active).length,
    unrostered: profiles.filter((p) => !p.inspector_slug).length,
    inactiveInSlot: slotRows.filter((row) => row.profile && !row.profile.active).length,
  };
}

/** Inspectors with no slot, plus a stable display name. Rendered in the
 * table below the grid so the grid stays bounded by the roster size. */
export function unrosteredProfiles(profiles: InspectorProfile[]): InspectorProfile[] {
  return profiles.filter((p) => !p.inspector_slug);
}

export function displayName(profile: InspectorProfile): string {
  return profile.full_name?.trim() || "Unnamed";
}
