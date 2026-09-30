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

import { DAILY_CAPACITY, WEEKLY_CAPACITY } from "./capacity";

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
