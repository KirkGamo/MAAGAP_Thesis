-- MAAGAP Project Handoff --
_Last updated: 2026-07-31_

This document briefs a new Cowork session on where MAAGAP stands right now, what was just fixed, what's still open, and the operational gotchas that have already cost real debugging time once. Read this before touching the ML pipeline or the frontend risk-display logic.

## 1. What This Is

MAAGAP is Kirk's undergraduate CS thesis: a predictive risk-assessment and resource-allocation tool for Philippine government (PPDO Iloilo Province) infrastructure/non-infrastructure project management. A Level 0/Level 1 stacking ensemble (Random Forest + XGBoost + LSTM -> Multinomial Logistic Regression) predicts a four-tier risk label (Low/Medium/High/Critical) from historical fund-transfer, liquidation, and monitoring records, and a PuLP linear-programming module prescribes inspector/resource allocation. Full stack and methodology conventions are in this Cowork space's project instructions -- read those first if they aren't already loaded.

## 2. Current Status (2026-07-31)

The ML pipeline, frontend dashboard, and Supabase backend are all functional and in sync as of the last `seed_supabase.py` run (real write, not `--dry-run`, completed successfully -- 3,625 project rows upserted). The methodology report (`MAAGAP_Model_Training_Testing_Methodology_Report.docx`, in the Thesis root) reflects the current model exactly -- headline numbers below are the real, final-run figures, not sandbox estimates.

**Current headline metrics (final run, unrestricted hardware, post Phase 8 clamp fix):**
- Resolved/labeled population: 5,159 of 8,784 monitoring rows (58.7%) -- train 3,612 / test 1,547
- Random Forest: test accuracy 0.841, recall 0.859, AUC-ROC 0.905
- XGBoost: test accuracy 0.921, recall 0.905, AUC-ROC 0.975
- LSTM (n=1,124 train / 477 test): test accuracy 0.558, recall 0.894, precision 0.468 -- noisy, high-recall/low-precision base learner (see caveat below)
- Meta-learner (Level 1, n=477 test): accuracy 0.895, precision 0.879, recall 0.851, F1 0.865, AUC-ROC 0.962
- Risk tier distribution (test): Low 275, Medium 41, High 23, Critical 138

## 3. Recent Major Fixes (most recent first)

**Phase 8 -- Proxy-completion-date clamp (this session).** Phase 7's empirical lag correction (median 267.5 days, subtracted from every recovered proxy completion date) occasionally pushed a short-duration project's corrected date back before its own D_start -- non-credible, previously left unresolved. Splitting the ~2,362 affected rows found two distinct causes: 1,260 rows where the RAW (uncorrected) proxy date is genuinely after D_start -- a real event exists, only the flat correction over-shoots -- now clamped at `D_start + 1 day`. A further 1,102 rows where the raw proxy date already precedes D_start before any correction at all -- no real event to anchor to -- deliberately left unresolved, never clamped. Clamped rows are marked `completion_date_is_clamped=True` in `data/ready/train.csv`/`test.csv`; their RedFlag is 0 by mechanical construction (T_actual pinned to 1 day, always below any T_standard), **not observed evidence of on-time completion** -- this is called out in `feature_engineering.py`, `train_trees.py`'s logging, and the methodology report (Section 3.1, Section 8). Implemented in `ml-service/data_pipeline/feature_engineering.py`'s `construct_target_variable()`, committed `ef2e581`.

**Barangay-veto crosswalk fix (prior session).** `build_project_crosswalk()` in `preprocess.py` previously matched fund-transfer rows to liquidation/monitoring rows on (project name, municipality, fiscal year) alone. Generic, recurring project names ("Streetlights", "Monoblock Chairs", "Socio Cultural Activities") recur across different barangays in the same municipality/year, so this key wasn't unique -- a real case merged two distinct "Public Address System" projects in different Tubungan barangays into one `project_key`. Fixed by adding a barangay-level veto (`_barangay_conflicts()`, `BARANGAY_MATCH_SCORE_CUTOFF = 70`) to the cascading exact/fuzzy match. This correctly shrank the crosswalk's linkage rate (~35% -> 18.7%) -- a smaller but honest crosswalk, not a regression. Committed `586a743`.

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

# 7. Seed Supabase (run from the REPO ROOT, not ml-service -- scripts/ lives there):
cd ..
python scripts\seed_supabase.py --dry-run    # inspect sample output first
python scripts\seed_supabase.py              # real write
```

**Verify after step 3**: the log line `Step 6: labeled N/8784 rows (...), of which M recovered via a Phase 6 proxy completion date (... K of those via the Phase 8 D_start+1 clamp)` should read N=5159, K=1260. If those numbers drift, something upstream changed and needs investigating before continuing.

**Verify after step 6**: `train_meta_learner.py`'s log should say `Meta-learner training set: 1,124 rows`. If it says something smaller/different, steps 4-5 didn't actually write fresh artifacts (check they didn't abort) and the meta-learner trained on stale OOF predictions.

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

## 8. Key File Map

- `ml-service/data_pipeline/preprocess.py` -- entity resolution / crosswalk, barangay veto lives here.
- `ml-service/data_pipeline/feature_engineering.py` -- target variable construction (RedFlag, proxy dates, Phase 8 clamp), feature engineering, train/test split.
- `ml-service/models/train_trees.py`, `train_lstm.py`, `train_meta_learner.py` -- Level 0/Level 1 training.
- `ml-service/optimization_engine.py` -- PuLP resource-allocation + scheduling-exclusion logic.
- `scripts/seed_supabase.py` -- writes scored projects to Supabase; lives at repo root, not `ml-service/`.
- `frontend/supabase/schema.sql` + loose `add_*.sql` migration files in `frontend/supabase/` -- run enum-adding migrations (`alter type ... add value`) as their OWN execution, separate from any verify query, or Postgres will reject it.
- `MAAGAP_Model_Training_Testing_Methodology_Report.docx` (Thesis root) -- kept in sync with every pipeline change; source-generated via a `build_report.js` script (docx library) that lives only in the Cowork scratch outputs directory, not the repo -- ask the current session if you need to regenerate it, or rebuild it from scratch referencing this report's existing structure.

## 9. Suggested Next Steps

- No committed-but-unverified work is outstanding as of this handoff -- the clamp fix is committed, verified end-to-end, and deployed to Supabase.
- Natural next candidates: real contractor-performance data integration (replacing the synthetic placeholder), barangay canonicalization (closing the crosswalk's remaining conflation risk), or expanding LSTM sequence coverage (currently only ~31% of resolved projects have a matching event sequence -- the tightest constraint in the meta-learner's training population).
