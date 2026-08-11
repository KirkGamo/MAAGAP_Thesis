---
tags: [moc, ml-pipeline]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MOC — ML Pipeline

The pipeline runs as discrete, ordered scripts (not a live training service) — raw Excel sheet in, Supabase-seeded risk scores out. Each stage below is one note; run order and exact commands live in [[06-Operations/Pipeline-Rerun-Guide|the Operations rerun guide]], not duplicated here.

1. [[03-ML-Pipeline/Stage1-Preprocess|Stage 1: preprocess.py]] — type coercion, entity resolution / crosswalk (barangay veto lives here), categorical normalization, project-type classification.
2. [[03-ML-Pipeline/Stage2-Synthetic-Data|Stage 2: generate_synthetic_data.py]] — synthetic contractor profiles (placeholder data, see [[05-Known-Issues/Issue-Synthetic-Contractor-Data]]).
3. [[03-ML-Pipeline/Stage3-Feature-Engineering|Stage 3: feature_engineering.py]] — target variable construction (RedFlag), proxy dates, the Phase 8 clamp, feature engineering, train/test split, LSTM sequence assembly.
4. [[03-ML-Pipeline/Stage4-Train-Trees|Stage 4: train_trees.py]] — Random Forest + XGBoost, Level 0.
5. [[03-ML-Pipeline/Stage5-Train-LSTM|Stage 5: train_lstm.py]] — LSTM on per-project event sequences, Level 0.
6. [[03-ML-Pipeline/Stage6-Meta-Learner|Stage 6: train_meta_learner.py]] — Multinomial Logistic Regression, Level 1, current headline metrics.
7. [[03-ML-Pipeline/Stage7-Seed-Supabase|Stage 7: seed_supabase.py]] — scores ongoing projects, writes to Supabase, computes SHAP explanations.
8. [[03-ML-Pipeline/Stage8-Optimization-Engine|Stage 8: optimization_engine.py]] — PuLP linear program turning risk scores into a weekly inspector deployment schedule.

For the "why" behind any of these stages' non-obvious choices, check [[MOC-Decisions]] first — most of what looks arbitrary here has an ADR-style note explaining it.
