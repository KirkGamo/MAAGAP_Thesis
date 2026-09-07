-- MAAGAP: track whether a monitoring report's ML re-score actually happened.
-- ================================================================================
-- Run this in the Supabase SQL Editor. Like every other migration in this
-- folder, run it as its OWN execution, separate from any verify query.
--
-- WHY
-- ---------------------------------------------------------------------
-- actions/submit-report.ts posts to the ML service fire-and-forget, with a
-- 3-second timeout, and never records what happened. When the service is
-- unreachable -- its normal state next to a deployed frontend -- the report
-- is saved, the risk tier silently never refreshes, and nobody can tell
-- which reports were absorbed by the model and which evaporated. That
-- file's own docstring anticipated this ("a dropped webhook should be
-- retried by the ML service side ... a dead-letter queue or a periodic
-- reconciliation job"); these three columns are the state that makes such
-- a retry possible, and the Reports tab surfaces them with a Retry action.
--
-- 'skipped' is distinct from 'failed' on purpose: the ML service reports it
-- when a project has no trained representation to re-score (see
-- live_scoring.score_project's `found` flag), which is a correct outcome,
-- not an error to chase.
alter table public.monitoring_reports
  add column if not exists rescore_state text not null default 'pending'
    check (rescore_state in ('pending', 'done', 'failed', 'skipped')),
  add column if not exists rescored_at timestamptz,
  add column if not exists rescore_error text;

-- Reports are read newest-first and the Reports tab filters on state; this
-- keeps both cheap as the table grows.
create index if not exists monitoring_reports_rescore_state_idx
  on public.monitoring_reports (rescore_state, visited_at desc);

-- Existing rows (if any) predate the tracking and were never observed
-- either way -- 'pending' would wrongly invite a retry of something that
-- may well have succeeded, so mark them unknown-but-not-actionable.
update public.monitoring_reports
set rescore_state = 'skipped',
    rescore_error = 'Filed before re-score tracking existed.'
where rescored_at is null
  and rescore_state = 'pending'
  and visited_at < now() - interval '1 minute';

-- Verify (run separately):
--   select rescore_state, count(*) from public.monitoring_reports group by 1;
