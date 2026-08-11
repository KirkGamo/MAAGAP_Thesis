---
tags: [operations, git]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Git Conventions

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` — enforced consistently across the project's history (check `git log --oneline` for real examples).
- Clear a stale `.git/index.lock` / `.git/HEAD.lock` **before** attempting a git write, not just after one fails — a preemptive check, not a reactive one.
- Branch naming: `feat/...`, `fix/...` (e.g. `feat/auth-setup`, `fix/lstm-pipeline`) per the project's stated conventions.
- Report deliverables (`.docx`/`.pdf` at the project root — methodology report, audit reports) are intentionally left untracked, not gitignored, just never `git add`ed. Matches the established pattern of treating them as presented outputs, not source — don't "fix" this by committing them unless asked.
- Commit after completing distinct, logical milestones — don't let unrelated changes pile into one commit.
