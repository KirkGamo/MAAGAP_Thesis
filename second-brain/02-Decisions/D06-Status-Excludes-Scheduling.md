---
tags: [decision, ml-pipeline, optimization]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D06: Excluding Completed/Refunded Projects from Scheduling

## Context

`optimization_engine.py`'s `select_priority_projects()` picks which ongoing projects an inspector should visit. Some projects flagged High/Critical risk by the meta-learner turned out to already be STATUS-confirmed completed or refunded — recommending an inspector visit to a closed-out project is not an actionable recommendation, and confused a user looking at the dashboard (a "completed" project showing "critical risk, no monitoring reports" read as a bug, not a feature — this was the very first issue reported in this thread of work).

## Decision

A boolean flag (renamed `status_confirms_completed` → `status_excludes_scheduling` to reflect its broadened scope) excludes any project whose STATUS confirms completion OR refund from the scheduling candidate pool, while still computing and *displaying* its risk_tier/meta_prob on the dashboard as a historical/audit signal — the frontend shows a distinct banner explaining the score reflects historical schedule slippage (or, for refunded, that funds were returned), not an active risk needing a site visit.

## Why

Hiding the risk score entirely would lose real information (a project that finished 300 days late is still evidence about that contractor/municipality/project-type combination); showing it *without* context reads as a bug. The fix was to keep the signal but change how the frontend frames it for these two STATUS categories — see [[../01-Architecture/Frontend-Nextjs]] for the actual UI treatment on the project detail page.
