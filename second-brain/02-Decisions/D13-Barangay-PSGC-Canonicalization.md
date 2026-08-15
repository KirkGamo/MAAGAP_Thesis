---
tags: [decision, ml-pipeline, data-quality, entity-resolution]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# D13: Barangay PSGC Canonicalization

## Context

Municipality strings have been validated against the official 44-LGU reference list since the crosswalk was built ([[../03-ML-Pipeline/Stage1-Preprocess]]), but barangay strings never got the same treatment — [[D04-Barangay-Veto-Crosswalk|the D04 barangay veto]] compared *text-normalized* barangay strings fuzzily, which reduced but could not eliminate cross-barangay conflation ([[../05-Known-Issues/Issue-Barangay-Canonicalization]]). The missing piece was an authoritative barangay list.

## Decision

Committed the official PSGC barangay list for Iloilo Province — 1,901 barangays across all 44 LGUs, exported 2026-08-15 from the PSGC via the `psgc.gitlab.io` mirror of PSA's quarterly publication — as `ml-service/data_pipeline/reference/psgc_barangays_iloilo.csv` (name, municipality, 10-digit PSGC code). Added `canonicalize_barangay(raw, municipality)` to `preprocess.py`, following `canonicalize_municipality`'s exact pattern (RapidFuzz WRatio, `default_process` on both sides, graceful pass-through below cutoff), and wired it into `fuzzy_link_cascading`'s `_brgy` comparison keys.

Two deliberate design points:

1. **Municipality-scoped matching only.** Bare barangay names repeat heavily across municipalities ("Poblacion" exists in nearly every LGU), so a province-wide fuzzy match would happily canonicalize a misspelling onto a same-named barangay in the wrong municipality. Canonicalization therefore only applies within the row's already-canonicalized municipality; rows whose municipality is unresolved keep the old text-normalized comparison.
2. **Stricter cutoff (82) than municipality's (80).** Within one municipality the candidate list is small, and a wrong canonical mapping silently merges two different barangays — exactly the conflation the veto exists to prevent — while the cost of leaving a noisy string un-canonicalized is only that the veto falls back to the old fuzzy-text behavior.

## Effect (measured on the full pipeline rerun, 2026-08-15)

Canonicalization tightens the veto in both directions: two noisy spellings of the *same* barangay collapse to one official name (fewer false vetoes), and two *different* barangays that fuzzy-scored above the veto cutoff against each other get pulled to distinct official names (fewer missed vetoes). See the pipeline log's veto/linkage numbers and [[../05-Known-Issues/Issue-Barangay-Canonicalization]] for the recorded before/after delta.

## Residual limitation

The PSGC list is a point-in-time export (2026-Q2 vintage): barangay renames or boundary changes after that date, and truly free-form location strings (sitio/purok-level, school names standing in for barangays), still fall through to the un-canonicalized fuzzy comparison. This narrows, but does not fully close, the conflation-risk issue.
