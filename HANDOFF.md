-- MAAGAP Project Handoff --
_Last updated: 2026-09-28 (PPDO GIS geometry integrated: the optimizer now prices travel by real distance; PAGASA weather PDFs received but NOT yet extracted -- see Section 3)_

This document briefs a new Cowork session on where MAAGAP stands right now, what was just fixed, what's still open, and the operational gotchas that have already cost real debugging time once. Read this before touching the ML pipeline or the frontend risk-display logic.

## 1. What This Is

MAAGAP is Kirk's undergraduate CS thesis: a predictive risk-assessment and resource-allocation tool for Philippine government (PPDO Iloilo Province) infrastructure/non-infrastructure project management. A Level 0/Level 1 stacking ensemble (Random Forest + XGBoost + LSTM -> Multinomial Logistic Regression) predicts a four-tier risk label (Low/Medium/High/Critical) from historical fund-transfer, liquidation, and monitoring records, and a PuLP linear-programming module prescribes inspector/resource allocation. Full stack and methodology conventions are in this Cowork space's project instructions -- read those first if they aren't already loaded.

## 2. Current Status (2026-07-31)

The ML pipeline, frontend dashboard, and Supabase backend are all functional and in sync as of the last `seed_supabase.py` run (real write, not `--dry-run`, completed successfully -- 3,625 project rows upserted). The methodology report (`MAAGAP_Model_Training_Testing_Methodology_Report.docx`, in the Thesis root) reflects the current model exactly -- headline numbers below are the real, final-run figures, not sandbox estimates.

**CURRENT headline metrics (retrained 2026-09-08 on D16's controlled status vocabulary, 87-feature set).** The pre-D16 figures immediately below are kept for comparison, not superseded quietly — D16 was a feature-encoding change with the target held fixed, so this is a controlled before/after:

| Model (test set) | accuracy | precision | recall | F1 | AUC-ROC |
|---|---|---|---|---|---|
| Random Forest | 0.849 → **0.827** | 0.883 → 0.851 | 0.829 → 0.821 | 0.855 → 0.836 | 0.914 → 0.907 |
| XGBoost | 0.924 → **0.923** | 0.952 → 0.953 | 0.904 → 0.902 | 0.928 → 0.927 | 0.976 → 0.976 |
| LSTM | 0.600 → **0.612** | 0.503 → 0.512 | 0.880 → 0.868 | 0.641 → 0.644 | 0.715 → 0.716 |
| Meta-learner | 0.895 → **0.886** | 0.865 → 0.848 | 0.876 → 0.876 | 0.871 → 0.862 | 0.959 → 0.957 |

Features 137 → 87. The small loss is concentrated in Random Forest, which had been memorizing 57 near-singleton typo-keyed one-hots; XGBoost is flat and the meta-learner is within this stack's usual run-to-run noise. This was predicted in writing before the retrain — see D16. Live tiers after the 2026-09-08 reseed: Low 628 / Medium 19 / High 4 / Critical 17.

**Pre-D16 metrics (run 2026-08-31, unrestricted hardware, post D14 manual labeling + D15 currency fix, 136-feature clean set):**
- Resolved/labeled population: 5,884 of 8,277 pipeline rows (71.1%) -- train 4,119 / test 1,765
- Random Forest: test accuracy 0.849, precision 0.883, recall 0.829, F1 0.855, AUC-ROC 0.915
- XGBoost: test accuracy 0.924, precision 0.952, recall 0.904, F1 0.928, AUC-ROC 0.976
- LSTM (n=1,451 train / 598 test): test accuracy 0.600, precision 0.504, recall 0.880, F1 0.641, AUC-ROC 0.715
- Meta-learner (Level 1, n=598 test): accuracy 0.895, precision 0.865, recall 0.876, F1 0.871, AUC-ROC 0.959
- Risk tier distribution (test): Low 325, Medium 59, High 27, Critical 187

Movement vs. the 2026-08-15 run (5,761 labeled): Random Forest is up materially (0.825 -> 0.849 accuracy, AUC 0.899 -> 0.915) and XGBoost up modestly (0.919 -> 0.924, AUC 0.977 -> 0.976 flat) -- consistent with D15 removing amount values that were distorting the feature scale, most notably a PHP 1.5 BILLION phantom row. LSTM is up (0.579 -> 0.600 accuracy). The meta-learner is essentially flat-to-slightly-down (0.903 -> 0.895 accuracy, AUC 0.967 -> 0.959) on a slightly smaller evaluation set (608 -> 598); within the run-to-run noise this stack has shown throughout.

**Supabase reseeded 2026-08-31 (step 7 complete)**: the `projects` table holds exactly the 2,393 rows in the current `inference.csv`, scored by the models retrained above. Live risk tiers: Low 614, Medium 26, High 9, Critical 19, and 1,725 unscored (no matching LSTM sequence -- the long-standing meta-learner coverage caveat, not a defect). The automatic orphan pruning added to `seed_supabase.py` ran for the first time here and worked as intended: it detected 124 of the 2,517 previously-live rows as no longer in the population, backed them up to `data/backups/` and deleted them, leaving zero orphans. `monitoring_reports` is still empty so nothing hand-entered was affected, and the single surviving `inspector_schedules` row is untouched -- the Schedule view stays near-empty until the PuLP optimizer is re-run, which remains a separate, not-yet-built seeding step.

## 3. Recent Major Fixes (most recent first)

**Real geography in the optimizer (2026-09-28, D18).** PPDO delivered `T_2026PROJILO26823_layer_TableToExcel.xlsx` -- the fund-transfer worksheet spatially joined to the **LMB Iloilo barangay point layer**. 22,383 rows x 52 columns, `FID` unique (no join duplication), and its twenty project columns mirror `fund_transfer_cleaned.csv` exactly, so it carries **no new project data**: it is the existing source re-exported with geometry. Only the geometry was taken.

**PPDO's own join was not reused** -- it resolved only 55% of rows, and not from missing inputs (exactly 11 blank source barangays). The failures are unmatched barangay NAMES (`POBLACION`, `MUNICIPALITY`, `BACAY SK`, `TUBURAN-SK`), the same class of problem D13 solved. The point layer was extracted and re-matched with the pipeline's own canonicalization: `scripts/build_barangay_points_reference.py` -> `reference/lmb_barangay_points_iloilo.csv`, **1,342 barangay points across 43 municipalities**, 97.3% matching PSGC on a normalized key, covering 69% of Iloilo's barangays and **100% of the optimizer's candidate pool**. Iloilo City has no points and that is correct, not missing -- it is outside PPDO's provincial remit.

**The defect this exposed:** every cluster was charged the same flat PHP 1,200 mobilization cost regardless of distance. Measured, that was wrong by **6.3x** -- Central Metro's centroid is 14.3 km from base (PHP 428 priced properly), North Coastal's is 90.1 km (PHP 2,704). `ml-service/common/geography.py` now prices each cluster by real round-trip distance. Under a binding PHP 12,000 budget this covers **11 projects instead of 9 (+22%) and 15.6% more risk weight for the same money**, because the flat model had been spending scarce pesos reaching the province's most distant cluster as though it were as cheap as the nearest. Reported honestly: the gain is not uniform -- at PHP 20,000 it takes one more visit but half a point less risk weight, and at PHP 60,000 the budget does not bind and the two are identical, consistent with D17's finding that this problem only rewards optimization when a resource is genuinely scarce.

Incidental validation: intra-cluster spreads (6.7-14.8 km) sit well below inter-cluster distances, so the hand-drawn `MUNICIPALITY_CLUSTERS` grouping holds up geographically. The defect was in its PRICING, not its membership. **Cluster names and membership are deliberately unchanged** -- they are stored on `inspector_schedules` rows in Supabase and rendered across the Schedule workspace, routing map, agenda pane, inspector view and deploy action; re-drawing them is a migration, not a calculation. `tests/test_geography.py`: 15 passing, including a lat/lon swap guard (a transposition would be silent and would place Iloilo in Somalia).

**PAGASA weather data received, NOT yet integrated (2026-09-28).** 23 PDFs at the repo root: daily precipitation 2015-2026 (12 files) and daily temperature 2016-2026 (11 files), Iloilo Radar station 98637, Jaro. One page per month. **Still to do:** extraction, QC, features, retrain -- see the integration plan for the full sequence. Two constraints that must survive into implementation:

- **The leakage trap.** `T_actual = Date of Completion - D_start`, so a weather feature aggregated over `[D_start, D_end]` has a window length equal to the project duration, which IS the label. Use an outcome-independent window -- `[D_start, D_start + T_standard]` is the natural one, since T_standard is 365/182 from project type and known upfront. This is the same failure mode that produced MAE 0.91 d / R2 0.9994 in the regression head before it was caught.
- **One station serves 44 municipalities.** Weather varies by date only, never by location, and the model already carries `Year`, `release_month`, `release_quarter`, `days_since_release` on the same date axis. Judge the block on an ablation against those, not on plausibility, and expect a small effect.

Also note `second-brain/05-Known-Issues/Issue-Climate-Data-Coverage-Gap.md` recorded that PAGASA's request form capped the end date at 2024-12-31; **the delivered data runs through 2026**, so that issue is largely resolved and should be closed or rewritten.


**Objectives closeout pass (2026-09-13, branch `fix/risk-tier-consistency`).** A verification of the manuscript's six objectives against the code found one fully met (Obj 5), one substantially met (Obj 3), three partial (Obj 1, 2, 4) and one not started (Obj 6). Work on four of them, plus three latent defects found along the way.

- **Obj 3 -- risk tiers now have ONE definition.** `probability_to_risk_tier()` was defined three times independently (`train_meta_learner.py`, `optimization_engine.py`, `inference/live_scoring.py`). They agreed, but only by hand, and nothing would have raised an error if they diverged. All three now import `ml-service/common/risk_tiers.py`, and `tests/test_risk_tiers.py` (38 passing) asserts the **identity** of the shared function rather than sampled equality -- sampling would pass with three copies that happen to agree. **Latent defect fixed:** every copy was a bare comparison ladder, and since all comparisons against NaN are False, `NaN` fell through to `return "Critical"` -- the most severe tier, carrying the optimizer's heaviest risk weight (2.5). An unscoreable project would have outranked genuinely critical ones for a real inspector visit. Out-of-range values fell through identically (1.5 -> Critical, -0.2 -> Low). Now rejected explicitly. `scripts/check_tier_consistency.py` verifies stored vs. recomputed tiers against live Supabase: **668 scored rows, all consistent**.

- **Obj 2 -- MAE now exists.** `models/train_regressors.py` trains RF + XGBoost regressors on `delay_days = T_actual_days - T_standard_days`, same 70/30 split and folds as `train_trees.py`. **Headline: XGBoost test MAE 86.4 days** (RF 91.5), against a train-median constant baseline of 330.4 d -- skill 73.9%. Three reporting decisions: the 1,159 Phase 8 clamped rows are EXCLUDED from the headline (their T_actual is pinned to D_start+1 by mechanism; including them halves the apparent target, median 137 d -> 13 d), a constant-predictor baseline accompanies every MAE, and the direct-date subpopulation is reported separately. **That last number is the finding:** on the 91 test rows with a directly observed completion date, MAE nearly doubles to 164 d and R2 goes NEGATIVE (-1.10). This is the first quantification of the pipeline's proxy-date dependence -- the model is substantially learning the recovery mechanism rather than delay itself. Surfaced on the Models tab at equal weight, not as a footnote.

- **Obj 4 -- budget + equipment constraints added, and the 15% claim MEASURED AND FOUND UNSUPPORTED.** See `second-brain/02-Decisions/D17-Allocation-Efficiency-Measurement.md` for the full record. The LP now carries a weekly budget ceiling and a vehicle cap (4 vehicles against 6 inspectors; the vehicle pool reuses the existing `sum_c y[i][d][c]` deployed indicator, needing no new variables). Cost figures are flagged PLACEHOLDER pending PPDO confirmation, in the same terms as `MUNICIPALITY_CLUSTERS`. `allocation_evaluation.py` adds an efficiency metric (risk weight per inspector-day, **declared before measuring**), three greedy baselines enforcing the optimizer's own feasibility rules, a capacity-scarcity sweep, and Monte Carlo.

  **Two defects surfaced by measuring.** (1) The optimizer was **25% WORSE** than every baseline: its objective had no term for inspector-days consumed, so once coverage saturated it was indifferent between covering 25 projects in 9 inspector-days or 12, while greedy first-fit packs days tight as a side effect. Fixed with `INSPECTOR_DAY_PENALTY`; the metric was NOT changed. (2) `risk_ranked` was mis-specified as manual practice -- it orders by `meta_prob`, MAAGAP's own output, which PPDO cannot produce.

  **Result: the 15% target is not met.** Monte Carlo (40 reps, 2 inspectors): mean improvement +4.8% vs sequential, +7.1% vs random, +8.6% vs risk_ranked; every 90% interval touches zero at its lower bound; the target is cleared in only 10-22.5% of replications. The deterministic +25%/+33% figures exist at exactly one point (1 inspector, demand/capacity 1.67) and are not robust. The measurable gain comes from **risk prioritization -- the predictive half -- not from the integer program**, whose actual contribution is certified optimality and declarative constraint handling. **Note the measurement is coverage-limited:** the pool is 25 projects only because 25 ongoing projects have both a tabular row and an LSTM sequence, against 2,393 rows in `inference.csv`. The slack regime is an artifact of meta-learner coverage, not PPDO's real workload -- improving LSTM coverage is a precondition for the optimizer to demonstrate value. **Needs an adviser decision before Chapter 4.**

- **Obj 6 -- ISO/IEC 25010 now has an instrument and a methodology.** `docs/ISO25010_Evaluation_Instrument.md`: 29 Likert items mapped to sub-characteristics of Functional Suitability, Usability and Reliability, role-tagged across the manager/inspector surfaces, with scripted tasks, administration protocol, pre-declared interpretation scale and consent handling. Chapter 3 gained the matching methodology section. **Administration remains blocked on a deployed build and PPDO respondents.**

- **Manuscript corrections (4 commits).** NSGA-II was described across a full subsection with crossover/mutation parameters while the Delimitation excluded heuristics and the code used PuLP/CBC -- replaced with the solver actually used, retaining refs [39][40][41][43][61] as considered-and-excluded so the bibliography numbering stays stable. The Risk Classification Framework claimed risk scores were "weighted combinations of delay probability, cost overrun probability, and project strategic importance" (none of the three is true; it is a single P(RedFlag=1)) and claimed automatic tier-transition alerts (no notifications backend exists -- `notification-bell.tsx` says so itself). Optimization Evaluation now specifies the metric, the baselines and the simulation instead of listing three unspecified bullets.

**Still open from the objectives pass:** Obj 1's PAGASA and PSA integrations (zero of 87 features are external; `scripts/fetch_psa_data.py` exists but nothing imports it), contractor features remain synthetic, and **cost-overrun prediction is not constructible from the data** -- the fund-transfer ledger holds releases and liquidations, not contract-vs-final cost; only 65 of 12,755 rows (0.51%) show liquidated > released, against 8,167 (64%) under-liquidated. Objectives 1 and 2 should be amended to schedule delay unless PPDO supplies revised contract costs. The 5 unassigned optimizer slots are deliberately untouched (production data).


**Reporting loop closed + D16 status encoding, retrained (2026-09-08, branch `feat/reporting-loop`).** Two things, one of them a real bug. (1) **The field-reporting loop was broken at its most important step, silently.** `submitReport` ran as the signed-in inspector, but `projects` carries only manager `FOR ALL` and inspector `FOR SELECT` policies, so its status/completion UPDATE matched zero rows and PostgREST returned **no error** — verified live before the fix (`rows affected: 0 | error: none`). A project reported Completed in the field stayed On-going on every manager screen forever, while the webhook still moved `risk_tier` through the service role, so the two halves of the same event disagreed. The write now happens server-side with the service-role client behind an explicit assignment check (an RLS grant was rejected: policies gate rows, not columns, so it would have let a field device write `risk_tier` or `amount_php`). Also fixed a `toISOString()` date bug this surfaced, which dated completions a day early in UTC+8 — that value feeds `T_actual` and therefore RedFlag; local-date formatting now lives in `frontend/src/lib/local-date.ts` and `currentWeekMonday()` uses it too. Alongside: re-score outcomes are recorded and retryable (`add_monitoring_reports_rescore_state.sql`, **needs running by hand** — everything degrades gracefully until then), the Reports tab is a single-viewport master-detail that signs one report's photos instead of up to 200 per render, inspectors can file for any assigned project and see their own submission history, and visits can be backdated with offline-tolerant submit. (2) **D16: observed status replaces percent complete as the retraining signal** — see `second-brain/02-Decisions/D16-Observed-Status-Feature-Encoding.md` for the full record. 57 of the old model's 137 features were one-hots over raw free text including typo-keyed near-singletons; they are now 7 canonical labels plus 3 condition flags. **Retrained 2026-09-08 with the target held fixed** (checkpoint identical: 5884/8277, 1159 clamped, train 4119 / test 1765, meta-learner 1,451 rows), so the before/after below is a controlled comparison of encodings. Supabase reseeded; pre-D16 artifacts preserved at `ml-service/artifacts_pre_d16/`. The `rescore_state` migration was applied 2026-09-08 and the tracking columns are live. The methodology report was regenerated the same day as **Rev. 4** by the new in-repo `scripts/build_methodology_report.py` (Section 8), which now reads every figure from the artifacts instead of transcribing them.

**Inspectors tab rebuilt as a roster-readiness console (2026-09-08, branch `feat/inspectors-roster`).** The tab was a four-column table (name, joined, a free-text optimization-slot box, status) that said nothing about the one fact governing whether the prescriptive half of the system works: the optimizer allocates to numbered roster slots, and a slot with no profile bound to it silently drops its share of every solve at deploy time. Slots are now the page's primary objects. It leads with the readiness headline — currently **"1 of 6 optimizer slots filled — 21 of the latest solve's 25 visits cannot be deployed to anyone"** — and each empty slot card names its own cost (`Inspector_4` alone is holding 12 undeployable visits), so the gap is both visible and prioritized. Filled slots show their holder's deployed load for the current week as a per-weekday strip against the solver's 3/day and 12/week assumptions (mirrored in `manager/schedule/capacity.ts`). The slot list is read from the ML service's `summary.inspectors_used`, never a hardcoded `Inspector_1..6` — the roster size lives in `optimization_engine.py`, and the fetch is best-effort so the roster still renders from Supabase alone when the service is offline. Editing moved to reveal-on-click from both directions (an empty slot offers unrostered people; an unrostered person offers free slots, marking taken ones), the free-text slug box survives only as the offline fallback, `slug-field.tsx` is deleted, the invite form became a slide-over so it can't push the pinned layout, and deactivating someone who holds visits this week now warns that those visits stay assigned rather than being reassigned. Verified by driving the live UI through a clear→reassign round-trip (headline correctly moved 1/6→0/6 with 25 of 25 undeployable, then back) that left Supabase exactly as found; fits 1366×768 and 1440×900 with no scrolling.

**Schedule workspace + in-app optimizer runs (2026-09-08, branch `feat/schedule-workspace`).** The Schedule tab was rebuilt as a single-viewport workspace, and the biggest hole in the product loop was closed: running the optimizer no longer requires a terminal. (1) New `POST /api/v1/run-optimizer` on the ML service starts a full scoring + PuLP solve as a FastAPI background task (secret-guarded like the monitoring webhook, 409 while one is in flight with a 30-minute stale guard), writing `artifacts/optimizer_run_status.json`; `GET /api/v1/optimizer-status` serves progress, and `latest-schedule` now also returns `generated_at`. The frontend's "Run optimizer" button polls it, survives navigating away mid-run, and shows a "Last optimized Xh ago" freshness line. **Verified end-to-end on 2026-09-08**: a real run started from the UI finished in 3m47s with `Optimal`, 25/25 projects scheduled (100% coverage), 17 Critical, 5 clusters, all 6 inspector slots used — a materially different solve from the stale 2026-07-27 artifact it replaced (72/150, 48% coverage), because it scored against the post-D14/D15 retrained models. (2) The page itself now pins to the viewport with no scrolling at 1366x768 and up: a top strip (week/deploy status, optimizer scorecard, actions), day tabs carrying per-day counts and Critical/High dots, then a two-pane body — routing map (fills its pane, `ResizeObserver` + `invalidateSize`, replacing a fixed 460px) beside one day's agenda grouped by inspector with capacity chips against the solver's own 3/day, 12/week assumptions (mirrored in `manager/schedule/capacity.ts` — keep in sync with `optimization_engine.py`). Default view is one day, not the whole week; "All" swaps in a compact inspector-by-day count matrix. Deleted: `schedule-board.tsx`, `day-filter.tsx`, `schedule-editor.tsx`. (3) Editing moved inline (click a visit -> reassign/move/remove popover) with a searchable project picker replacing the old raw project-key input, and deploy now confirms before replacing a week — including how many optimizer rows will actually land. **That confirmation immediately earned itself**: the current optimizer output maps to only 4 of 25 rows because 21 carry `Inspector_N` slots with no `profiles.inspector_slug` assigned. Assigning the remaining slots on the Inspectors tab is the single highest-value unblock for the Schedule feature. (4) Fixed a real timezone bug in `lib/current-week.ts` (see Section 7).

**Live Supabase state note**: `inspector_schedules` now holds 4 deployed rows for the week of 2026-09-07 (from the verification run above), plus 1 row under the pre-fix week label 2026-09-06. `artifacts/inspector_schedule.csv` was regenerated on 2026-09-08 and is no longer the July solve.

**D14 manual project-type overrides + D15 currency-coercion fix (2026-08-31).** Two changes, retrained and documented together. (1) D14 added an authoritative hand-maintained override tier ahead of the keyword heuristic and the D12 classifier, plus an auto-regenerated ranked worklist of whatever remains Unclassified. Kirk labeled 209 distinct names, clearing 248 of the 251 residual rows: Unclassified 2.9% -> **0.0%**, with only 3 rows left that are unlabelable in principle (an Excel serial "45701" typed into the name cell, one near-empty placeholder, and a real PHP 5.9M PEO project with a blank name). Verification of that labeling pass fixed a trailing-comma formatting fault that would have silently applied ZERO overrides, flipped 26 entries contradicting the convention already set by the 7,110 keyword-classified rows (water system 231/231, dumpsite 52/52, slope protection 10/10, riprap 8/8, electrification 5/5, culvert 3/3 all Infrastructure), and resolved 2 case-only conflicts. (2) D15 fixed `_coerce_single_currency()`, which stripped non-digits and therefore both DISCARDED magnitude suffixes (" 1.760 M" -> 1.76 instead of 1,760,000; 46 rows, ~PHP 110M, 19 in the training set) and CONCATENATED trailing funding annotations into the number -- one row reading "150,0" + newline + "20% NTA CY 2025" became a phantom **PHP 1,500,202,025** project, the largest in the dataset, from a row worth PHP 1,500. Rewritten around an explicit numeric region with 21 unit cases and a full-column old-vs-new diff (172 cells changed, **0 newly-NaN**). Net effect: labeled population 5,761 -> 5,884, and Random Forest improved 0.825 -> 0.849 test accuracy (AUC 0.899 -> 0.915), consistent with removing values that were distorting the feature scale. See `D14-Manual-Project-Type-Overrides.md` and `D15-Currency-Coercion-Magnitude-Suffix.md`. **Supabase reseed still pending** -- see Section 2.

**D12 supervised project-type classifier + D13 barangay PSGC canonicalization (2026-08-15, same day as Phases 9-11 below).** Closed the two data-quality gaps the original audit's Section 6 proposed but v2 implementations only partially delivered. (1) DQ-7: the keyword heuristic left 19.1% of monitoring rows Unclassified -- a hard ceiling on the labeled population since Unclassified rows have no T_standard. Trained the audit-recommended TF-IDF + logistic-regression classifier on a 550-name hand-labeled stratified sample (committed at `ml-service/data_pipeline/reference/project_type_labels.csv`; the model deliberately retrains at run time from that CSV rather than shipping a pickle). Integrated as a CONFIDENCE-GATED FALLBACK only (threshold 0.7, where its held-out accuracy of 98.9% matches the keyword heuristic's own ~99%): heuristic stays the auditable fast path, classifier only touches heuristic-Unclassified rows, below-threshold rows abstain rather than guess, and a new `project_type_source` column ("keyword"/"classifier"/"unclassified") marks every row's evidentiary basis end-to-end. Unclassified: 19.1% -> 2.9%. (2) Barangay strings are now validated against the official 1,901-entry PSGC reference for Iloilo's 44 LGUs (`reference/psgc_barangays_iloilo.csv`, exported 2026-08-15), municipality-scoped because bare barangay names repeat across LGUs; crosswalk linkage 18.7% -> 19.8%. Combined net effect: labeled population 4,804 -> 5,761 (+19.9%), labeled LSTM sequences 1,581 -> 2,004. See `second-brain/02-Decisions/D12-Project-Type-Classifier.md` and `D13-Barangay-PSGC-Canonicalization.md`. **Retraining still pending** (see Section 2's staleness note).

**Phases 9-11 -- Data-quality cleanup: study-period floor, direct-date credibility check, exact-duplicate removal (2026-08-15).** A verification pass on the climate-data-coverage-gap known issue surfaced three previously-undetected data-quality issues, investigated and fixed together: (1) 3 labeled rows with `D_start` 8-13 years before every peer in their own monitoring batch, isolated by a genuine gap in the raw data (zero rows anywhere in 2011/2012/2014) -- `STUDY_PERIOD_START = 2015-01-01`; a first attempt using Chapter 1's stated "2016-2025" as the cutoff was tried and rejected mid-implementation for also sweeping up 381 legitimate 2015 rows with no evidence of error (see D09). (2) 120 labeled rows where a DIRECTLY-observed completion date was on-or-before D_start (non-positive duration, RedFlag=0 by construction) -- no equivalent check previously existed for direct dates, only proxies (Phase 6/8); non-credible direct dates are now discarded and re-routed through the existing proxy-recovery machinery (see D10). (3) 503 exact-duplicate raw monitoring rows (full population) confirmed via distinct `mon_row_id` to be genuine duplicate ledger entries, not a crosswalk/join artifact -- deduplicated (`keep="first"`), full pipeline scope; LSTM sequence data is a known, called-out exception (see D11 for why). A necessary prerequisite surfaced during implementation: `mon_row_id` had to be moved to load time (before any row-drop) to avoid silently desynchronizing from the crosswalk's positional keys -- verified via a project_key-linkage-rate regression check. Net effect: labeled population 5,159 -> 4,804. Implemented in `ml-service/data_pipeline/feature_engineering.py`'s `construct_target_variable()`/`run()`; decisions recorded in `second-brain/02-Decisions/D09-Study-Period-Floor.md`, `D10-Direct-Date-Credibility-Check.md`, `D11-Exact-Duplicate-Removal.md`. **Not yet done:** retraining (steps 4-6) and Supabase reseed -- deliberately held back as a separate approval since it touches production data and headline metrics (see Section 2's stale-metrics note above).

**Phase 8 -- Proxy-completion-date clamp (prior session).** Phase 7's empirical lag correction (median 267.5 days, subtracted from every recovered proxy completion date) occasionally pushed a short-duration project's corrected date back before its own D_start -- non-credible, previously left unresolved. Splitting the ~2,362 affected rows found two distinct causes: 1,260 rows where the RAW (uncorrected) proxy date is genuinely after D_start -- a real event exists, only the flat correction over-shoots -- now clamped at `D_start + 1 day`. A further 1,102 rows where the raw proxy date already precedes D_start before any correction at all -- no real event to anchor to -- deliberately left unresolved, never clamped. Clamped rows are marked `completion_date_is_clamped=True` in `data/ready/train.csv`/`test.csv`; their RedFlag is 0 by mechanical construction (T_actual pinned to 1 day, always below any T_standard), **not observed evidence of on-time completion** -- this is called out in `feature_engineering.py`, `train_trees.py`'s logging, and the methodology report (Section 3.1, Section 8). Implemented in `ml-service/data_pipeline/feature_engineering.py`'s `construct_target_variable()`, committed `ef2e581`.

**Barangay-veto crosswalk fix (prior session).** `build_project_crosswalk()` in `preprocess.py` previously matched fund-transfer rows to liquidation/monitoring rows on (project name, municipality, fiscal year) alone. Generic, recurring project names ("Streetlights", "Monoblock Chairs", "Socio Cultural Activities") recur across different barangays in the same municipality/year, so this key wasn't unique -- a real case merged two distinct "Public Address System" projects in different Tubungan barangays into one `project_key`. Fixed by adding a barangay-level veto (`_barangay_conflicts()`, `BARANGAY_MATCH_SCORE_CUTOFF = 70`) to the cascading exact/fuzzy match. This correctly shrank the crosswalk's linkage rate (~35% -> 18.7%) -- a smaller but honest crosswalk, not a regression. Committed `586a743`.

**SHAP explainability for the tree-based base learners (2026-07-30).** Objective 4 / Chapter 3 of the manuscript commits to per-project SHAP interpretability. Implemented in `ml-service/inference/explain.py`: `shap.TreeExplainer` on Random Forest and XGBoost only (`model_output="probability"`, shared background sample from `train.csv`) -- deliberately excludes the LSTM (sequence models are a poor fit for tree-based SHAP explainers) and does not claim a formal decomposition of the full three-model stack's meta-probability. Wired into both paths that write `risk_tier`/`risk_probability` to Supabase -- `optimization_engine.py`'s `score_tabular()` (batch path behind `seed_supabase.py`) and `inference/live_scoring.py`'s `score_project()` (live per-project rescore on monitoring updates) -- both best-effort, a SHAP failure never blocks the underlying risk score. New `shap_top_features` jsonb column on `projects` (migration + `schema.sql`), rendered as a bar chart on the frontend project detail page. Committed `52caf57`; two same-day follow-up fixes: `0f686c2` (NaN in `shap_top_features` was crashing `_clean_nan()`, which called `pd.isna()` indiscriminately on list/dict values) and `5326eac` (SHAP/XGBoost `base_score` incompatibility patch).

**"Refunded" status + last-monitored date.** Fund-transfer rows whose funds were returned (not liquidated against completed work) were previously silently mapped to `on_going`, which is misleading. Added a proper `refunded` enum value across the DB schema, TypeScript types, badges, filters, and `optimization_engine.py`'s scheduling-exclusion logic (renamed `status_confirms_completed` -> `status_excludes_scheduling`, now also excludes refunded projects from `select_priority_projects()` while still surfacing their risk tier on the dashboard). Also added `date_last_monitored` end-to-end (schema, types, PPA cards, table column, CSV export) sourced from the monitoring sheet's DATE MONITORED column, not the app's own `monitoring_reports.visited_at`.

**Universal proxy-completion-date recovery (Phase 6/7, older).** Projects with STATUS confirming completion but no direct `Date of Completion` get a proxy date (latest recorded monitoring visit or linked liquidation submission), corrected by an empirically-calibrated median lag (this is what Phase 8 refines further). ~92-94% of the labeled population relies on this proxy mechanism -- always caveat metrics accordingly.

## 4. How to Re-run the ML Pipeline

Run from `ml-service\` unless noted. **Do not use the scripts' bare defaults from this directory** -- their relative-path defaults (e.g. `../../data/ready/train.csv`) assume you're inside `ml-service\models\`, not `ml-service\`, and will fail with "Required input not found" if you don't override them (this bit us once already this project).

```powershell
# 1. Only if raw source data changed:
python data_pipeline\preprocess.py --input "..\data\raw\Copy of 2022 conso Fund Transfer worksheet   (2).xlsx" --output-dir "..\data\processed"

# 2. Only if raw source data changed (regenerates synthetic contractor data):
python data_pipeline\generate_synthetic_data.py   # check its own --help for exact args

# 3. Always needed after any feature_engineering.py / preprocess.py change:
python data_pipeline\feature_engineering.py --monitoring-input ..\data\synthetic\monitoring_with_contractors.csv --contractors-input ..\data\synthetic\contractor_profiles.csv --fund-transfer-input ..\data\processed\fund_transfer_cleaned.csv --liquidation-input ..\data\processed\liquidation_cleaned.csv --crosswalk-input ..\data\processed\project_crosswalk.csv --output-dir ..\data\ready

# 4. Train Level 0 tabular learners (note explicit paths -- see gotcha above):
python models\train_trees.py --train-csv ..\data\ready\train.csv --test-csv ..\data\ready\test.csv --artifacts-dir artifacts

# 5. Train Level 0 LSTM (also explicit paths; this is the slow step, ~5-10 min at full defaults):
python models\train_lstm.py --sequences ..\data\ready\lstm_sequences.npy --mask ..\data\ready\lstm_sequence_mask.npy --project-keys ..\data\ready\lstm_project_keys.json --train-csv ..\data\ready\train.csv --test-csv ..\data\ready\test.csv --artifacts-dir artifacts

# 6. Train Level 1 meta-learner (no args needed -- paths are computed from __file__, always correct):
python models\train_meta_learner.py

# 7. Seed Supabase (run from the REPO ROOT, not ml-service -- scripts/ lives there).
#    Upserts the current inference.csv population, THEN deletes any projects row
#    no longer in that seed (backing it up to data/backups/ first) -- see the
#    orphan-accumulation note in Section 2. --dry-run reports the orphan count
#    without writing; --no-prune skips the delete step.
cd ..
python scripts\seed_supabase.py --dry-run    # inspect sample row + orphan count first
python scripts\seed_supabase.py              # real write (upsert + prune)
```

**Verify after step 3**: the log line `Step 6: labeled N/D rows (...), of which M recovered via a Phase 6 proxy completion date (... K of those via the Phase 8 D_start+1 clamp)` should read N=5884, D=8277, K=1159 (train 4,119 / test 1,765). History of this checkpoint: N=5159/8784, K=1260 before the 2026-08-15 DQ-9/10/11 cleanup; N=4804/8278, K=1159 after it; N=5761 after the same-day D12 project-type-classifier recovery unblocked ~950 formerly-Unclassified rows; N=5884 after D14's manual labeling and D15's currency fix (see D09-D15 in `second-brain/02-Decisions/`). Also verify preprocess (step 1) logs `Unclassified: 0.0% of monitoring rows` and a `project_type_source breakdown` of `{'keyword': 7110, 'classifier': 1423, 'manual': 248, 'unclassified': 3}`. If these numbers drift beyond what a further data-quality fix explains, something upstream changed and needs investigating before continuing.

**Verify after step 6**: `train_meta_learner.py`'s log should say `Meta-learner training set: 1,451 rows` (1,124 before D13's barangay canonicalization, 1,396 before D14's manual labeling; see Section 2). If it says something smaller/different, steps 4-5 didn't actually write fresh artifacts (check they didn't abort) and the meta-learner trained on stale OOF predictions.

**Running the ML service: its credentials live in `ml-service/.env`.** Just start it — no exports needed:

```powershell
cd ml-service; python -m uvicorn main:app --reload --port 8000
```

`main.py` loads `ml-service/.env` at startup (gitignored; copy `ml-service/.env.example` to create it) and logs how many variables it read. Anything already exported wins over the file, so a CI secret or container environment is never overridden. Three variables matter: `ML_SERVICE_WEBHOOK_SECRET`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — note the rename, `SUPABASE_URL` is called `NEXT_PUBLIC_SUPABASE_URL` in `frontend/.env.local`, which is the usual way this ends up half-configured.

Why it matters: without them the service still starts and still scores, but **every write-back is a silent no-op** — the live re-score never reaches `projects.risk_tier` (`_maybe_patch_supabase`) and a monitoring report never leaves "Awaiting re-score" (`_mark_rescore_state`), while everything looks healthy. Verified 2026-09-08 in both directions: a report stayed `pending` forever against a credential-less service and resolved to `done` immediately against a configured one. Missing credentials now produce a startup warning naming the fix, and the loader itself was verified from a shell with all three variables explicitly cleared.

## 5. Sandbox Constraints (if working in the Cowork sandbox, not the user's machine)

- Hard 45-second timeout per shell command, non-configurable.
- Each shell call runs in a **fresh process namespace** -- backgrounded processes (`nohup ... &`, `setsid`, `disown`) do NOT survive between tool calls, even though the filesystem does persist. There is no way to background a long-running job across calls in this environment.
- Practical implication: LSTM training must either be reduced to fit one 45s call (few epochs, small folds -- fine for a pipeline smoke-test, NOT fine for final metrics) or run on the user's own machine. Never write sandbox smoke-test numbers into the methodology report as if final -- mark them stale/pending and get the user to run the real thing.
- pandas must stay below 3.0 for this pipeline -- `feature_engineering.py`'s dtype handling was validated on pandas 2.x only; pandas 3.0 broke it.

## 6. Git Conventions

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Clear a stale `.git/index.lock` / `.git/HEAD.lock` **before** attempting a git write, not just after one fails.
- Report `.docx`/`.pdf` deliverables at the Thesis root are intentionally left untracked (not gitignored, just never `git add`ed) -- matches established pattern of treating them as presented outputs, not source.

## 7. Known Limitations Still On the Books

- ~94% of the labeled population is proxy-dated, not directly observed -- every metric should be read as "ensemble performance under the current proxy-date methodology."
- 1,260 rows (1,026 in train/test) have a Phase 8 clamped completion date -- RedFlag=0 for these is a construction artifact, not evidence. `completion_date_is_clamped` marks them if anyone wants to exclude and re-measure.
- LSTM base learner is high-recall/low-precision (0.894/0.468 test) -- noisy on its own; the meta-learner's logistic regression appears to lean on RF/XGBoost's cleaner signal to keep ensemble metrics stable, but this asymmetry is worth a sentence if asked about it at defense.
- Contractor features are still synthetic placeholder data (150-contractor table, no real PhilGEPS/PPDO linkage) -- Chapter 1's declared Data Availability limitation, unchanged.
- Barangay-level source data still isn't canonicalized the way municipality is -- residual cross-barangay conflation in the crosswalk cannot be fully ruled out even after the veto fix.
- Unclassified project type (19.1% of all monitoring rows) can never be labeled -- no defined T_standard.
- `week_of` was shifted one day back for every schedule deployed before 2026-09-08: `currentWeekMonday()` computed the Monday in local time but serialized it with `toISOString()`, which converts to UTC first, so in UTC+8 a local Monday 00:00 became Sunday. Fixed to format from local date parts. Rows written earlier still carry the shifted date and read as that earlier week — harmless, but don't be confused by a `week_of` that lands on a Sunday.
- **The roster is the binding constraint on the whole prescriptive pipeline.** Exactly one inspector profile exists (Test Inspector → `Inspector_1`) against the solver's six slots, so 21 of the latest solve's 25 visits cannot be deployed to anyone. Not a defect — there are simply no people for slots 2-6 — but nothing downstream can improve until real inspectors are invited and given slots. As of the 2026-09-08 rebuild the Inspectors tab states this on landing and shows which empty slot costs the most, so it no longer has to be rediscovered at deploy time.
- Climate data coverage gap: the PAGASA weather data request is capped at 31 Dec 2024 (PAGASA's own form limit); 189 of 5,159 labeled rows (3.66%, split-balanced train/test) fall in 2025 and will keep the coarse `is_wet_season_release` proxy instead of real rainfall/wind data once PAGASA data lands. Footnote-scale, not a design concern.

## 7b. Deployment

Full runbook: `docs/DEPLOYMENT.md`. The essentials, because two of them are
non-obvious enough to lose an afternoon to:

- **Build the image from the repository root, never from `ml-service/`:**
  `docker build -f ml-service/Dockerfile -t maagap-ml:latest .` The service
  resolves `DATA_READY_DIR = REPO_ROOT / "data" / "ready"`, so `data/ready/`
  sits *above* `ml-service/` and is outside a context rooted there. The image
  mirrors the repo layout (`/app/ml-service` + `/app/data/ready`) rather than
  flattening it, so paths are identical locally and deployed.
- **The models are baked into the image.** `artifacts/` and `data/ready/` are
  gitignored, so a container built from a clone has no models at all. The
  Dockerfile enumerates the ~15 MB the service actually loads — not
  `artifacts/` wholesale, since the two `*_regressor.joblib` files are 39.8 MB
  of training output that nothing at runtime opens.
- **`ml-service/common/runtime_assets.py` verifies this at startup and refuses
  to start** when a required file is missing, naming the file and the script
  that produces it. Without it a model-less container imports cleanly, answers
  `/health` with `{"status": "ok"}`, passes its readiness probe, and fails on
  the first real request from inside `joblib.load()`.
- **One uvicorn worker, and it is load-bearing** (R3).
  `artifacts/optimizer_run_status.json` is read and written with no locking, so
  the optimizer's 409 "already running" guard only holds within one process;
  with two workers both see `idle`, both start a multi-minute CBC solve, and the
  second to finish overwrites the first's schedule. The in-process rate limiter
  divides the same way. Do not raise `--workers` without first moving run state
  into Supabase.
- **The ML service cannot be serverless.** An optimizer run returns 202 and
  keeps working in-process for minutes; a platform that freezes or recycles the
  process after the response kills it halfway and leaves a `running` status
  nothing will clear.
- **`requirements-runtime.txt` is pinned exactly, deliberately** — the image
  ships models pickled by scikit-learn 1.9.0 / xgboost 3.3.0 / Keras 3.15.
  Floor constraints would make a rebuild a silent, untested model change, and
  the bad outcome is not an exception but a model that loads and scores
  *differently* than it did in evaluation. Bump the pins with a retrain, not on
  their own. It also drops `openpyxl`, `rapidfuzz` and `pdfplumber`, which are
  ingest-time only (verified by import analysis of the runtime modules).
- **Results are written to `ML_SERVICE_OUTPUT_DIR`, not `artifacts/`** — new in
  `ml-service/common/paths.py`. The four mutable files (`inspector_schedule.csv`,
  its summary, `optimizer_run_status.json`, `live_scores.json`) moved out so a
  persistent volume can hold them without shadowing the models. Mounting a volume
  over `artifacts/` would appear to work and be a serious bug: Docker fills an
  empty named volume from the image once and never refreshes it, so a rebuild
  with a retrained model would keep scoring with the OLD weights while reporting
  the new image's version. The variable defaults to `artifacts/`, so local
  development and the test suite are unchanged; only a deployment sets it. The
  image also leaves `artifacts/` root-owned, making the models read-only to the
  service.
- **Host is a VPS running Dokploy**, config at
  `deploy/dokploy/docker-compose.yml`. TLS is mandatory, not optional: the shared
  secret travels in the `X-Webhook-Secret` header, so plain HTTP puts it on the
  wire in cleartext. Terminate at Dokploy's Traefik and never add a `ports:`
  mapping, which would publish `:8000` past the proxy. Note that Vercel calls
  the VPS over the public internet and static egress IPs are not available on
  its lower plans, so HTTPS + the secret + the rate limiter are the whole of the
  access control — adequate here, but worth stating rather than assuming.
- **Reseeding is not a rollback.** `scripts/seed_supabase.py` prunes rows no
  longer in the population it is given, so running it against a different
  population deletes rather than restores. Recover from a Supabase backup.
- Tag every image (`maagap-ml:<git-sha>`) or there is nothing to roll back to.
  Because the models live in the image, an image rollback *is* a model rollback.

- **The CBC solve is time-capped and currently saturates its cap, which makes
  the schedule host-dependent.** `SOLVER_TIME_LIMIT_SECONDS = 60` is wall-clock,
  and a measured full run on the development machine used 60.2s of it (100%, 89
  candidates, 2,670 binary vars). CBC returns the best solution found at the
  buzzer, not a proven optimum. A slower or burstable vCPU therefore produces a
  *worse schedule with no error* — nothing fails, the allocation is just less
  good and the output does not say so. Two consequences: provision dedicated
  vCPU rather than shared/burstable, and note that Chapter 4's efficiency
  figures were measured under this budget on this hardware, so the same inputs
  on different hardware can yield a different schedule. Check the solver's
  "Ns of the 60s cap" log line on the deployed host before trusting its output,
  and raise the cap or lower `MAX_PROJECTS_CONSIDERED` (150) if it is starved.
- Measured resource profile of a full optimizer run, for sizing: peak 485 MB
  resident (335 MB of that is imports alone, TensorFlow 187 MB of those), 73s
  wall clock end to end, image ~1.5-2 GB. Memory is not the constraint; CPU is.

- **A live re-score responds to elapsed time as much as to what the inspector
  observed, so an unchanged project ratchets toward Critical.** Observed on the
  deployed system: PRJ_9601 (Common Quarantine Facility, San Rafael) was
  re-scored after a monitoring report that left `status_observed` at `on_going`
  and changed nothing but the visit timestamp. It moved **High -> Critical**,
  risk_probability 0.9385, `score_basis=three_learner`. The only inputs that
  moved were the elapsed-time features: `observed_at` advanced
  `days_since_release`, the model saw a project still running and further past
  its expected duration, and the probability rose accordingly.

  This is the designed behaviour and is defensible -- a project overdue by more
  is genuinely riskier -- but it has two consequences worth stating before a
  panel finds them. First, for a report where only the date changed, the honest
  answer to "did the system respond to the inspector or to the calendar?" is
  the calendar. Second, elapsed time only ever increases, so any project that
  stays `on_going` drifts monotonically upward in risk, and Critical carries the
  highest optimizer weight -- meaning long-running projects accumulate at the
  top of the inspection schedule over time. Note also that `percent_complete`
  cannot counteract this: the inspector form deliberately does not collect it,
  because the trained feature schema has no such column and asking for it would
  imply an influence on the score that it does not have.

- **The optimizer can never schedule a High-tier project, and the schedule is
  static.** `TARGET_TIERS` is `{High, Critical}` with `RISK_WEIGHTS` of 1.0 and
  2.5, and `select_priority_projects()` consults no visit history of any kind --
  the only exclusions are completed/refunded status and an unmappable cluster.
  The live population holds 79 Critical against a weekly capacity of 60, so the
  objective fills every slot with Critical and the 21 High projects are never
  reached. Nothing changes week to week, so the same 60 projects are scheduled
  indefinitely. Verified on the deployed system: 60/60 scheduled visits were
  Critical, 89 candidates, budget 98.9% utilised, allocation_efficiency 7.5
  (= 60 x 2.5 / 20 inspector-days). Compounding it, the elapsed-time ratchet
  above only feeds the Critical pool. Medium (49) and Low (2,244) are
  categorically ineligible. The smallest fix that breaks the loop is a revisit
  cooldown; see the remediation plan.
- **The LSTM's marginal contribution is not demonstrable.** The stored metrics
  look like a large two-learner win (AUC 0.9762 vs 0.9581) but are confounded by
  population: the three-learner is only evaluable on the 598 test rows that have
  a sequence, the two-learner on all 1,765. Scored on the SAME 598 rows the gap
  nearly vanishes -- accuracy +0.0117 and precision +0.0408 to the two-learner,
  recall -0.0207 and AUC -0.0053 to the three-learner -- and McNemar on the
  discordant pairs (7 vs 14) gives p = 0.189. The two models are statistically
  indistinguishable where both can be evaluated. Reproduce with
  `python scripts/compare_meta_learners_same_rows.py`; figures land in
  `artifacts/meta_learner_paired_comparison.json`. Related reporting gap: the
  Models page reads only `meta_learner_metrics.json`, so it presents the
  three-learner's 598-row numbers as the ensemble's performance while 76% of
  deployed High/Critical scores come from the two-learner model, whose
  `meta_learner_two_metrics.json` is never surfaced.

- **The 60s solver cap introduces run-to-run variance larger than the effects
  being measured.** Two solves of the same population differing by only two
  candidate projects (89 vs 87, after the R1 cooldown excluded two) returned
  objectives of 128.81 and 117.38. Removing two Critical candidates can cost at
  most 2 x 2.5 = 5.0 of objective, so **at least 6.4 of the 11.44 drop is solver
  suboptimality, not the input change** -- both runs reported
  `hit_time_limit: true` at ~100% of the cap, so neither is a proven optimum.
  Practical consequence: any experiment that compares schedules across small
  input or parameter changes -- notably the planned R2 alpha-sweep ablation --
  will be swamped by this noise unless it first raises
  `SOLVER_TIME_LIMIT_SECONDS`, reduces `MAX_PROJECTS_CONSIDERED`, or averages
  over repeated solves. Do not attribute a single-run objective difference to a
  parameter without establishing the solver's own variance first.

## 8. Key File Map

- `ml-service/data_pipeline/preprocess.py` -- entity resolution / crosswalk, barangay veto lives here.
- `ml-service/data_pipeline/feature_engineering.py` -- target variable construction (RedFlag, proxy dates, Phase 8 clamp), feature engineering, train/test split.
- `ml-service/models/train_trees.py`, `train_lstm.py`, `train_meta_learner.py` -- Level 0/Level 1 training.
- `ml-service/optimization_engine.py` -- PuLP resource-allocation + scheduling-exclusion logic; also where SHAP is wired into the batch scoring path (`score_tabular()`).
- `ml-service/inference/explain.py` -- SHAP TreeExplainer module (RF + XGBoost only, see Section 3 above).
- `ml-service/inference/live_scoring.py` -- live per-project rescore path (`score_project()`); also wires in SHAP.
- `scripts/seed_supabase.py` -- writes scored projects to Supabase; lives at repo root, not `ml-service/`.
- `frontend/supabase/schema.sql` + loose `add_*.sql` migration files in `frontend/supabase/` -- run enum-adding migrations (`alter type ... add value`) as their OWN execution, separate from any verify query, or Postgres will reject it.
- `MAAGAP_Model_Training_Testing_Methodology_Report.docx` (Thesis root) -- kept in sync with every pipeline change. **Regenerate it with `python scripts/build_methodology_report.py`** after any retrain. That script now lives in the repo (it previously existed only in a Cowork scratch directory, which is how the report drifted into claiming 126 features in one section and 130 in another while the artifacts held 137). Every figure is read from `ml-service/artifacts/*.json` and `data/ready/*.csv` at build time rather than typed in, so the document cannot silently disagree with the model it describes. Pass `--no-comparison` once the D16 before/after table stops being the story.

## 9. Suggested Next Steps

- No committed-but-unverified work is outstanding as of this handoff -- the clamp fix is committed, verified end-to-end, and deployed to Supabase.
- Natural next candidates: real contractor-performance data integration (replacing the synthetic placeholder), barangay canonicalization (closing the crosswalk's remaining conflation risk), or expanding LSTM sequence coverage (currently only ~31% of resolved projects have a matching event sequence -- the tightest constraint in the meta-learner's training population).
