/**
 * capacity.ts mirrors ml-service/optimization_engine.py's DAILY_CAPACITY and
 * WEEKLY_CAPACITY by hand. The solver enforces them as hard constraints; the
 * workspace shows them as capacity chips and soft warnings.
 *
 * A hand-maintained mirror drifts. If it does, the UI stops matching the
 * schedules the solver produces — chips showing an inspector at 3/3 on a day
 * the solver considered full at 4, or warnings that never fire. Neither throws;
 * the numbers just quietly stop meaning the same thing.
 *
 * These tests cannot import the Python constants, so they pin the values and
 * name the file to change alongside. A failure here means the two have
 * diverged, and the fix is to reconcile both — not to update this expectation
 * on its own.
 */

import { describe, expect, it } from "vitest";

import { DAILY_CAPACITY, WEEKLY_CAPACITY, daysOverCapacity } from "./capacity";

describe("solver capacity assumptions", () => {
  it("matches optimization_engine.py's DAILY_CAPACITY", () => {
    // ml-service/optimization_engine.py: DAILY_CAPACITY = 3
    expect(DAILY_CAPACITY).toBe(3);
  });

  it("matches optimization_engine.py's WEEKLY_CAPACITY", () => {
    // ml-service/optimization_engine.py: WEEKLY_CAPACITY = 12
    expect(WEEKLY_CAPACITY).toBe(12);
  });

  it("keeps a weekly allowance that a five-day week can actually reach", () => {
    // A weekly cap above 5 x daily would be unreachable and therefore never
    // bind; one far below would make the daily cap the only real constraint.
    expect(WEEKLY_CAPACITY).toBeLessThanOrEqual(DAILY_CAPACITY * 5);
    expect(WEEKLY_CAPACITY).toBeGreaterThan(DAILY_CAPACITY);
  });

  it("exposes positive integers", () => {
    for (const value of [DAILY_CAPACITY, WEEKLY_CAPACITY]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});

/**
 * The day-tab capacity marker's rule. These tests carry the whole burden of
 * verifying it: the fullest week in the live data sits exactly at 12/12 and
 * 3/day, so no amount of driving the real UI reaches the over-capacity branch.
 */
describe("daysOverCapacity", () => {
  const visit = (inspector_id: string, scheduled_day: string) => ({ inspector_id, scheduled_day });

  it("is empty when nothing is deployed", () => {
    expect(daysOverCapacity([]).size).toBe(0);
  });

  it("does not flag a day sitting exactly at capacity", () => {
    // The live data's fullest week looks exactly like this. An off-by-one here
    // would flag every real week, which is worse than never flagging at all --
    // a marker that is always on is one people learn to ignore.
    const visits = Array.from({ length: DAILY_CAPACITY }, () => visit("a", "Mon"));
    expect(daysOverCapacity(visits).size).toBe(0);
  });

  it("flags a day one past capacity", () => {
    const visits = Array.from({ length: DAILY_CAPACITY + 1 }, () => visit("a", "Mon"));
    expect([...daysOverCapacity(visits)]).toEqual(["Mon"]);
  });

  it("counts per inspector, not per day", () => {
    // Nine visits on one day across three inspectors is three full days of
    // work, not an overload. Counting per day would flag every busy week.
    const visits = ["a", "b", "c"].flatMap((id) =>
      Array.from({ length: DAILY_CAPACITY }, () => visit(id, "Tue"))
    );
    expect(visits).toHaveLength(DAILY_CAPACITY * 3);
    expect(daysOverCapacity(visits).size).toBe(0);
  });

  it("flags only the days that are actually over", () => {
    const visits = [
      ...Array.from({ length: DAILY_CAPACITY + 2 }, () => visit("a", "Mon")),
      ...Array.from({ length: DAILY_CAPACITY }, () => visit("a", "Tue")),
      ...Array.from({ length: DAILY_CAPACITY + 1 }, () => visit("b", "Thu")),
    ];
    expect([...daysOverCapacity(visits)].sort()).toEqual(["Mon", "Thu"]);
  });

  it("keeps days separate when one inspector is over on several", () => {
    const visits = ["Mon", "Wed"].flatMap((day) =>
      Array.from({ length: DAILY_CAPACITY + 1 }, () => visit("a", day))
    );
    expect([...daysOverCapacity(visits)].sort()).toEqual(["Mon", "Wed"]);
  });
});
