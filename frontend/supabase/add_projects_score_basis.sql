-- MAAGAP: record WHICH model produced each project's risk tier (D21)
-- ============================================================================
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- WHY
-- ----------------------------------------------------------------------------
-- D21 added a two-learner fallback so that projects without an LSTM event
-- sequence could be scored at all, lifting coverage from 668 to 2,393 ongoing
-- projects. 72% of live risk tiers now come from that two-input model rather
-- than the three-learner stack the manuscript describes.
--
-- The scoring pipeline computed a `score_basis` tag for exactly this reason,
-- but only ever logged it -- nothing persisted it, so neither a manager nor
-- Chapter 4 could tell which model produced a given tier. A provenance field
-- that lives only in a log file is not provenance.
--
-- Nullable on purpose: rows seeded before this column existed keep NULL, which
-- reads correctly as "unknown", rather than being backfilled with a guess.
alter table public.projects
  add column if not exists score_basis text;

comment on column public.projects.score_basis is
  'Which meta-learner produced risk_tier: three_learner (RF + XGBoost + LSTM) '
  'or two_learner (RF + XGBoost, used where no LSTM sequence exists). NULL for '
  'rows scored before this column was added. See second-brain/02-Decisions/'
  'D21-Two-Learner-Fallback.md.';

-- Constrained so a typo in the pipeline fails loudly at write time instead of
-- quietly creating a third category nobody notices.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_score_basis_check'
  ) then
    alter table public.projects
      add constraint projects_score_basis_check
      check (score_basis is null or score_basis in ('three_learner', 'two_learner'));
  end if;
end $$;
