---
tags: [open-issue, data-quality]
status: narrowed
created: 2026-08-08
updated: 2026-08-15
---

# Open Issue: Barangay Canonicalization (narrowed 2026-08-15)

[[../02-Decisions/D04-Barangay-Veto-Crosswalk|The barangay veto]] fixed the worst, systemic cross-barangay conflation in the entity-resolution crosswalk. The missing authoritative-reference half was closed on 2026-08-15 by [[../02-Decisions/D13-Barangay-PSGC-Canonicalization]]: `canonicalize_barangay()` in `preprocess.py` now validates barangay strings against the official 1,901-entry PSGC list for Iloilo's 44 LGUs (`ml-service/data_pipeline/reference/psgc_barangays_iloilo.csv`), municipality-scoped, before the veto comparison.

## Measured effect (2026-08-15 rerun)

- Of 21,174 fund-transfer rows with a barangay string and a PSGC-resolvable municipality: 71.2% already matched an official name exactly after text normalization; canonicalization lifted that to **81.8%** (2,249 noisy strings, 10.6%, corrected to their official PSGC name). 18.2% remain un-canonicalizable (sitio/purok-level strings, school names standing in for barangays) and fall back to the previous fuzzy-text comparison.
- Crosswalk linkage rate: 18.7% → **19.8%** (3,997 → 4,243 fund-transfer rows linked) — net effect of fewer false vetoes (same barangay, different spellings, now collapsing to one canonical name).
- Downstream, combined with the D12 classifier this raised labeled LSTM sequence coverage 1,581 → 2,004.

## What remains open

- The 18.2% un-canonicalizable residual still relies on fuzzy text comparison — conflation there is reduced only by the veto, exactly as before.
- The PSGC list is a point-in-time export (2026-Q2 vintage via the psgc.gitlab.io mirror); barangay renames/boundary changes after that date aren't reflected until the reference CSV is manually refreshed.
- Rows whose *municipality* fails to canonicalize get no barangay canonicalization at all (by design — cross-municipality barangay-name collisions like "Poblacion" make unscoped matching dangerous).
