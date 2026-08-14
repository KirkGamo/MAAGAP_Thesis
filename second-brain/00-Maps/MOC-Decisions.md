---
tags: [moc, decisions]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MOC — Decisions

Every significant, non-obvious decision on this project, in roughly the order they were made. Each note follows context → options considered → decision → why, so a later contributor can tell the difference between "this was carefully chosen" and "this just happened to be the first thing that worked."

- [[02-Decisions/D01-Proxy-Completion-Dates|D01: Universal Proxy Completion Date Recovery]] — the foundational choice to recover completion dates from monitoring/liquidation records instead of leaving most of the dataset unlabeled.
- [[02-Decisions/D02-Phase7-Lag-Correction|D02: Empirical Lag Correction]] — correcting proxy dates' systematic late bias via a calibrated median lag.
- [[02-Decisions/D03-Phase8-Clamp|D03: Phase 8 D_start+1 Clamp]] — the most recent fix, narrowly recovering rows the lag correction over-corrected, without fabricating evidence for rows that never had any.
- [[02-Decisions/D04-Barangay-Veto-Crosswalk|D04: Barangay Veto on the Entity-Resolution Crosswalk]] — fixing silent cross-barangay project conflation, at the cost of a smaller but honest linked population.
- [[02-Decisions/D05-Refunded-Status|D05: Adding a "Refunded" Project Status]] — why "refunded" needed to be its own status instead of falling through to on_going.
- [[02-Decisions/D06-Status-Excludes-Scheduling|D06: Excluding Completed/Refunded Projects from Scheduling]] — keeping their risk tier visible as an audit signal while not recommending inspector visits to closed projects.
- [[02-Decisions/D07-No-Third-Validation-Split|D07: No Separate Validation Split]] — OOF cross-validation instead of 70/15/15.
- [[02-Decisions/D08-SHAP-Explainability|D08: SHAP for Explainability]] — and the xgboost/shap compatibility patch it required.
- [[02-Decisions/D09-Study-Period-Floor|D09: Study-Period Floor]] — dropping 3 pre-2015 data-entry-error rows via a genuine gap in the data, after a blanket "2016-2025" cutoff was tried and rejected for also excluding 381 legitimate 2015 rows.
- [[02-Decisions/D10-Direct-Date-Credibility-Check|D10: Direct Completion-Date Credibility Check]] — closing the same non-positive-duration gap Phase 8 already guards against for proxy dates, but for directly-observed completion dates.
- [[02-Decisions/D11-Exact-Duplicate-Removal|D11: Exact-Duplicate Row Removal]] — deduplicating genuine duplicate ledger entries, plus the mon_row_id index-integrity prerequisite fix it (and D09) depend on.

See [[MOC-Known-Issues]] for the limitations these decisions left behind, and [[99-Log]] for the chronological work history.
