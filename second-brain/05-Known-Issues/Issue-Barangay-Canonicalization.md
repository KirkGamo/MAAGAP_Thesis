---
tags: [open-issue, data-quality]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: Barangay Canonicalization

[[../02-Decisions/D04-Barangay-Veto-Crosswalk|The barangay veto]] fixed the worst, systemic cross-barangay conflation in the entity-resolution crosswalk, but barangay-level data still isn't authoritatively canonicalized the way municipality is (`canonicalize_municipality()` has no barangay equivalent).

## Why this matters

Residual conflation for barangays with inconsistent naming (spelling variants, abbreviations, alternate names) cannot be fully ruled out even after the veto fix — the veto only catches cases where RapidFuzz's fuzzy match scores two barangay strings as clearly different; it can't catch two different spellings of the *same* barangay that happen to score as similar, nor can it catch cases where one side's barangay field is simply missing (which doesn't veto by design).

## What would resolve it

A canonical barangay reference list (analogous to the existing municipality canonicalization), used to normalize both sides before the fuzzy match rather than relying on fuzzy matching the raw strings directly. Not yet built.
