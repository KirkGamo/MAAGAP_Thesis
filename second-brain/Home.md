---
tags: [home, moc]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MAAGAP — Second Brain

**Start here.** This vault is the living knowledge base for MAAGAP: an undergraduate CS thesis building a predictive risk-assessment and prescriptive resource-allocation system for Philippine government (PPDO Iloilo Province) infrastructure/non-infrastructure project management. It exists alongside — not instead of — [[HANDOFF]] at the project root, which is the shorter, single-file version of the same information for quick onboarding. This vault is the deeper, cross-linked version: use it when you need to trace *why* a decision was made, not just *what* the current state is.

If you're new here, read in this order: this note, then [[MOC-Architecture]] for the shape of the system, then [[MOC-Decisions]] for how it got this way, then [[MOC-ML-Pipeline]] for the modeling core the thesis is actually graded on.

## Maps of Content

- [[MOC-Architecture]] — the four-layer stack (Next.js, FastAPI/ml-service, Supabase, deployment) and how the pieces talk to each other.
- [[MOC-Decisions]] — every significant, non-obvious decision made on this project, ADR-style: context, options, choice, why.
- [[MOC-ML-Pipeline]] — the data pipeline stage by stage, from raw Excel sheet to Supabase-seeded risk scores.
- [[MOC-Data-Model]] — Supabase schema, RLS policies, domain glossary (PPA, D_start, T_standard, proxy date, and the rest of the project's specific vocabulary).
- [[MOC-Known-Issues]] — every open limitation and caveat, so nothing gets silently forgotten or re-discovered from scratch.
- [[MOC-Operations]] — how to actually run this thing: pipeline re-run commands, sandbox constraints, git conventions, and the Claude↔Obsidian MCP bridge.
- [[99-Log]] — dated work-session history, newest first.

## Current State (as of 2026-08-08)

Pipeline, frontend, and Supabase backend are in sync as of the last real (non-dry-run) `seed_supabase.py` write. Headline metrics and the full current-state summary live in [[03-ML-Pipeline/Stage6-Meta-Learner|Stage 6: Meta-Learner]] and the methodology report (`MAAGAP_Model_Training_Testing_Methodology_Report.docx` at the project root). The most recent significant change was the Phase 8 proxy-date clamp — see [[02-Decisions/D03-Phase8-Clamp|D03: Phase 8 Clamp]] and [[99-Log/2026-07-31-Phase8-Clamp-Fix|the log entry]].

## Vault Conventions

Every note carries YAML frontmatter (`tags`, `status`, `created`, `updated`). Notes are atomic — one concept per file — and connected via `[[wikilinks]]` rather than restated. MOCs are curated link lists, not content duplicates. New work gets a dated entry in [[99-Log]] rather than silently editing history elsewhere in the vault.
