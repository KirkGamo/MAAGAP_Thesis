/**
 * currentWeekMonday() decides `inspector_schedules.week_of`, which every
 * schedule read filters on. When it was off by one, deployed schedules were
 * filed under the wrong week and simply did not appear — the Schedule tab
 * looked empty rather than wrong, which is why it went unnoticed.
 *
 * Fake timers pin a known "now" for each weekday, so these assert the same
 * result on a CI runner in UTC as on a laptop in Manila.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { currentWeekMonday } from "./current-week";

afterEach(() => {
  vi.useRealTimers();
});

function mondayWhenNowIs(year: number, monthIndex: number, day: number, hour = 12): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, monthIndex, day, hour, 0, 0));
  return currentWeekMonday();
}

describe("currentWeekMonday", () => {
  // Week of Monday 2026-09-07 through Sunday 2026-09-13.
  it.each([
    ["Monday", 7],
    ["Tuesday", 8],
    ["Wednesday", 9],
    ["Thursday", 10],
    ["Friday", 11],
    ["Saturday", 12],
    ["Sunday", 13],
  ])("resolves %s to that week's Monday", (_label, day) => {
    expect(mondayWhenNowIs(2026, 8, day as number)).toBe("2026-09-07");
  });

  it("treats Sunday as the END of its week, not the start", () => {
    // The classic off-by-one: getDay() returns 0 for Sunday, so a naive
    // `1 - day` would jump forward to the NEXT Monday instead of back.
    expect(mondayWhenNowIs(2026, 8, 13)).toBe("2026-09-07");
    expect(mondayWhenNowIs(2026, 8, 14)).toBe("2026-09-14");
  });

  it("does not shift a day when it is just past local midnight", () => {
    // The UTC+8 regression: 00:30 on Monday is Sunday afternoon in UTC, and
    // toISOString() would have filed this under the previous week.
    expect(mondayWhenNowIs(2026, 8, 7, 0)).toBe("2026-09-07");
  });

  it("crosses a month boundary backwards", () => {
    // Thursday 2026-10-01 belongs to the week of Monday 2026-09-28.
    expect(mondayWhenNowIs(2026, 9, 1)).toBe("2026-09-28");
  });

  it("crosses a year boundary backwards", () => {
    // Friday 2027-01-01 belongs to the week of Monday 2026-12-28.
    expect(mondayWhenNowIs(2027, 0, 1)).toBe("2026-12-28");
  });

  it("always returns a date that is itself a Monday", () => {
    for (let day = 1; day <= 28; day += 1) {
      const monday = mondayWhenNowIs(2026, 8, day);
      const [y, m, d] = monday.split("-").map(Number);
      expect(new Date(y, m - 1, d).getDay()).toBe(1);
    }
  });

  it("returns a plain YYYY-MM-DD string, matching the date column", () => {
    expect(mondayWhenNowIs(2026, 8, 9)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
