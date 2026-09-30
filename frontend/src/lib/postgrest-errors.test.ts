/**
 * isMissingColumnError() decides whether a feature degrades gracefully or
 * breaks when a hand-applied `add_*.sql` migration has not been run yet. This
 * repo applies those by hand in the Supabase SQL editor, so code and schema are
 * routinely out of step.
 *
 * Both directions matter. Too narrow and a missing column crashes a page; too
 * broad and it swallows a genuine write failure as "schema not migrated yet" —
 * which is the same silent-success shape as the reporting-loop bug, where a
 * write affecting zero rows returned no error at all.
 */

import { describe, expect, it } from "vitest";

import { isMissingColumnError } from "./postgrest-errors";

describe("isMissingColumnError", () => {
  it("recognises Postgres undefined_column by code", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
  });

  it("recognises PostgREST's schema-cache miss by code", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
  });

  it("recognises the Postgres message form", () => {
    expect(
      isMissingColumnError({ message: 'column "shap_top_features" does not exist' })
    ).toBe(true);
  });

  it("recognises the PostgREST message form", () => {
    expect(
      isMissingColumnError({
        message: "Could not find the 'inspector_slug' column of 'profiles' in the schema cache",
      })
    ).toBe(true);
  });

  it("is case-insensitive on the message", () => {
    expect(isMissingColumnError({ message: 'COLUMN "x" DOES NOT EXIST' })).toBe(true);
  });

  // The other direction: these are real failures and must NOT be mistaken for
  // an unapplied migration, or the caller will silently continue.
  it.each([
    ["RLS denial", { code: "42501", message: "new row violates row-level security policy" }],
    ["unique violation", { code: "23505", message: "duplicate key value violates unique constraint" }],
    ["foreign key violation", { code: "23503", message: "violates foreign key constraint" }],
    ["not-null violation", { code: "23502", message: 'null value in column "project_key"' }],
    ["undefined table", { code: "42P01", message: 'relation "projects" does not exist' }],
    ["network error", { message: "fetch failed" }],
  ])("does not treat %s as a missing column", (_label, error) => {
    expect(isMissingColumnError(error)).toBe(false);
  });

  it("handles an error object with neither code nor message", () => {
    expect(isMissingColumnError({})).toBe(false);
  });

  it("does not throw on an undefined message", () => {
    expect(() => isMissingColumnError({ code: "XX000" })).not.toThrow();
  });
});
