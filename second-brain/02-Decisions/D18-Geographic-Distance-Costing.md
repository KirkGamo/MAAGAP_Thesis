---
tags: [decision, optimization, geography, objective-4]
status: active
created: 2026-09-28
updated: 2026-09-28
---

# D18: Real Geography — distance-priced cluster mobilization

## Context

`optimization_engine.py` has carried a written admission against itself since it was first written: `MUNICIPALITY_CLUSTERS` is *"NOT sourced from an authoritative PSGC/GIS boundary-adjacency dataset or a real road-network distance matrix … should be replaced with verified centroid-distance or shared-boundary adjacency data before this schedule is used operationally."*

Every cluster was also charged the same flat mobilization cost, regardless of how far it sits from the PPDO base.

PPDO's 2026-09 GIS export supplies the missing geometry.

## What the source actually is

`T_2026PROJILO26823_layer_TableToExcel.xlsx` — the fund-transfer worksheet spatially joined to the **LMB Iloilo barangay point layer**. 22,383 rows × 52 columns, `FID` unique, so the join duplicated nothing. Its twenty project columns mirror `fund_transfer_cleaned.csv` exactly: **no new project data**, just the existing source re-exported with geometry. Only the geometry was taken.

`POINT_X` / `POINT_Y` are WGS84 decimal degrees, verified by range (122.02–123.35 E, 10.48–11.62 N).

**PPDO's own attribute join was not reused.** It resolved only 12,419 of 22,383 rows (55%), and not from missing inputs — exactly 11 rows had a blank source barangay. The failures are unmatched barangay *names* (`POBLACION`, `MUNICIPALITY`, `BACAY SK`, `TUBURAN-SK`, `P.D. MONFORT SOUTH`), the same class of problem [[D13-Barangay-PSGC-Canonicalization]] solved with municipality-scoped canonicalization. The point layer was extracted and re-matched with the pipeline's own vocabulary instead.

## What was built

- `scripts/build_barangay_points_reference.py` → `reference/lmb_barangay_points_iloilo.csv`, committed alongside `psgc_barangays_iloilo.csv` per the project's reference-data convention. **1,342 barangay points across 43 municipalities.**
- `ml-service/common/geography.py` — centroids, haversine distances, and distance-priced cluster mobilization, degrading to the previous flat behaviour when the reference is absent.

Coverage, measured rather than estimated:

| | |
|---|---|
| Unique (municipality, barangay) points | 1,342, each key → exactly one point |
| Matching a PSGC barangay on a normalized key | 1,307 / 1,343 (97.3%) |
| Share of Iloilo's 1,895 PSGC barangays covered | 69% |
| Municipalities canonicalizing cleanly | 43 / 43 |
| Optimizer's 25-project candidate pool with a centroid | 100% |

**Iloilo City has no points, and that is correct rather than missing** — it is a highly urbanized city administratively outside the Provincial Planning and Development Office's remit.

## The defect this exposed

The flat charge was wrong by a factor of **6.3×**:

| Cluster | n | Base distance | Flat cost | Distance-priced | Intra-cluster spread |
|---|---|---|---|---|---|
| Central Metro | 8 | 14.3 km | ₱1,200 | **₱428** | 6.7 km |
| Western Upland | 10 | 27.8 km | ₱1,200 | ₱833 | 13.4 km |
| Eastern Lowland | 8 | 37.5 km | ₱1,200 | ₱1,125 | 11.2 km |
| Interior Passi Corridor | 9 | 40.6 km | ₱1,200 | ₱1,218 | 14.8 km |
| North Coastal | 9 | 90.1 km | ₱1,200 | **₱2,704** | 14.4 km |

North Coastal's centroid is more than six times as far from base as Central Metro's, and both cost the same.

**Incidental validation:** intra-cluster spreads of 6.7–14.8 km are well below the distances between cluster centroids, so the hand-drawn grouping holds up geographically. That is worth stating — it was a reasonable approximation, and the defect was in its *pricing*, not its membership.

## Measured effect

Same candidate pool, flat versus distance pricing, varying the weekly budget:

| Budget | Pricing | Visits | Risk weight | Clusters served |
|---|---|---|---|---|
| ₱12,000 | flat | 9 | 22.5 | includes North Coastal |
| ₱12,000 | distance | **11 (+22%)** | **26.0 (+15.6%)** | drops North Coastal for Central Metro |
| ₱20,000 | flat | 16 | 40.0 | 5 clusters |
| ₱20,000 | distance | 17 (+1) | 39.5 (−0.5) | 4 clusters |
| ₱60,000 | either | 25 | 50.5 | identical |

Under a tight budget the flat model spent scarce pesos reaching the province's most distant cluster because it appeared no more expensive than the nearest one. Priced properly, the solver covers **22% more projects and 15.6% more risk weight for the same money**.

Reported honestly: the gain is **not uniform**. At ₱20,000 the distance-priced solve takes one more visit but half a point *less* risk weight, because it is now optimizing true cost rather than a fiction. At ₱60,000 the budget does not bind and the two are identical — consistent with [[D17-Allocation-Efficiency-Measurement]]'s central finding that this problem only rewards optimization when a resource is actually scarce.

## Deliberately not done

**Cluster membership and names are unchanged.** Those names are stored on `inspector_schedules` rows in Supabase and rendered across the Schedule workspace, routing map, agenda pane, inspector view and deploy action. Re-drawing them geographically is a migration, not a calculation, and bundling it with a costing change would make neither evaluable. The spread figures above suggest the payoff would be modest anyway.

Barangay-level siting is also not done: the layer covers 69% of barangays, but `inference.csv` carries only `LOCATION` free text and canonical municipality — barangay exists in the processed data and is dropped before the ready set. Carrying it through `feature_engineering.py` is the prerequisite.

## Caveats to carry into Chapter 3

- Points are **barangay locations, not project sites**; a project is placed at its municipality's centroid. Describe derived figures as centroid-level approximations.
- Distances are **great-circle, not road-network**. Iloilo's road network follows the coast in places, so true travel exceeds these figures, most of all for North Coastal.
- `PPDO_BASE` (10.6969 N, 122.5644 E) and `TRAVEL_COST_PHP_PER_KM` (₱15/km) are **flagged placeholders** pending PPDO's own travel schedule, in the same terms as `VISIT_COST_PHP`.

## Related

- [[D17-Allocation-Efficiency-Measurement]] — found the optimizer's gain came from risk prioritization rather than routing; this addresses part of why
- [[D13-Barangay-PSGC-Canonicalization]] — the matcher reused here
- [[D04-Barangay-Veto-Crosswalk]] — why barangay-level identity is handled carefully in this project
