---
tags: [decision, ml-pipeline, data-quality]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# D11: Exact-Duplicate Row Removal (Phase 11)

## Context

A 2026-08-15 data-quality audit found 960 rows (of the full 8,784-row monitoring population) sharing an identical `(NAME OF PROJECT, DATE RELEASED, DATE MONITORED, AMOUNT (Php))` fingerprint with another row — 457 groups, mostly pairs (250) but with a handful of triples/quads/quintuples and one group of 7. Checked against `mon_row_id` (the row's true original position, see the Step 0 index-integrity fix below) and confirmed every duplicate pair has a **different** `mon_row_id` — these are genuine duplicate ledger entries in the raw source spreadsheet, not a crosswalk/join artifact producing repeated rows from a single source record.

## Options considered

1. Leave duplicates in place (as before) — each duplicate silently doubles/triples that project's weight in training and in Supabase's live project list.
2. Deduplicate only the labeled (train/test) population.
3. Deduplicate across the full pipeline (train/test *and* inference.csv/live Supabase scoring), `keep="first"`.

## Decision

Option 3, per standing instruction that erroneous rows should be excluded from the entire ML pipeline, not just the training split. Applied in `construct_target_variable()` on `df.duplicated(subset=DUPLICATE_ROW_KEY_COLUMNS, keep="first")`, dropped before `D_start`/`RedFlag` are computed so it cascades through the existing `RedFlag`-based train/test-vs-inference partition automatically. 503 of the full population dropped (net, after `keep="first"`); 285 of those were in the previously-labeled 5,159-row population.

**Known limitation, not fixed by this change:** `assemble_lstm_sequences()` has its own hard, documented requirement to receive the raw monitoring sheet in the exact row order the crosswalk (`project_crosswalk.csv`) was built against — deduping `monitoring_raw` itself before that function runs would require separate, more invasive changes to keep its positional-index logic correct, and was judged out of scope for this pass. LSTM sequence data therefore still includes the duplicate raw events; only the tabular (RF/XGBoost) path and inference.csv's tabular rows are deduplicated.

## Why

A required prerequisite surfaced during implementation: `run()` previously derived `mon_row_id` via `monitoring.reset_index()` *after* all Step 6-9 processing, which only produced the correct original position because nothing upstream had ever changed row count before. Any row-drop before that point (this one included) would have silently desynchronized `mon_row_id` from the crosswalk's actual positional keys for every row after the first drop, corrupting the `project_key` join. Fixed by assigning `mon_row_id` once, immediately on load (before `assemble_lstm_sequences` is even called), and carrying it as an ordinary column from then on — verified via a project_key-linkage-rate regression check (pre-change vs. post-change) before trusting any of Phase 9/10/11's row-drop results.
