# The Monsters notes in Claude Desktop, Codex and Cursor

`monsters mcp` is an MCP server (stdio) that gives another AI client the tools of the notes (the vault): search (by
words and by meaning), read, write, edit, move, trash, see the history and undo.

## How it works
- The MCP server doesn't open the vault: it forwards every call to the running core (HTTP on 127.0.0.1 with the CLI
  token). The vault has a single writer, the core (D-002).
- The core has to be running (`monsters start` or the app). If it's off, the tools are still listed and every call
  answers «Monsters is not running: start it with "monsters start"…» (code `not_running`: nothing was done). If the
  core is running but doesn't answer within 60 seconds the answer is different (code `timeout`, or `connection_lost`
  if the connection drops halfway): the call may have succeeded, so before repeating a write the client must check
  with `vault_read` or `vault_history`. With the kill switch engaged, calls are refused until `monsters resume`.
- The content of notes (`vault_read`, `vault_search`) reaches the client inside
  `<dati_esterni fonte="…">…</dati_esterni>`, as it does for the agents (D-021): it is data, not instructions, and
  the MCP server's instructions tell the model so. In the action log, the input of calls is truncated like the
  output.
- The client is an actor of its own, `mcp-<client name>` (for example `mcp-claude-ai`): every call ends up in the
  action log like the agents' calls, every change is a commit with that author and can be undone from the UI.
- A sub-agent's permissions: it reads everything except private notes and `Privato/`, creates new notes in `Inbox/`,
  works freely in `Agenti/MCP/`, edits the notes it wrote itself; for anything else it uses `vault_propose`. Other
  folders are granted in `MONSTERS_HOME/settings.json`:

  ```json
  { "mcp": { "write": ["Progetti/**"], "delete": [] } }
  ```

## Claude Desktop
Configuration file: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/.config/Claude/claude_desktop_config.json` (Linux).

```json
{
  "mcpServers": {
    "monsters-vault": {
      "command": "/path/to/node24/bin/node",
      "args": ["/path/to/monsters/packages/cli/bin/monsters.js", "mcp"],
      "env": { "MONSTERS_HOME": "/home/<user>/.monsters" }
    }
  }
}
```

It needs the absolute path of Node 24 (Claude Desktop doesn't see the shell's `PATH`). Set `MONSTERS_HOME` only if
it isn't the standard one (`~/.monsters`). To give the client a fixed name in the log: `"args": [..., "mcp",
"--client", "Claude Desktop"]`. After saving, restart Claude Desktop.

## Other clients
- **Cursor**: the same `mcpServers` block in `~/.cursor/mcp.json`.
- **Codex** (`~/.codex/config.toml`):

  ```toml
  [mcp_servers.monsters-vault]
  command = "/path/to/node24/bin/node"
  args = ["/path/to/monsters/packages/cli/bin/monsters.js", "mcp"]
  ```

- **Claude Code**: `claude mcp add monsters-vault -- /path/to/node24/bin/node /path/to/monsters/packages/cli/bin/monsters.js mcp`.

## Search
`vault_search` searches by words (with Italian stemming: «ricette» finds «ricetta») and by meaning, with a local
embedding model (multilingual granite-embedding-97m, about 120 MB) that the core downloads on first start into
`MONSTERS_HOME/models` and runs in the background. The model is pinned to a commit of its Hugging Face repository and
every file is checked against its sha256, including the ones already cached: a different file is deleted and never
loaded. Until the model is there (first download, offline, worker down) search is by words only and the core retries
by itself with growing waits; notes just written, not yet indexed by meaning, can still be found by words.
`related_to` finds the notes on the same topic as a note. To turn off search by meaning: `"semanticSearch": false`
in `settings.json`.
