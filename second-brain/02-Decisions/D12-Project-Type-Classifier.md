---
tags: [decision, ml-pipeline, data-quality]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# D12: Supervised Project-Type Classifier (DQ-7 v3)

## Context

The original Data Audit Report (Section 6 Step 5) recommended a supervised TF-IDF + logistic-regression classifier over `NAME OF PROJECT`, because keyword matching classified only 40.2% of monitoring rows. The v2 keyword heuristic (`classify_project_type()` in `preprocess.py`) raised that to ~80.9%, but its own docstring acknowledged it was "not a final classifier," and the residual 19.1% Unclassified rate (1,674 rows) was a hard ceiling on the labeled population — Unclassified rows have no `T_standard`, so `RedFlag` can never be computed for them ([[../05-Known-Issues/Issue-Unclassified-Project-Type]]). 1,078 of those Unclassified rows already had a resolved completion date, i.e. they were fully labelable except for the missing type.

## Training data

550 distinct `NAME OF PROJECT` values sampled stratified across the v2 heuristic's three output classes (250 Unclassified — every Unclassified name with ≥3 rows plus a random fill — 150 Infrastructure, 150 Non-Infrastructure; seed 42), hand-labeled on 2026-08-15 by Claude from a manual read-through of every name, with the labeling rules documented in the header of `ml-service/data_pipeline/reference/project_type_labels.csv`'s generator and in `preprocess.py`. 12 names were labeled `X` (genuinely undeterminable from the name alone, e.g. bare "FA", the unknown acronym "TPED") and are excluded from training. **The labels are auditable**: the CSV is committed at `ml-service/data_pipeline/reference/project_type_labels.csv` with the heuristic's opinion at labeling time alongside each label, so any label can be reviewed or corrected and the model simply retrains from the file.

Labeling also measured the v2 heuristic's own accuracy where it commits: 146/148 on its Infrastructure stratum, 148/149 on Non-Infrastructure (~99%) — its 3 sampled errors are keyword false-positives ("Major **Repair of** Fire Truck" → Infrastructure; "Donations (moving up Ceremony of **Day care**)" → Infrastructure; "Financial **Assistance** (Tanod Outpost)" → Non-Infrastructure).

## Options considered

1. Swap the classifier in as the default for all rows (replace the heuristic).
2. Keep the heuristic as fast path; classifier as **fallback only** for heuristic-Unclassified rows, gated by a confidence threshold.
3. Keep v2 as-is (do nothing).

## Decision

Option 2, threshold 0.7. Implemented in `preprocess.py`: `train_project_type_classifier()` (TF-IDF word 1-2-grams + char_wb 2-4-grams → logistic regression, C=2.0, balanced) trains **at run time** from the committed CSV (sub-second on 538 rows; `*.joblib` is deliberately gitignored — the CSV is the single auditable source of truth). `apply_project_type_classification()` runs the heuristic first, then the classifier only on Unclassified rows, committing only at ≥0.7 confidence; below-threshold rows stay Unclassified rather than being guessed. A new `project_type_source` column ("keyword" / "classifier" / "unclassified") records which stage decided every row.

## Why

- 5-fold CV: 96.3% overall; on the heuristic-Unclassified stratum (the only population the fallback ever touches) 94.6% unthresholded, **98.9% on the subset kept at the 0.7 threshold** — matching the heuristic's own ~99% accuracy, so classifier-recovered rows meet the same evidentiary standard as keyword-classified ones. That equivalence is what justified 0.7 over the safer 0.8 (which kept only 57% of names).
- Option 1 rejected: the heuristic is ~99% accurate where it commits and fully auditable (a panel can read the keyword lists); replacing it with a model would trade auditability for no measurable accuracy gain on that population.
- Row-weighted effect on the full 8,784-row monitoring sheet at 0.7: 1,423 of 1,674 Unclassified rows recovered (85.0%), residual Unclassified rate 19.1% → ~2.9%.
- `project_type` feeds `T_standard` feeds `RedFlag`, so a silent wrong class silently flips training labels — hence the abstention design (below-threshold rows are never guessed) and the source column for downstream discounting, mirroring the `completion_date_is_proxy`/`completion_date_is_clamped` auditability pattern from [[D01-Proxy-Completion-Dates]]/[[D03-Phase8-Clamp]].
