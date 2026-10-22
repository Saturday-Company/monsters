# Using your subscriptions: ChatGPT, Codex and Claude Agent

If you already have ChatGPT Plus or Pro, or a Claude subscription, the monsters can work with it. Monsters uses them
only in the ways OpenAI and Anthropic allow for open-source apps that run on your computer (D-005, D-035). You don't
need them to get started: free OpenRouter is enough.

Everything is done from **Settings → Models → A subscription you already have** (Impostazioni → Modelli in Italian).
Then, in **Each monster's model**, you choose which monster uses what.

## ChatGPT (Plus and Pro)

1. Press **Continue with ChatGPT**. The browser opens on OpenAI's page.
2. Sign in and approve Monsters. The browser returns to `http://127.0.0.1:1455/auth/callback` (or to another port, if
   1455 is taken) and the settings page updates by itself.
3. The first time, OpenAI's message «You're using your ChatGPT plan» appears: press **Got it**.
4. Choose ChatGPT as a monster's first model. Next to the message field you see **Using ChatGPT plan** and the
   **Manage usage** link, which leads to ChatGPT's settings, where you decide how much of your plan Monsters can use.

Good to know:
- The tokens are kept in `~/.monsters/secrets/`, encrypted with a key in the system keychain (or, where there is no
  keychain, in a file readable only by your user). They never end up in the log.
- If you reach the limit, the monster stops and shows you OpenAI's message with **Manage usage**. Monsters never
  switches by itself to another paid provider: you decide whether to change model.
- **Plan usage** (Settings → Models, under the plan, and in a monster's usage): the windows of Claude (session, week,
  Opus) and of ChatGPT, with the percentage used and when they reset. Monsters asks the service nothing and doesn't
  read the programs' credentials: it shows what Claude Code and Codex write, and the plan windows ChatGPT adds to a model response, while a
  monster works, so the number updates only when a monster works on that plan ("updated 20 min ago").
- **Disconnect** revokes access. If OpenAI doesn't respond, also disconnect Monsters in ChatGPT's settings.

### Monsters on another computer (SSH)

The browser has to come back to the computer where Monsters runs. Before pressing **Continue with ChatGPT**, open a
tunnel from the computer with the browser:

```sh
ssh -L 1455:127.0.0.1:1455 user@monsters-computer
```

Keep the connection open until the sign-in is complete. If Monsters picked another port, the settings show it in the
«Finish signing in, in your browser» box: use that one in the command.

## Codex

Codex is OpenAI's agent for coding and using the computer. It uses the same ChatGPT sign-in: there is no second login
and Monsters never uses `codex login`.

1. Connect ChatGPT first.
2. On the Codex row, press **Install and connect** (or **Connect** if you already have the `codex` command). Monsters installs
   the official `@openai/codex` package 0.159.2 (Apache-2.0, about 450 MB) in `~/.monsters/harness/codex`, only when
   you ask.
3. Choose Codex as a monster's first model.

Codex works in the monster's folder (`~/.monsters/workspaces/<monster>`) with its own settings in
`~/.monsters/harness/codex-home`, separate from yours. The Monsters tools (notes, web, squad) reach it as an MCP
server, with the monster's permissions. Without the terminal permission, Codex can only read. Monsters that can use
the web search with Codex's search, included in the plan. Codex's commands run in its sandbox without network; a
command that needs it (`npm install`, `git push`, `curl`) asks to run outside the sandbox, and Monsters answers with
the same checks it applies to Claude Code's terminal: its data folder stays closed, and the brake can hold a risky
command for your answer.

## Claude Agent

Claude Agent uses **Claude Code installed on your PC and your subscription**. You sign in to Claude yourself, in the
terminal: Monsters has no login button, doesn't ask for or store tokens and doesn't read Claude Code's files.

1. On the Claude row, press **Connect**.
   - If you already have the `claude` command, Monsters uses it.
   - If you don't, you can press **Install and connect**: Monsters installs the official component
     `@anthropic-ai/claude-agent-sdk` 0.3.286 in `~/.monsters/harness/claude-agent`. It has a proprietary Anthropic
     license, which is why it isn't bundled with Monsters.
2. If the settings tell you to, open a terminal, run `claude` and sign in with your subscription (`/login`). Then
   press **Check again**: Monsters asks Claude Code whether you're signed in (`claude auth status`).
3. Choose Claude Agent as a monster's first model (`sonnet`, `opus` or `haiku`).

Good to know:
- Monsters removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the Claude Code process: with an API key you
  would pay as you go instead of using the subscription. It also removes Monsters' own keys and settings.
- Claude Code works in the monster's folder, where Monsters writes `AGENTS.md` and a `CLAUDE.md` that imports it. The
  Monsters tools reach it as an MCP server; it uses its own commands and files only if the monster has the terminal
  permission.
- If the settings say Claude Code would use an API key, sign in with `claude` and your plan.
- Monsters that can use the web search with Claude's search (`WebSearch`), included in the plan; they read pages with
  Monsters' own tool, which treats them as data and not as instructions.
- The **brake** applies here too: before a terminal command, a search or a service connected through Claude, Claude
  Code asks Monsters. If the action is one you want to decide yourself (publishing, writing to third parties,
  spending, deleting for good), the card "Rhea wants to …. Proceed?" appears and the monster waits for your answer.

### Services through Claude

Slack, Gmail, Drive and Calendar, Figma, Canva, Asana, HubSpot, Vercel and Claude Design only accept approved apps:
Claude is one. With the Claude subscription connected, in **Settings → Connections → Apps and services**
(Impostazioni → Collegamenti → App e servizi) these services say **Connect through Claude**. The monsters that work
with Claude use them.

1. Connect the service to your Claude account, if you haven't already: on claude.ai, **Settings → Connectors** (the
   panel has the link). For **Claude Design**, instead, open a terminal on this computer, type `claude` and then
   `/design-login`.
2. Go back to Monsters and press **Connect**: Monsters asks Claude Code whether the service is ready.
3. If Claude asks you to sign in again, reconnect it from Claude's connectors, or in a terminal:
   `claude mcp login "claude.ai Figma"` (with `--no-browser` if you're connected over SSH). Then **Check again**.

Monsters never sees these services' passwords or tokens and doesn't change Claude Code's configuration: it only
remembers which services you chose and which monsters use them. **Disconnect** removes them from the monsters; they
stay connected to your Claude account until you remove them on claude.ai.

## For all three

- Every step ends up in the action log; the **Stop everything** button also closes Codex and Claude Code at once.
- The limits of every job (steps and tokens, the `limits` settings) apply to them too.
- OpenAI's and Anthropic's rules change often: we recheck them at every release that touches the providers.
