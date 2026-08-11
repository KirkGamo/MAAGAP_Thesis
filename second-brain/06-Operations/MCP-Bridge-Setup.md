---
tags: [operations, mcp, obsidian, setup]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MCP Bridge Setup — Claude ↔ Obsidian

This vault is already usable by any Claude session with plain filesystem access to this project folder (read/write the `.md` files directly, same as any other source file). This note is for the **additional** step of wiring a *live* MCP connection — one that lets a Claude client (Desktop, Code, or Cowork with a connector) call Obsidian-native operations (heading-relative patches, full-vault search, live in-app sync while Obsidian is open) instead of only raw file I/O.

**This setup cannot be completed by an agent working in a sandbox** — it requires your actual Obsidian desktop app and generates a local API key. Do these steps yourself, in order.

## Part 1 — Obsidian: install the Local REST API plugin

1. Open Obsidian on this vault (the project root — `.obsidian/` already exists here, so opening the `Thesis` folder itself in Obsidian is enough; `second-brain/` is just a folder within that vault).
2. Settings → Community plugins → turn on Community plugins (if not already on).
3. Browse → search "REST API" → install **Local REST API** (by coddingtonbear) → Enable it.
4. Open its plugin settings. It generates an API key and shows the port it's listening on (defaults: HTTPS 27124, HTTP 27123). Copy the API key somewhere safe — you'll need it in Part 2.

## Part 2 — Run the MCP server

The standard server for this is `mcp-obsidian` (MarkusPfundstein), launched via `uvx`. **This runs on your own computer — the same machine Obsidian is on** — never in a Cowork sandbox, since it has to reach the plugin's `127.0.0.1` address. Requires `uv`/`uvx` installed (`pip install uv`, or the installer at astral.sh/uv).

In normal use you do **not** run this command by hand and leave a terminal open — Part 3 below wires it into your MCP client's config, and the client launches/manages it as a background subprocess automatically whenever it starts. The manual command is only for a one-time sanity check before wiring up the config:

```bash
uvx --with "mcp<2" mcp-obsidian
```

**The `--with "mcp<2"` pin is required, not optional, as of 2026-08.** `mcp-obsidian`'s `pyproject.toml` declares `mcp>=1.1.0` with no upper bound, and Anthropic's `mcp` Python SDK shipped a v2.0.0 (2026-07-28) that rebuilt the low-level `Server` class and removed the old decorator methods `mcp-obsidian` 0.2.2 depends on. Without the pin, `uvx` grabs the latest `mcp` and the server crashes on startup with `AttributeError: 'Server' object has no attribute 'list_tools'`. Drop the pin only after confirming a newer `mcp-obsidian` release has caught up to `mcp` v2 (check its `pyproject.toml` on GitHub for an updated upper/no bound before assuming it's fixed).

If it starts without erroring and doesn't immediately exit, the plugin connection works — Ctrl+C it and move to Part 3.

**A blank, silent terminal after that is the success state, not a hang.** MCP stdio servers don't print a banner or "listening" message — the process is sitting in its message loop waiting for a client's JSON-RPC handshake over stdin/stdout, which only a real MCP client (not a human typing) sends. Don't wait for output; if the `Installed N packages` line printed and no traceback followed within a few seconds, it worked. Ctrl+C will print a `KeyboardInterrupt` traceback when you stop it manually — that's just unhandled-interrupt noise from an ungraceful shutdown, not an error to chase.

For either the manual check or the config in Part 3, it needs three environment variables (put them in a `.env` file in whatever directory you run this from, or your shell environment):

```
OBSIDIAN_API_KEY=<the key from Part 1, step 4>
OBSIDIAN_HOST=127.0.0.1
OBSIDIAN_PORT=27124
```

(Some newer versions of the Local REST API plugin bundle their own MCP server directly — check the plugin's settings pane for an "MCP" section before installing `mcp-obsidian` separately; if it's there, you can skip the external server and point your MCP client straight at the plugin.)

## Part 3 — Register the server with your Claude client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "uvx",
      "args": ["--with", "mcp<2", "mcp-obsidian"],
      "env": {
        "OBSIDIAN_API_KEY": "<your key>",
        "OBSIDIAN_HOST": "127.0.0.1",
        "OBSIDIAN_PORT": "27124"
      }
    }
  }
}
```

**Claude Code** — add the equivalent block to this project's `.mcp.json` (create it at the repo root if it doesn't exist).

**Cowork** — check Cowork's connector/MCP settings for an "Add custom MCP server" option; the same command/env values apply. If Cowork doesn't support arbitrary local MCP servers (it may be sandboxed and unable to reach `127.0.0.1` on your machine at all, depending on how the session is hosted), this bridge will only work from Claude Desktop or Claude Code running directly on your machine — filesystem-based vault access (already working today, no setup needed) remains the fallback either way.

## Once it's working

Available tools typically include `list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, `search`, `patch_content`, `append_content`, `delete_file`. See [[MCP-Editing-Conventions]] for when to use these versus a plain file write.
