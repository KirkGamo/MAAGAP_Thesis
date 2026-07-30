-- Phase 22: per-project SHAP explanation data -- the top contributing
-- features (mean of Random Forest's and XGBoost's probability-space SHAP
-- contributions to P(RedFlag); see ml-service/inference/explain.py) behind
-- a project's risk_tier/risk_probability. Written by both
-- scripts/seed_supabase.py (the bulk/batch path) and ml-service's live
-- rescore path (main.py's _maybe_patch_supabase). Nullable: left NULL for
-- any project risk_tier/risk_probability are also NULL for (no LSTM
-- sequence coverage, not yet scored, etc.) -- the frontend renders that as
-- "not yet computed", same as it already does for an unscored risk_tier.
--
-- jsonb (not a new relational table) because this is a small, denormalized,
-- read-mostly array of {feature, label, shap_value, direction, raw_value}
-- objects specific to one project's one latest explanation -- there's no
-- other table that would ever join against it. Run this against the live
-- Supabase project (SQL Editor) before running scripts/seed_supabase.py
-- with SHAP support, or before a live rescore first tries to PATCH it.

alter table public.projects
  add column if not exists shap_top_features jsonb;

-- Verify:
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name = 'shap_top_features';
