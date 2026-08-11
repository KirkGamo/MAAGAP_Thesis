---
tags: [decision, ml-pipeline, explainability]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D08: SHAP for Explainability

## Context

A risk tier/probability alone doesn't tell a Manager *why* a project was flagged — which is what actually makes the score actionable versus a black box.

## Decision

SHAP (SHapley Additive exPlanations) computed for the tree-based base learners (Random Forest, XGBoost), surfaced as `shap_top_features` (JSONB) on each `projects` row — both in batch (`seed_supabase.py`, at scoring time) and live (single-project rescore path via the FastAPI service). The frontend renders this as a bar chart on the project detail page, each feature labeled with a direction (increases/decreases risk) and its raw value.

## Why, and the compatibility patch it required

xgboost ≥ ~2.1 (3.2.0 is what's pinned) serializes its `base_score` model parameter in a bracketed-array string format that every SHAP release through 0.49.1 fails to parse. `inference/explain.py` patches SHAP's UBJSON decoder to work around this — verified via additive-consistency (`sum(shap_values) + expected_value` reproduces the model's actual `predict_proba()` output exactly, so the patch isn't silently producing wrong numbers). This is a maintenance note for whoever next updates either dependency: an upstream SHAP fix could make the patch obsolete or need revisiting. See [[../00-Maps/MOC-Known-Issues|Known Issues]] if this patch is ever removed without checking first.

## Two related fixes along the way

A NaN JSON-serialization crash when seeding `shap_top_features` to Supabase, and a blank-header "ghost ID" column in the raw data that was leaking into the feature matrix and getting picked as a top SHAP feature — both fixed, see `git log` for `0f686c2` and `c87a1d9`.
