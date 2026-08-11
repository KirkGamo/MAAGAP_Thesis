---
tags: [log]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# 2026-07-30 — Barangay Veto and Refunded Status

Triggered by two user-reported observations on the deployed dashboard: (1) a completed project showing "critical risk" due to "no monitoring reports yet" was confusing, since a completed project should have at least one monitoring report; (2) a fund transfer can be "Refunded," and this wasn't represented anywhere.

Investigating (1) led to discovering a real entity-resolution bug: two distinct projects in different barangays had been merged by the crosswalk. Fixed via [[../02-Decisions/D04-Barangay-Veto-Crosswalk]], which also cascaded into UI messaging changes so completed/refunded projects get honest framing instead of a flagged-risk-looking banner ([[../02-Decisions/D06-Status-Excludes-Scheduling]]).

Investigating (2) led to [[../02-Decisions/D05-Refunded-Status]] — a full-stack addition of the `refunded` status, plus surfacing `date_last_monitored` on PPA cards per the same user request.

Hit and fixed the Postgres enum-migration transaction gotcha along the way (see [[../01-Architecture/Database-Supabase]]).
