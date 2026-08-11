---
tags: [operations, mcp, obsidian, conventions]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MCP Editing Conventions

Once [[MCP-Bridge-Setup|the MCP bridge]] is live, a Claude session has two ways to touch this vault: the MCP tools (`patch_content`, `append_content`, `search`, etc.) or plain filesystem Read/Write/Edit. Both work; they're not equivalent in effect.

**Path gotcha, confirmed the hard way:** the configured Obsidian vault root for the MCP bridge is `second-brain/` itself (Obsidian was opened pointed at this folder specifically, not the project root — see the nested `.obsidian/` folder note in [[MCP-Bridge-Setup]]). MCP tool `filepath` arguments are relative to `second-brain/`, NOT the project root. Passing `"second-brain/99-Log.md"` as a filepath (i.e., project-root-relative, matching how you'd address it via plain filesystem tools) resolves to `second-brain/second-brain/99-Log.md` and silently creates a wrong, nested file instead of erroring — this happened once during initial setup and left a stray duplicate that had to be cleaned up. When calling any `obsidian_*` MCP tool, address files as `Home.md`, `99-Log.md`, `02-Decisions/D01-Proxy-Completion-Dates.md`, etc. — never prefixed with `second-brain/`.

## Prefer the MCP tools for

Surgical, heading-anchored edits to an existing note (`patch_content` inserts relative to a heading/reference) and appends to a running log (`append_content` — e.g. adding today's entry to [[../99-Log]]). These respect Obsidian's own file-watcher and backlink index cleanly, and if the user has the vault open in the Obsidian app at the time, the change is visible immediately without a manual reload.

## Prefer plain file writes for

Bulk restructuring (renaming/moving many notes at once), creating several new notes in one pass (like this vault's initial build), or any edit large enough that a full-file rewrite is clearer than a series of patches.

## Caution: concurrent edits

If the user has Obsidian open with the vault live while an agent is also writing to it (via either method), there's a real risk of a stale read clobbering a manual edit the user just made in the app. No automated conflict detection exists here — the practical mitigation is to ask the user to save/close the note they're editing before an agent touches it, or to diff before overwriting on any note the user is known to be actively working in.

## What NOT to do

Don't silently rewrite [[../99-Log|Log]] entries — that folder is append-only by convention (see [[../Home]]). If a past log entry turns out to be wrong, add a new entry noting the correction; don't edit history.
