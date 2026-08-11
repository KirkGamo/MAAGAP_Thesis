---
tags: [log]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# 2026-08-08 — MCP Bridge: mcp-obsidian/mcp v2 Incompatibility

Following [[../06-Operations/MCP-Bridge-Setup]], running `uvx mcp-obsidian` failed with `AttributeError: 'Server' object has no attribute 'list_tools'`. Root cause: `mcp-obsidian` (MarkusPfundstein, v0.2.2) declares an unbounded `mcp>=1.1.0` dependency; Anthropic's `mcp` Python SDK released v2.0.0 on 2026-07-28 (days before this was hit), rebuilding the low-level `Server` class and removing the decorator methods `mcp-obsidian` depends on. `uvx` resolves the newest `mcp` by default, so it silently grabbed the incompatible v2.

Fix: pin the resolved `mcp` version with `uvx --with "mcp<2" mcp-obsidian`, and the same pin in the `args` array of any MCP client config. Setup note updated to include this. If `mcp-obsidian` releases an update compatible with `mcp` v2, this pin can be dropped — check its `pyproject.toml` on GitHub before removing it.

## Follow-up: this Claude Desktop install uses the Extensions/MCPB system, not raw JSON

This account's Claude Desktop is a packaged (MSIX-style) install (`AppData\Local\Packages\Claude_pzs8sxrjxfjjc\...`) with no `mcpServers` key in its `claude_desktop_config.json` at all -- that file turned out to be unrelated internal app state, not MCP config. The actual mechanism is Settings -> Extensions -> Advanced settings -> Install Unpacked Extension, which reads a `manifest.json` in the MCPB format (spec: modelcontextprotocol/mcpb on GitHub). Used `"server": {"type": "binary", "entry_point": "uvx", "mcp_config": {"command": "uvx", "args": ["--with", "mcp<2", "mcp-obsidian"], "env": {...}}}` -- `type: "binary"` isn't really documented for wrapping an already-installed PATH command (the format assumes a bundled executable), but it worked. Manifest lives at `%USERPROFILE%\obsidian-mcp-extension\manifest.json`.

Two more real errors hit and fixed along the way, in order:

1. **"Private dir leaf redirects (junction/substitute-name plant)"** on first install attempt -- caused by an earlier troubleshooting step that manually created a real (non-virtualized) `AppData\Roaming\Claude` folder, which collided with this packaged app's own folder virtualization. Fixed by deleting that folder before reinstalling.
2. **`Error 40101: Authorization required`** after install -- the manifest's `OBSIDIAN_API_KEY` had been set to the literal string `"Bearer 4632..."` copied verbatim from the plugin settings page's REST-header example. `mcp-obsidian` constructs the `Authorization: Bearer <key>` header itself internally, so the value must be the raw key only, no `Bearer ` prefix. Fixed by stripping it, then a **full Claude Desktop restart** (not just re-toggling the extension) was required before the fix actually took effect -- the running conversation's tool binding didn't refresh on extension reinstall alone.

Confirmed working end-to-end: `obsidian_list_files_in_vault` returned the real vault listing. One more gotcha caught testing the write side: `obsidian_append_content` with `filepath: "second-brain/99-Log.md"` silently created a wrong, nested `second-brain/second-brain/99-Log.md` instead of erroring, because the configured vault root is `second-brain/` itself -- MCP filepaths are vault-root-relative, not project-root-relative. Cleaned up; see [[../06-Operations/MCP-Editing-Conventions]] for the corrected convention.

Note for later: the plugin's settings page also shows it now exposes MCP natively over HTTPS (`https://127.0.0.1:27124/mcp/`), which would let a `"type": "http"` MCP client connect directly with an `Authorization: Bearer <key>` header -- no `uvx`/`mcp-obsidian`/version-pin needed at all. Requires trusting the plugin's self-signed cert first. Worth switching to if the current bridge ever breaks again, since it's the plugin's own maintained path rather than a third-party package.
