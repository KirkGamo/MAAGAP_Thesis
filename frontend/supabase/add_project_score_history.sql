-- MAAGAP — project score history (R4)
-- ===========================================================================
-- WHY THIS EXISTS
--
-- `projects.risk_tier` and `risk_probability` are overwritten in place on every
-- re-score, so the system can say what a project's risk IS and never what it
-- WAS. Those are operationally different facts. A project that jumped from 0.30
-- to 0.94 this week demands attention; one that has sat at 0.94 for six months
-- is a known problem. The dashboard showed them identically.
--
-- That gap also hides a property of the model worth seeing rather than merely
-- disclosing. A live re-score responds to elapsed time as much as to what the
-- inspector observed: PRJ_9601 moved High -> Critical on a report that left the
-- status unchanged and advanced only the visit date. Keeping the series makes
-- the distinction visible -- the LEVEL may be calendar-driven, but the CHANGE
-- is what the visit actually moved.
--
-- `monitoring_report_id` is the load-bearing column. It links a score to the
-- field report that caused it, so "did the system respond to the inspector or
-- to the calendar?" becomes a question the data can answer: a row with a report
-- whose status differed from the project's previous status is attributable to
-- the observation; one whose status matched is attributable to elapsed time.
--
-- Run this as its own execution in the Supabase SQL editor.

create table if not exists public.project_score_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  scored_at timestamptz not null default now(),
  risk_tier text check (risk_tier in ('Low', 'Medium', 'High', 'Critical')),
  risk_probability numeric check (risk_probability between 0 and 1),

  -- Which model produced it: 'three_learner' when an LSTM sequence existed,
  -- 'two_learner' otherwise. Mirrors projects.score_basis so a historical row
  -- carries its own provenance rather than inheriting whatever the project
  -- happens to say now.
  score_basis text,

  -- How the score came about. 'live_rescore' follows a monitoring report;
  -- 'batch' is a full re-score of the population.
  source text not null default 'live_rescore',

  -- The report that triggered this score, when there was one. Null for batch
  -- re-scores. ON DELETE SET NULL rather than CASCADE: deleting a report must
  -- not erase the record that the score changed.
  monitoring_report_id uuid references public.monitoring_reports (id) on delete set null,

  created_at timestamptz not null default now()
);

-- The only query this table serves is "this project's scores, newest first",
-- for computing a delta against the previous row.
create index if not exists project_score_history_project_scored_idx
  on public.project_score_history (project_id, scored_at desc);

alter table public.project_score_history enable row level security;

-- Managers read all history; this is portfolio-level information.
create policy "score history: managers read all"
  on public.project_score_history for select
  using (public.is_manager());

-- Inspectors read history for projects, so a field officer can see whether
-- their last visit moved the number.
create policy "score history: inspectors read"
  on public.project_score_history for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'inspector'
    )
  );

-- NO INSERT OR UPDATE POLICY, deliberately. Writes come only from the ML
-- service using the service-role key, which bypasses RLS. An append-only audit
-- series that any authenticated client could write to would not be evidence of
-- anything.

comment on table public.project_score_history is
  'Append-only series of risk scores per project. Written by the ML service '
  'via the service-role key; never by a browser client. Exists so the dashboard '
  'can show how much a score CHANGED, not only what it is.';
