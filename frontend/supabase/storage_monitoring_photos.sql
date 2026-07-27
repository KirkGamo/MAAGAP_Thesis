-- MAAGAP Supabase Storage: monitoring-photos bucket + RLS
-- ================================================================================
-- Phase 10, Task 2. Stores the site photos an Inspector captures in the field
-- when filing a monitoring_reports row (see supabase/schema.sql's
-- monitoring_reports.photo_urls text[] column, and
-- src/actions/submit-report.ts's SubmitReportInput.photoUrls -- both already
-- existed before this phase; this script is the missing piece that lets an
-- Inspector actually write a file there).
--
-- Run this in the Supabase SQL Editor (or `supabase db push`) against the
-- same project schema.sql/fix_rls_recursion.sql were run against. Safe to
-- re-run: bucket creation is idempotent via ON CONFLICT, and policies are
-- dropped before being recreated.

-- ---------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------
-- Not public: photos are evidence tied to specific projects/reports, not
-- anonymously world-readable. Managers/Inspectors read them through
-- signed URLs (see report-form.tsx / backlog/[projectId]/page.tsx),
-- which the RLS SELECT policy below governs.
insert into storage.buckets (id, name, public)
values ('monitoring-photos', 'monitoring-photos', false)
on conflict (id) do update set public = excluded.public;

-- ---------------------------------------------------------------------
-- RLS policies on storage.objects, scoped to this bucket
-- ---------------------------------------------------------------------
-- Upload convention: every object's storage path is prefixed with the
-- uploading Inspector's own auth.uid(), e.g.
--   <inspector_uid>/<project_id>/<timestamp>-<filename>.jpg
-- storage.foldername(name) splits the object path on "/" and returns it
-- as a text[] -- foldername(name)[1] is that first path segment. Scoping
-- the INSERT check to auth.uid()::text = foldername(name)[1] means an
-- Inspector can only ever write into their own prefix, mirroring the same
-- "insert own" convention already used by
-- monitoring_reports ("reports: inspectors insert own" in schema.sql).

drop policy if exists "monitoring-photos: inspectors insert own" on storage.objects;
create policy "monitoring-photos: inspectors insert own"
  on storage.objects for insert
  with check (
    bucket_id = 'monitoring-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Managers can read every photo in the bucket (visual evidence review --
-- Task 4's backlog/project-detail viewer). Reuses the same is_manager()
-- security-definer helper schema.sql's other manager-only policies use, so
-- this doesn't reintroduce the RLS-recursion class of bug fixed in
-- Phase 8.5 (public.is_manager() queries profiles as its own owner,
-- bypassing RLS, rather than the policy re-querying itself).
drop policy if exists "monitoring-photos: managers read all" on storage.objects;
create policy "monitoring-photos: managers read all"
  on storage.objects for select
  using (
    bucket_id = 'monitoring-photos'
    and public.is_manager()
  );

-- Inspectors can also read back their own uploads (e.g. to show a preview
-- of what they just captured before submitting the report, or to review
-- their own report history in /inspector).
drop policy if exists "monitoring-photos: inspectors read own" on storage.objects;
create policy "monitoring-photos: inspectors read own"
  on storage.objects for select
  using (
    bucket_id = 'monitoring-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE/DELETE policy is defined: field evidence photos are
-- write-once/append-only by design, mirroring monitoring_reports itself
-- (schema.sql defines no "reports: inspectors update/delete own" either).
-- If the client library's upload call defaults to upsert (overwrite) on a
-- path collision, that path collides with the RLS INSERT check exactly
-- the same way, but be aware there is no separate UPDATE grant here --
-- an app-level "upsert:true" option will still be rejected by RLS unless
-- an UPDATE policy is added later.
