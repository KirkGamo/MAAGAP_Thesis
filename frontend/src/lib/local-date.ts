/**
 * Formats a Date as YYYY-MM-DD using its LOCAL calendar day.
 *
 * `toISOString().slice(0, 10)` is the tempting one-liner and it is wrong
 * for this: it converts to UTC first, so anywhere east of UTC (Manila is
 * UTC+8) any local time before 08:00 serializes as the PREVIOUS day. That
 * bug already shipped twice here -- once in currentWeekMonday(), where it
 * shifted every deployed schedule's week_of, and once in the monitoring
 * report path, where it dated a completion a day early. The second is the
 * more damaging: `projects.date_of_completion` feeds T_actual, and T_actual
 * against T_standard is what constructs the RedFlag target the whole model
 * is trained on.
 *
 * Use this for any `date` column that means "the day this happened here".
 */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, as the local calendar day. */
export function todayLocalIsoDate(): string {
  return toLocalIsoDate(new Date());
}
