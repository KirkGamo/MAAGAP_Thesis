import { describe, expect, it } from "vitest";
import { readinessHeadline } from "./roster-readiness";
import { buildSlotRows, summarizeRoster, type InspectorProfile } from "./lib/roster";

/**
 * The headline is the first and often only thing a manager reads on this tab,
 * and it governs whether they go and fix the roster. These tests exist because
 * it once said the opposite of the truth.
 */

function profile(over: Partial<InspectorProfile> = {}): InspectorProfile {
  return {
    id: crypto.randomUUID(),
    full_name: "Test Inspector",
    active: true,
    inspector_slug: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** Mirrors page.tsx: slot rows are the solver's slots union the held ones. */
function summarize(solverSlots: string[], profiles: InspectorProfile[]) {
  return summarizeRoster(buildSlotRows(solverSlots, profiles), profiles);
}

describe("readinessHeadline when the ML service is unreachable", () => {
  // The regression this file was written for. Live state on 2026-10-06: one
  // profile holding Inspector_1, service down. The slot universe collapses to
  // the slots profiles already hold, so filled === total and empty === 0, and
  // the headline previously read "1 of 1 optimizer slot filled -- every slot
  // can receive deployed work" against a true 1 of 6 with 21 of 25 visits
  // undeployable.
  it("does not claim every slot can receive work", () => {
    const profiles = [profile({ inspector_slug: "Inspector_1" })];
    const summary = summarize([], profiles);

    // The structural artefact that caused it, asserted so the test still
    // means something if buildSlotRows changes.
    expect(summary.totalSlots).toBe(1);
    expect(summary.filledSlots).toBe(1);
    expect(summary.emptySlots).toBe(0);

    const headline = readinessHeadline(summary, false, 0, 0);
    expect(headline).not.toContain("every slot can receive deployed work");
    expect(headline).not.toContain("1 of 1");
  });

  it("states what is known and names what is not", () => {
    const summary = summarize([], [profile({ inspector_slug: "Inspector_1" })]);
    const headline = readinessHeadline(summary, false, 0, 0);
    expect(headline).toContain("1 inspector holds an optimizer slot");
    expect(headline).toContain("roster size is unknown");
  });

  it("pluralises the held count", () => {
    const summary = summarize(
      [],
      [
        profile({ inspector_slug: "Inspector_1" }),
        profile({ inspector_slug: "Inspector_2" }),
      ]
    );
    expect(readinessHeadline(summary, false, 0, 0)).toContain("2 inspectors hold");
  });

  it("still asks for a first assignment when nobody holds a slot", () => {
    const summary = summarize([], [profile()]);
    expect(summary.totalSlots).toBe(0);
    expect(readinessHeadline(summary, false, 0, 0)).toContain("Assign each inspector");
  });
});

describe("readinessHeadline when the solve is known", () => {
  // Six solver slots, one held: the true state the offline path cannot see.
  const solverSlots = ["Inspector_1", "Inspector_2", "Inspector_3", "Inspector_4", "Inspector_5", "Inspector_6"];

  it("names the concrete undeployable cost", () => {
    const summary = summarize(solverSlots, [profile({ inspector_slug: "Inspector_1" })]);
    expect(summary.totalSlots).toBe(6);
    expect(summary.filledSlots).toBe(1);
    expect(readinessHeadline(summary, true, 21, 25)).toBe(
      "1 of 6 optimizer slots filled — 21 of the latest solve's 25 visits cannot be deployed to anyone."
    );
  });

  it("falls back to the structural statement when no visits are routed to empty slots", () => {
    const summary = summarize(solverSlots, [profile({ inspector_slug: "Inspector_1" })]);
    expect(readinessHeadline(summary, true, 0, 0)).toContain(
      "work routed to the empty ones cannot be deployed"
    );
  });

  // The all-clear is correct here and must survive: it is only reachable when
  // the solver's roster is known and genuinely full.
  it("gives the all-clear only when the roster is known and full", () => {
    const profiles = solverSlots.map((slot) => profile({ inspector_slug: slot }));
    const summary = summarize(solverSlots, profiles);
    expect(summary.emptySlots).toBe(0);
    expect(readinessHeadline(summary, true, 0, 0)).toContain(
      "every slot can receive deployed work"
    );
  });
});
