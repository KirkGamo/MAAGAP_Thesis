/**
 * Phase 14: extracted from actions/deploy-schedule.ts and actions/schedule.ts,
 * which each had their own identical copy of this function. Now also used by
 * manager/schedule/page.tsx and inspector/page.tsx to filter
 * `inspector_schedules` down to the current week -- see those files'
 * comments for why that filter is required (Phase 14's week_of bug fix).
 *
 * Returns the Monday of the current ISO week, as YYYY-MM-DD -- matches
 * `inspector_schedules.week_of`, a plain `date` column identifying which
 * week a given row's assignment belongs to.
 */
export function currentWeekMonday(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}
