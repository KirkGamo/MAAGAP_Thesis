/**
 * True when PostgREST rejected a column this database doesn't have yet.
 * `42703` is Postgres's undefined_column; `PGRST204` is PostgREST's own
 * "column not found in the schema cache" for writes.
 *
 * Used so features that depend on a loose `add_*.sql` migration degrade
 * instead of breaking when it hasn't been run yet — this repo applies
 * those by hand in the Supabase SQL editor, so code and schema are
 * routinely out of step for a while. Lives here rather than in an action
 * file because a "use server" module may only export async actions.
 */
export function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|could not find the '.*' column/i.test(error.message ?? "")
  );
}
