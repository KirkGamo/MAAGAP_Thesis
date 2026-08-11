---
tags: [moc, operations]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MOC — Operations

The practical, "how do I actually work on this" side of the vault.

- [[06-Operations/Pipeline-Rerun-Guide|Pipeline Rerun Guide]] — exact commands, in order, with the CWD-relative-path gotcha called out explicitly (it has already cost real debugging time once).
- [[06-Operations/Sandbox-Constraints|Sandbox Constraints]] — what's different about running this pipeline inside a Cowork/agent sandbox versus the user's own machine.
- [[06-Operations/Git-Conventions|Git Conventions]] — Conventional Commits, lock-file handling.
- [[06-Operations/MCP-Bridge-Setup|MCP Bridge Setup]] — wiring a live Claude↔Obsidian connection via the Local REST API plugin + mcp-obsidian, so any Claude client can read/write this vault directly, not just through one-off filesystem access.
- [[06-Operations/MCP-Editing-Conventions|MCP Editing Conventions]] — when to use the MCP tools versus plain file writes once the bridge above is live.
