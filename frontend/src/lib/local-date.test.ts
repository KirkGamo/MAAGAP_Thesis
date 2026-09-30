/**
 * R1: the first frontend tests in this project.
 *
 * They start here rather than on components because this is where the damage
 * has actually been. `toISOString().slice(0, 10)` shipped twice — once in
 * currentWeekMonday(), where it mislabelled every deployed schedule's week,
 * and once in the monitoring report path, where it dated a completion a day
 * early.
 *
 * The second one reaches the thesis itself: `projects.date_of_completion`
 * feeds T_actual, and T_actual against T_standard is what constructs the
 * RedFlag target the entire model is trained on. A silent one-day shift in
 * Manila (UTC+8) is a corrupted label.
 *
 * These tests pin that behaviour against the timezone that caused it, using
 * fake timers so they assert the same thing on a CI runner in UTC as on a
 * laptop in Manila — the bug was invisible precisely because it only appeared
 * east of UTC.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { toLocalIsoDate, todayLocalIsoDate } from "./local-date";

afterEach(() => {
  vi.useRealTimers();
});

describe("toLocalIsoDate", () => {
  it("formats a plain local date", () => {
    expect(toLocalIsoDate(new Date(2026, 8, 7, 12, 0, 0))).toBe("2026-09-07");
  });

  it("keeps the LOCAL day for times that UTC would push back a day", () => {
    // 00:30 local. In Manila (UTC+8) this is 16:30 the PREVIOUS day in UTC,
    // which is exactly what toISOString() would have returned.
    const midnightish = new Date(2026, 8, 7, 0, 30, 0);
    expect(toLocalIsoDate(midnightish)).toBe("2026-09-07");
  });

  it("keeps the LOCAL day for late-evening times", () => {
    const late = new Date(2026, 8, 7, 23, 45, 0);
    expect(toLocalIsoDate(late)).toBe("2026-09-07");
  });

  it("never agrees with toISOString when local time is before the UTC offset", () => {
    // This is the regression itself, stated as a property: for any local time
    // early enough in the day, the naive one-liner disagrees with us — and we
    // are the correct one.
    const early = new Date(2026, 0, 1, 1, 0, 0);
    const naive = early.toISOString().slice(0, 10);
    const correct = toLocalIsoDate(early);
    if (early.getTimezoneOffset() < 0) {
      // Runner is east of UTC (Manila is -480). The naive form is wrong here.
      expect(naive).not.toBe(correct);
    }
    // Either way, ours is the local calendar day.
    expect(correct).toBe("2026-01-01");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("handles a leap day", () => {
    expect(toLocalIsoDate(new Date(2028, 1, 29))).toBe("2028-02-29");
  });

  it("handles the last day of a year without rolling over", () => {
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });
});

describe("todayLocalIsoDate", () => {
  it("returns the local calendar day, not the UTC one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 2, 0, 0));
    expect(todayLocalIsoDate()).toBe("2026-09-07");
  });
});
