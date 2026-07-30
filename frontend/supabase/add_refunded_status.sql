-- Adds 'refunded' to the project_status enum: an activity/PPA whose fund
-- transfer was returned rather than liquidated against completed work (see
-- Fund Transfer Con's Amount Refunded column and the monitoring sheet's
-- STATUS values like "Refunded"/"For refund of full amount"). Previously
-- this fell through map_status()'s substring checks (scripts/
-- seed_supabase.py) and was silently mislabeled "on_going", which is
-- misleading -- a refunded activity's funds are gone, not awaiting further
-- work. Run this against the live Supabase project (SQL Editor) before
-- re-running scripts/seed_supabase.py with the updated map_status().
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside the same transaction as
-- a later statement that uses the new value, but this file only adds the
-- value -- run it as its own statement/script, which the Supabase SQL
-- Editor already does.

alter type project_status add value if not exists 'refunded';

-- Verify:
select enum_range(null::project_status);
