---
tags: [decision, data-quality, preprocessing]
status: active
created: 2026-08-31
updated: 2026-08-31
---

# D15: Currency Coercion — Magnitude Suffixes and Trailing Annotations (DQ-12)

## Context
Found 2026-08-31 while investigating why one monitoring row's amount parsed as
`50000.002024`. The original `_coerce_single_currency()` reduced a cell to
digits with `re.sub(r"[^\d.\-]", "", ...)`, which caused two distinct defects:

1. **Magnitude suffixes were discarded, not applied.** `" 1.760 M"` parsed as
   **1.76** instead of **1,760,000**. 46 rows totalling roughly PHP 110M of
   project value were understated a millionfold; 19 of them were inside the
   training set.
2. **Trailing annotations were concatenated into the number.** The workbook
   frequently records a funding source under the amount (`"50,000.00"` +
   newline + `"MOOE 2024"`). Stripping non-digits fused them:
   `50,000.00` + `MOOE 2024` -> `50000.002024`. Usually a trivial distortion,
   but one row (`"150,0"` + newline + `"20% NTA CY 2025"`) became
   **PHP 1,500,202,025** -- a phantom PHP 1.5 BILLION project, by far the
   largest "project" in the dataset, from a row actually worth PHP 1,500.

This matters beyond tidiness: `AMOUNT (Php)` is a model feature, and it also
drives IQR outlier flagging (Step 8) and min-max scaling (Step 11), so a
handful of extreme wrong values distorts the scale every other row is
normalized against.

## Decision
Rewrite the coercion around an explicit *numeric region* instead of
character-stripping:

1. Reject unrecoverably ambiguous forms up front. `"50.000.00"` uses a period
   as a thousands separator (or is mistyped); it could mean 50,000.00 or
   50.00, so it stays NaN for imputation to handle -- matching the previous
   behaviour rather than inventing a value.
2. Take the region from the first digit up to the first letter or newline.
   That boundary is what stops annotations being absorbed, while still
   tolerating the workbook's stray internal spaces (`" 31, 671,942.80"`,
   `" 1,000, 000.00"`) and misplaced commas (`"100,00.00"`), which are
   stripped as formatting noise.
3. Apply a K/M/B multiplier only when the letter is genuinely attached to the
   number and is not the start of a word -- so `"1.760 M"` multiplies but
   `"1.5 MOOE"` does not.

## Why this shape
An earlier attempt used a single "first numeric token" regex. It fixed the
suffixes but **regressed** on numbers containing internal spaces --
`" 31, 671,942.80"` became 31.00 -- and started parsing the ambiguous
dot-separated cells into wrong values. Both were caught by diffing old vs new
parsing across all 8,677 cells before running anything downstream, which is
the check worth repeating for any future change here: the requirement is
**zero newly-NaN cells** (no regressions) and every newly-parsed or changed
cell individually explicable.

## Verified effect
21 hand-written unit cases pass, covering suffixes, annotations, internal
spaces, misplaced commas, ambiguous forms, negatives and NA sentinels.
Across the full AMOUNT column: 172 cells change, **0 newly-NaN**, 4
newly-parsed (all legitimate: a trailing `- Balance`, a `Rev.` prefix, a
`-5999` suffix, and one annotated cell). Column total moves from
PHP 5,258,350,331 to PHP 3,898,626,383 -- a net reduction dominated entirely
by removing the single PHP 1.5B phantom, partly offset by the ~PHP 110M the
suffix fix restores.
