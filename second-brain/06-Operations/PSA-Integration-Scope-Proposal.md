---
tags: [scoping, external-data, proposal]
status: proposed
created: 2026-08-15
updated: 2026-08-15
---

# PSA Economic-Indicator Integration — Scope Proposal (pre-build)

Written per the 2026-08-15 Currency Check follow-up: scope before building. **No ingestion code exists yet** — `fetch_psa_data.py` remains the placeholder `optimization_engine.py`'s comments describe. This note is the proposed scope for Kirk's sign-off.

## What PSA actually publishes, at what granularity

Source: PSA **OpenSTAT** (openstat.psa.gov.ph) — a PX-Web instance. Every table supports manual CSV export and a documented PX-Web POST API (JSON query → JSON-stat/CSV); no API key required. Note: the site 403s generic scripted GETs (observed this session), so bulk pulls should use the PX-Web API endpoint or a browser-session export, not naive scraping.

| Candidate indicator | Geographic granularity | Temporal | Fit |
|---|---|---|---|
| Consumer Price Index / inflation, all-income households (2018=100) | **Provincial** (Iloilo row exists) | Monthly, 2018→present; older 2012=100 series covers pre-2018 | Best-fit macro signal; needs 2012→2018 base splicing for our 2015-2017 rows |
| Construction Materials Wholesale Price Index (CMWPI) | **NCR only** — this is the index government price-escalation clauses use | Monthly | Usable only as a national construction-cost proxy, with an explicit NCR caveat |
| Construction Materials Retail Price Index (CMRPI) | NCR only | Monthly | Same caveat as CMWPI |
| Poverty incidence, small-area estimates (SAE) | **Municipal** | Every ~3 years (2015, 2018, 2021 vintages) | Only municipal-varying candidate; near-static in time |
| LGU income classification | Municipal | Periodic reclassification | Not PSA — DOF/BLGF publication; separate source if wanted |

## The honest granularity mismatch

Our unit is per-project, per-municipality, dated by `D_start` (2015-2025). All projects sit in one province, so **provincial CPI varies only by month, not across projects released the same month** — it's a temporal macro feature, not a cross-sectional one. The only municipal-varying candidate (poverty SAE) is near-static in time. PSA data therefore adds context, not project-level discrimination; expectations for feature importance should be set accordingly in the manuscript.

## Proposed scope (in priority order)

1. **`cpi_iloilo_at_release` + `inflation_yoy_at_release`** — provincial CPI (2018=100) joined on `D_start`'s month. Splice the 2012=100 series for pre-2018 rows, documented. One committed reference CSV (~130 rows: months × 1 province), refreshed manually — same pattern as the PSGC barangay list, no live API dependency in the pipeline.
2. **`poverty_incidence_muni`** — municipal SAE poverty incidence, nearest vintage to `D_start`, joined via the already-canonicalized municipality. One committed reference CSV (~44 rows × 3 vintages).
3. **`cmwpi_at_release`** (optional, Infrastructure rows only) — NCR CMWPI joined on release month, with the NCR-proxy caveat stated in Chapter 3 the same way `is_wet_season_release`'s proxy status is.

Deliberately excluded: regional GDP (annual, too coarse), wage indices (regional but weak theoretical link to slippage), anything requiring per-barangay economics (doesn't exist).

## Why static snapshots, not a live API client

The declared architecture mentions "PSA economic indicators" as external feeds, but a live OpenSTAT client adds a runtime dependency + failure mode for data that updates monthly at most, and PSA's portal blocks naive scripted access anyway. Committed, dated reference CSVs (manually refreshed, provenance in the file header) match the project's existing PSGC pattern, keep the pipeline reproducible offline, and are defensible at panel ("data as of X date").

## Not started pending Kirk's confirmation

Build effort once approved: small — two reference CSVs, one join function in feature engineering, Chapter 3 text. The manuscript already names PSA as a meta-learner input (line ~716 area), so whichever subset is approved should be reflected there too.
