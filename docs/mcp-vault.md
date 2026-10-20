# Il vault di Monsters in Claude Desktop, Codex e Cursor

`monsters mcp` è un server MCP (stdio) che dà a un altro client AI gli strumenti del vault: cercare (per parole e
per significato), leggere, scrivere, modificare, spostare, cestinare, vedere la cronologia e annullare.

## Come funziona
- Il server MCP non apre il vault: inoltra ogni chiamata al core in esecuzione (HTTP su 127.0.0.1 con il token della
  CLI). Il vault ha un solo scrittore, il core (D-002).
- Serve il core acceso (`monsters start` o l'app). Se è spento, gli strumenti restano elencati e ogni chiamata
  risponde «Monsters is not running: start it with "monsters start"…» (codice `not_running`: non è stato fatto
  niente). Se il core è acceso ma non risponde entro 60 secondi la risposta è diversa (codice `timeout`, o
  `connection_lost` se la connessione cade a metà): la chiamata potrebbe essere andata a buon fine, quindi prima di
  ripetere una scrittura il client deve controllare con `vault_read` o `vault_history`. Con il kill switch attivo le
  chiamate sono rifiutate finché non si fa `monsters resume`.
- Il contenuto delle note (`vault_read`, `vault_search`) arriva al client dentro
  `<dati_esterni fonte="…">…</dati_esterni>`, come agli agenti (D-021): sono dati, non istruzioni, e le istruzioni
  del server MCP lo dicono al modello. Nel log delle azioni l'input delle chiamate è troncato come l'output.
- Il client è un attore a sé, `mcp-<nome del client>` (per esempio `mcp-claude-ai`): ogni chiamata finisce nel log
  delle azioni come quelle degli agenti, ogni modifica è un commit con quell'autore e si annulla dalla UI.
- Permessi di un sottoagente: legge tutto tranne le note private e `Privato/`, crea note nuove in `Inbox/`, lavora
  liberamente in `Agenti/MCP/`, modifica le note che ha scritto lui; per il resto usa `vault_propose`. Altre cartelle
  si concedono in `MONSTERS_HOME/settings.json`:

  ```json
  { "mcp": { "write": ["Progetti/**"], "delete": [] } }
  ```

## Claude Desktop
File di configurazione: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/.config/Claude/claude_desktop_config.json` (Linux).

```json
{
  "mcpServers": {
    "monsters-vault": {
      "command": "/percorso/di/node24/bin/node",
      "args": ["/percorso/di/monsters/packages/cli/bin/monsters.js", "mcp"],
      "env": { "MONSTERS_HOME": "/home/<utente>/.monsters" }
    }
  }
}
```

Serve il percorso assoluto di Node 24 (Claude Desktop non vede il `PATH` della shell). `MONSTERS_HOME` va indicata
solo se non è quella standard (`~/.monsters`). Per dare un nome fisso al client nel log: `"args": [..., "mcp",
"--client", "Claude Desktop"]`. Dopo aver salvato, riavviare Claude Desktop.

## Altri client
- **Cursor**: stesso blocco `mcpServers` in `~/.cursor/mcp.json`.
- **Codex** (`~/.codex/config.toml`):

  ```toml
  [mcp_servers.monsters-vault]
  command = "/percorso/di/node24/bin/node"
  args = ["/percorso/di/monsters/packages/cli/bin/monsters.js", "mcp"]
  ```

- **Claude Code**: `claude mcp add monsters-vault -- /percorso/di/node24/bin/node /percorso/di/monsters/packages/cli/bin/monsters.js mcp`.

## Ricerca
`vault_search` cerca per parole (con lo stemming italiano: «ricette» trova «ricetta») e per significato, con un
modello di embedding locale (granite-embedding-97m multilingue, circa 120 MB) che il core scarica al primo avvio in
`MONSTERS_HOME/models` e fa girare in background. Il modello è fissato a un commit del repository su Hugging Face e
ogni file è controllato con il suo sha256, anche quelli già in cache: un file diverso viene cancellato e non si
carica mai. Finché il modello non c'è (primo download, offline, worker caduto) la ricerca è solo per parole e il core
riprova da solo con attese crescenti; le note appena scritte, non ancora indicizzate per significato, si trovano
comunque per parole. `related_to` trova le note sullo stesso argomento di una nota. Per spegnere la ricerca per
significato: `"semanticSearch": false` in `settings.json`.
