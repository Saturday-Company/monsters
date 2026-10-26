# Monsters architecture

> Status: **approved on 14/10/2026**. The choices are explained in `DECISIONS.md` (in Italian), the sources are in
> `research/`.

## 1. The idea in one picture

```
                ┌──────────────────────── channels ──────────────────────┐
                │  Web UI (React)   CLI/TUI via SSH   Telegram   Desktop │
                └───────┬───────────────┬───────────────┬──────────┬─────┘
                        │ HTTP + WebSocket on 127.0.0.1, token + Origin check
┌───────────────────────▼─────────────────────────────────────────────────────────┐
│ CORE  (a single Node 24 process, "monsters")                                    │
│                                                                                 │
│  Gateway ── Auth (local user, sessions, CLI token, Telegram allow-list)         │
│     │                                                                           │
│  Orchestrator ──delegates (agents-as-tools)──▶ Agents (Rhea, Dione, …N)         │
│     │   ▲  ask_user (options)                    │                              │
│     │   └── DecisionGate (rules + System 1)      │                              │
│     │                                            ▼                              │
│  Agent runtime: AI SDK 7 loop ── Tools: vault_*, web, shell, MCP, CLI           │
│     │                              │                                            │
│  Provider: OpenRouter free → pay-as-you-go APIs → subscriptions (ChatGPT, Claude Code) │
│     │                                                                           │
│  Append-only event log (SQLite) = action log, UI stream, resume                 │
│  Kill switch: global AbortController + persisted state                          │
│     │                                                                           │
│  VaultService ── .md files (Obsidian) + git + SQLite FTS5 index (+ vectors)     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

A single "core" process owns state, agents and the vault. Every channel is a client of the same core: the web UI, the
CLI used over SSH, the Telegram bot and, in Phase 3, the desktop app (which can connect to a remote core through an SSH
tunnel). That way there is one writer of the vault, one log and one kill switch.

## 2. Principles

1. **Local and the user's own.** Everything runs on their PC; data is readable files (Markdown, YAML, SQLite).
2. **Provider-agnostic.** Every model call goes through the `Provider` interface; no module knows a specific
   provider.
3. **No blocks for agents, protection for the user.** Agents don't ask for confirmation to use tools: permissions
   are granted once during onboarding. The user is protected by authentication on the control plane, a log of every
   action, a reversible vault and the kill switch. The user is asked only about choices that are theirs to make (see
   §6).
4. **State lives in files and in the log**, not in the models' context. An agent can restart from zero by reading
   its memory and the log.
5. **Remove more than you add.** Short instructions, a few well-described tools, a harness that is easy to prune with
   every new model.

## 3. Stack

| Layer | Choice |
|---|---|
| Runtime | **Node 24 LTS**, strict TypeScript, ESM. **pnpm** monorepo |
| Server | **Hono** (HTTP + WebSocket) on `127.0.0.1` |
| Agent loop and providers | **Vercel AI SDK 7** (`ai`), `@openrouter/ai-sdk-provider`, official `@ai-sdk/*` providers, MCP client `@ai-sdk/mcp` |
| Subscriptions (Phase 2) | ChatGPT with *Sign in with ChatGPT*; Claude with the official binary through `@anthropic-ai/claude-agent-sdk`; Codex with `@openai/codex-sdk` |
| Database | **SQLite** via `node:sqlite` (FTS5 included) behind a small adapter |
| Vault | `.md` files, `yaml` + `remark` for parsing, **isomorphic-git** (system git if present), `chokidar` 5 |
| Semantic search (Phase 2) | `@huggingface/transformers` 4 + granite-embedding-97m-multilingual-r2 (quint8), vectors in SQLite, RRF fusion |
| Validation | **zod 4**, schemas shared by internal tools, the API and the MCP server |
| UI | **React 19 + Vite 8 + Tailwind 4**, shadcn/ui components, frame-by-frame CSS animations (D-084), Zustand |
| Monsters | **Parametric SVG** (JSON "genome" + parts kit), `<Monster>` component |
| Telegram (Phase 2) | **grammY** |
| Vault MCP server (Phase 2) | `@modelcontextprotocol/server` v2 |
| Tests | **Vitest** (unit and integration, AI SDK fake provider), **Playwright** (UI e2e) |
| Desktop (Phase 3) | **Electron** (Chromium everywhere: needed for the refracting glass; core in a `utilityProcess`, electron-builder), D-015 rechecked on 15/10/2026 |

## 4. Repository structure

```
monsters/
├── CLAUDE.md  AGENTS.md  LICENSE  SECURITY.md
├── docs/                         # development memory (not the product's second brain)
├── packages/
│   ├── core/                     # gateway, auth, event log, kill switch, orchestrator, agent runtime
│   ├── providers/                # Provider interface, OpenRouter, RateBudget, fake provider for tests
│   ├── vault/                    # VaultService, index, git, vault_* tools
│   ├── tools/                    # web_search, web_fetch, shell, MCP client, CLI (Phase 2)
│   ├── monster-kit/              # genome, SVG parts, generator, animations (used by the UI and Telegram)
│   ├── shared/                   # shared types and events (zod schemas)
│   ├── db/                       # SQLite adapter and migrations (used by core and vault)
│   └── cli/                      # the `monsters` command (start, status, kill, chat from the terminal)
├── apps/
│   ├── web/                      # the React UI
│   └── desktop/                  # Electron app: core in a utilityProcess, window on the core (D-045)
└── e2e/                          # end-to-end tests and recorded demos
```

## 5. Core components

### 5.1 Event log
An append-only `events` table in `~/.monsters/monsters.db`: `{id ULID, ts, agent, run_id, parent_id, type, data}`.
Main types: `message`, `delegation`, `tool_call`, `tool_result`, `decision`, `question`, `answer`,
`question_expired`, `vault_change` (with the commit SHA and, for an undo, the action that was undone),
`provider_usage`, `error`, `kill`. It is at once:
- the **action log** the UI can browse (filters by agent, type, period);
- the **stream** that feeds chat, agent terminals and monsters (over WebSocket);
- the **source for resuming** work after a restart.
Secrets never enter the log (redaction by key and by pattern before writing).

**Archive** (`packages/core/src/log/archive.ts`): bulky events older than 90 days (`settings.json` →
`logArchive.{enabled,days}`, minimum 30) leave the db and go into one gzip file per month,
`~/.monsters/archive/events-YYYY-MM.jsonl.gz` (UTC month of `ts`, one event per line as the API returns it,
permissions 600). Only these are moved: `provider_usage`, `tool_result`, `tool_call` (except those that read text from
third parties: in logs from before D-103 they are the sign of a run's taint), partial streaming `message`s and the
messages of sub-agents inside a finished automation run. Everything else stays forever; the cut never goes past the
start of the previous month (the spending of this month and the previous one is always complete). Order: the file is
written as `.tmp`, fsynced, read back and compared (rows and SHA-256), renamed, the folder is fsynced; only then is
the deletion done, in transactions that remove and restore the `events_no_delete` trigger. An interrupted pass loses
nothing: on the next one, events already in the file are simply deleted. Before the first archive, a copy of the db
(`monsters.db.before-archive`, `VACUUM INTO`), removed when a later pass moves events again without errors. The core
makes one pass at most once a day (a check one minute after start and then every hour; sooner if the db has grown by
256 MB), and the `VACUUM` only with no monsters at work and at least 64 MB free; by hand, `monsters log archive` (with
`VACUUM`), `monsters log read --month YYYY-MM`, `GET/POST /api/log/archive`. Every pass leaves a `log_archive`
event; Activity, once the history is over, says where the archives are.

### 5.2 Kill switch
A global `AbortController` from which those of every run, agent and tool call derive. `kill` interrupts model calls,
terminates child processes (shell, CLI, harnesses) with SIGINT and then SIGKILL, empties the queues, writes the `kill`
event and puts the core in a **stopped** state: nothing starts until the user resumes. Reachable from the UI (an
always-visible button), the CLI (`monsters kill`) and Telegram (`/stop`, Phase 2).

### 5.3 Agent runtime
An agent is a folder in `~/.monsters/agents/<id>/`:
```
AGENTS.md        # role and essential rules (under 40 lines), generated from a template
agent.yaml       # name, color, provider and fallback chain, tools, vault permissions, limits
genome.json      # the monster's look
skills/          # recurring procedures in SKILL.md format (agentskills.io standard)
```
The agent's long-term memory lives in the vault, in `Agents/<Name>/MEMORY.md` (`Agenti/` in an Italian vault, D-154),
so the user can see and correct it in Obsidian. On every run the system prompt is: AGENTS.md + MEMORY.md + the essential user profile + the task brief. The
loop is AI SDK's `ToolLoopAgent` with a step limit, an AbortSignal and callbacks that write to the log. When an agent
runs on a harness (Claude Code, Codex), its working folder receives AGENTS.md (Codex reads it from there) and
Monsters' tools arrive as an MCP server. Claude Code reads neither settings files nor CLAUDE.md from the folder
(`--setting-sources ""`, D-079): AGENTS.md reaches it in the appended system prompt, and any harness configuration
written in the folder (`.claude/`, `.mcp.json`, CLAUDE.md, `.codex/`) is removed on every run.

### 5.4 Orchestrator
It is an agent like the others, with the name the user chose, plus three tools:
- `delegate({agent, goal, why, context_links, constraints, output_format, done_when})`: starts a sub-agent with
  targeted context and returns its summary (at most ~1,500 tokens) plus the paths of the notes it created. Several
  `delegate` calls in the same step start **in parallel**.
- `ask_user({question, options[2-4], recommended, blocking})`: sends the user a question with options on every
  active channel. Work that doesn't depend on the answer goes on.
- `team_*` (Phase 1, for onboarding): propose, create and edit agents.

The other monsters of a squad talk to each other with `ask_teammate({agent, question, context, context_links})`
(D-201): a monster at work, delegated or in its own chat, asks another member of its squad (never a coordinator) and
waits for the answer. It is a delegation from that monster, with its log, kill switch, caps and notes; the one asked
runs without the tool, so a question never becomes a chain.
- `access_request({access: web|service|browser, monster?, service?, project?, why})` (project leads too, D-130):
  asks the user for an access a squad monster is missing. It is a question in the questions store (app and Telegram,
  parked like an `ask_user`) with “Yes, grant” and “No”, which only the user in person can answer; on yes the core
  applies the change (Permissions, the project's Settings tab, browser) and writes `access_grant` in Activity.
Any request not addressed to a specific agent comes to it. It does simple requests itself: delegating costs tokens
(multi-agent uses many times more of them) and should be done only when it pays off.

### 5.5 DecisionGate and System 1
A single `DecisionPort` interface with the `/v1/systemone` contract (state + typed `choice`/`noul`/`score` questions →
answer + confidence), so Jev, Laya or a small LLM are interchangeable. Uses:
1. **ask or proceed?** before an agent's action or choice;
2. **who gets it?** routing a generic request among the team's agents;
3. **notify now or later?** (Phase 2, Telegram).

The gate is rules first, then a model:
- **proceeds on its own**: local, reversible actions within the goal (reading, searching, writing drafts and notes);
- **always asks**: publishing, writing to third parties, spending, irreversible deletion, changing the goal, matters
  of taste (tone, design) when the known preferences are not enough;
- **gray area**: the model decides; below the confidence threshold it becomes an `ask_user` with the recommended
  option.
Every decision is recorded (state, options, choice, who chose): it is the dataset to train Laya in Phase 2. The user
can change the rules (“you can publish without asking”).

Since 16/10 (D-067) System 1 is the squad's **instinct** (`packages/core/src/team/instinct/`): a single service that
answers the questions of every moment in one call, with a mode per use (`off`, `shadow`, `on`), two thresholds per use
and a fallback to rules. Besides the gate: “is it really done?” after every delegation (on the facts of the log), “is
it spinning its wheels?”, the question left in the text, the X-ray of the request (hint, tools, model level), the
brake on actions that leave the computer, injections in external data, memory and the monsters' report card. At the
end of a turn the core writes the receipt of the work, with “Undo the whole job”.

Since 16/10 (D-070) the brake covers **every** call of the native monsters (including read-only ones: `web_fetch`,
`web_search`, the browser) and its rules apply with any engine and mode; the instinct judges only the doubtful cases.
Every run has a **taint** (`RunTaint`, `instinct/taint.ts`) shared by its agents: from the first result from a
third-party source on, the data that leaves (addresses, searches, browser pages, terminal commands) is compared with
the notes read in the run, the profile and the memory. External texts lose invisible characters before reaching the
model (`agents/invisible.ts`). The **spending cap** (`team/spend.ts`) adds up the `costUsd` of `provider_usage` by day
and month, squad and monster, and stops the monsters using paid models (`RunBudget.spendCheck` and at the start of the
turn). The **limits of each job** (`team/run-limits.ts`, `settings.json` → `limits`, Settings → Models → Spending cap)
stop a run that runs away: steps, fresh tokens and dollars of the whole run, and tokens per delegated monster; the
requests served by a subscription harness have caps of their own (`limits.plan`). A stop at a limit logs the cap as
data (`error.data.limit`, `delegation.data.limit`) so the UI can word it. The MCP manager keeps the **fingerprint** of every server's tools (`mcp_pins:<name>` in the state) and pauses
new or changed ones.

### 5.6 Provider
Two kinds behind the same interface (draft in `research/02-provider-e-motore.md`):
- **model**: the loop is ours (OpenRouter free and pay-as-you-go, Mistral, Anthropic/OpenAI/Google via API, ChatGPT
  via SIWC, Ollama/LM Studio);
- **harness**: the loop belongs to an official external agent (Claude Code, Codex) and we read its events.
  Monsters' tools reach it via MCP (`/api/harness/mcp`) with the core's brake; its own (terminal, the plan's web
  search, services through Claude) go through Claude Code's HTTP hooks (`/api/harness/hook`), with the same
  `InstinctGuard` and the monster's stop hook (D-069). Since D-073, `PostToolUse` too on the plan's search and on
  services through Claude: the result taints the run, loses invisible characters and goes through the injection check
  (a removed block goes back to Claude Code with `updatedToolOutput`). Since D-074 the run is tainted already in
  `PreToolUse` and service errors arrive from `PostToolUseFailure` (they taint and receive the notice).

Every agent has a **fallback chain**. With `openrouter/free`, the model chosen on the first turn is **pinned for the
session**. A `RateBudget` per provider, shared by all agents, reads the rate-limit headers and queues instead of
failing (with 50 requests a day without credit it is indispensable). Onboarding explains that a one-time top-up of
$10 on OpenRouter raises the free limit to 1,000 requests a day, and that some providers of free models may use the
prompts for training.

### 5.7 Tools
| Group | Tools | Phase |
|---|---|---|
| Vault | `vault_search`, `vault_read`, `vault_list`, `vault_write`, `vault_edit`, `vault_move`, `vault_delete`, `vault_links`, `vault_tags`, `vault_history`, `vault_restore`, `vault_undo`, `vault_propose` | 1 |
| Web | `web_search` (engine chain: paid via OpenRouter when it is on and the key has credit, Brave if configured, then DuckDuckGo and Wikipedia; several questions at once with `queries`, D-071), `web_fetch` (page → Markdown, several pages with `urls`, passages with `find`) | 1 |
| Team | `delegate`, `ask_user`, `team_propose`, `team_create`, `design_monster` | 1 |
| System | `shell` (with timeout, per-agent cwd, truncated output, log), `fs_*` outside the vault | 2 |
| Integrations | MCP client (any server), installing and using CLIs, browser (Playwright/CDP) | 2 |

Small or free models get a reduced subset of tools, so as not to confuse them.

### 5.8 Auth and security
- **Local user** with email and password (argon2id) created on first start; a session with an `HttpOnly`,
  `SameSite=Strict` cookie. The CLI uses a token in `~/.monsters/` (permissions 600).
- The server listens **only on 127.0.0.1**; WebSocket with token and **Origin check** (the mistake that hit
  OpenClaw). Remote access goes through SSH (tunnel or CLI on the PC), never through an open port.
- Secrets (API keys, tokens) in `~/.monsters/secrets/`: encrypted (AES-256-GCM, `<name>.enc`) with a master key in the
  system keychain (Keychain, Credential Manager, Secret Service); where the keychain is missing or doesn't respond, a
  600 file as a fallback declared in the UI and in `monsters secrets` (D-042). On Linux without a D-Bus session or
  without a screen for the unlock prompt the fallback is immediate (30-90 ms); with a locked keychain on a desktop
  (GNOME after a restart with automatic login) the core shows the password prompt and waits for it for up to 20 s
  (`MONSTERS_SECRETS_TIMEOUT_MS`) before falling back: that is the case of someone sitting at the screen, so it is
  not shortened. Tests, smoke tests and e2e run with `MONSTERS_SECRETS=file` (D-086).
- **Telegram (Phase 2):** allow-list of user IDs, pairing with a code shown in the UI to add a new one, `/stop` as the
  kill switch.
- `SECURITY.md` and a reporting channel from the first public release.
- Accepted and declared risk: with “no blocks”, an agent that falls victim to prompt injection can do damage within
  the granted perimeter. Mitigations: a perimeter chosen by the user at onboarding, external content marked as data,
  the DecisionGate's “always ask” rules for actions toward the outside, the log and the kill switch.

### 5.9 Automations (D-094)
An automation is a file in `~/.monsters/automations/<id>.yaml` (name, lead, participating monsters, cron rule with
time zone, goal, results folder, cap per run, notices, `draft`/`active`/`paused` state), read with the schema in
`shared/src/automations.ts`. The scheduler (`core/src/automations/service.ts`, times computed with croner) computes
the next run at startup and after every run; every run is in the log (`automation_run_started`, `_finished`,
`_skipped`, `automation_change`). A run opens a run of its own for the lead (`Dispatcher.startAutomation`, channel
`automation`) and never gets into the user's work: if the lead is working it waits (an hour at most, then “skipped:
busy”), and a message written during the run waits for its end in a run of its own. The lead's chat doesn't see the
automations' runs (`recentConversation`, index `automations/run-index.ts`); the run reads only its own history. A
question parks the run (`waiting_user`) and the answer continues it in a new run of the same round. The kill switch and
the stopped state skip runs; runs missed while the core was off: one at startup if less than half an interval has
passed, otherwise “skipped”. API in `/api/automations`, CLI `monsters automations list|run <id>`.

### 5.10 Projects (D-097)
A project is a squad with its own perimeter: `~/.monsters/projects/<id>/project.yaml` (name, folder, notes area
`Progetti/<name>/`, lead, spending cap, connections, web search, `draft`/`active` state, archived), schema in
`shared/src/projects.ts`. The monsters stay in `~/.monsters/agents/` with `project: <id>` in the agent.yaml (absent =
Personal squad): no new column in the events, an event's project is that of its agent. A single `TeamService`
(`members(project)`, `lead(project)`, `projects()`) and a single `TeamManager` (lead, copies with their own memory, new
monsters, archive). The lead is `kind: lead`: inside the project it acts as the orchestrator (`delegate`, `ask_user`,
`team_propose_monster`, routing hints only over the project's monsters), but for the vault it is a monster like the
others (reads everything except `Privato/`, writes and deletes in `Progetti/<name>/**`); `orchestrator()` stays the
only orchestrator at the top. A generic message goes to the orchestrator; one to the project
(`POST /api/projects/:id/messages`, `to` with the project's id or name, `@Project`) goes to the lead. The orchestrator
hands over work with `project_send` (a message in the lead's chat, channel `system`, `from`), the lead does it in a
run of its own and its last message comes back as a `project_report` event, which the orchestrator reads on the next
turn or with `project_status` (tools that are loaded through tool search when there are many). The project's monsters
work in its folder (`cwd` of terminal, files and harness, folder granted for writing); the folder's CLAUDE.md and
AGENTS.md arrive in the “## Progetto” section of the prompt as data, never as instructions, and the harness neither
reads nor writes the folder's configuration (D-079). No monster writes the folder's CLAUDE.md or AGENTS.md; the
project's monsters, the lead and the orchestrator propose its new text with `project_docs_propose` (`project_docs_proposal`
event, a `docs` draft in “To review” with the diff): the core writes the file when the user applies it, only if it is
still the one the proposal was written against (D-113). A spending cap at three levels (squad, project, monster); a
connection assigned to `*` reaches the monsters of the Personal squad and those of the projects that chose it. API in
`/api/projects`.

## 6. Second brain

Full details in `research/04-second-brain.md`. In short:
- **Source of truth**: the vault's `.md` files, openable in Obsidian. The SQLite index (FTS5, tags, links,
  properties; vectors in Phase 2) lives in `~/.monsters/index/` and can be rebuilt from scratch.
- **Initial structure**: `Inbox/ Journal/ Projects/ Areas/ Resources/ People/ Archive/ Agents/<Name>/ Templates/
  Attachments/ README.md` in a new English vault, `Inbox/ Diario/ Progetti/ Aree/ Risorse/ Persone/ Archivio/
  Agenti/<Name>/ Modelli/ Allegati/ LEGGIMI.md` in an Italian one (simplified PARA). The vault's layout is decided once,
  when it is created, and recorded in `.monsters/vault.json`; an existing vault keeps its names (D-154). An existing
  Obsidian vault can be linked instead.
- **Conventions**: readable, unique file names, minimal frontmatter (`id`, `type`, `tags`, `created`, `updated`,
  `author`), lowercase hierarchical tags, short wikilinks. Notes created by hand without frontmatter are accepted as
  they are.
- **Permissions**: the orchestrator everywhere; sub-agents read everything (except `private: true`) and write in their
  own area, in `Inbox/`, in the notes they authored and in the areas granted; elsewhere they use `vault_propose`.
  Nobody touches `.obsidian/`, `.git/`, `.trash/`.
- **Reversibility**: one git commit for every action, with the agent and the action id; a snapshot of the changes the
  user made in Obsidian before an agent writes; deleting moves to `.trash/`; `vault_undo` undoes a whole action with
  a new commit. Every operation is in the log with the link to the commit.
- **Concurrency**: optimistic hash (`base_hash`), atomic writes, surgical edits, a watcher that reindexes external
  changes.

## 7. Onboarding and team generation

1. Creation of the local user (email and password).
2. First key: OpenRouter (link to create it, verification, notice about limits and privacy). Without a key you can try
   a local model if Ollama is there.
3. A single monster appears, the initial agent, which asks 5-7 questions one at a time (clickable options plus free
   text): the orchestrator's name, what you do, goals, tasks to delegate, tools you use, what they must never do
   without asking, tone and language.
4. **Permissions**: a single screen with what the agents will be able to do (vault, web, folders, shell, browser,
   accounts), all granted in one go and editable later.
5. The answers go into `profilo.md` in the vault. The orchestrator proposes the team (2-5 agents, one sentence of role
   each); the user confirms or edits.
6. For each agent an LLM produces a validated JSON (role, context, tools, vault area, color, genome) and the code
   renders it with a fixed template: short, consistent files.
7. The initial agent becomes the orchestrator with the chosen name; the team's monsters are “born” on the dashboard.

## 8. Interface

- **Layout** (D-056, `docs/design.md`): a full-height sidebar (the monsters, one row per chat with a monster, status,
  preview, time, unread and questions highlighted; then Notes, Activity and Settings) and content with a 52 px toolbar
  (title, actions, always-visible kill switch) that serves as the title bar in the desktop app. Monsters' bubbles
  with a light tint of their color, the user's in the accent. On the phone the sidebar is the home screen and views
  open full screen with Back. The agent's terminal in a side panel.
- **Style**: neutral, opaque surfaces, a single accent, no glass (`backdrop-filter`) and no animated backgrounds:
  with glass the app dropped to 15 fps. Contrast of at least 4.5:1 verified by `apps/web/test/contrast.test.ts`,
  “Reduce motion” and `prefers-reduced-motion`, off-screen monster animations suspended. Light and dark themes.
- **The agent's terminal**: a structured, readable log (thinking, tools, results, errors, collapsible sections);
  xterm.js only for the real shell (Phase 2).
- **Language** (D-153, `docs/i18n.md`): English first, with Italian as a choice. Short, friendly sentences, no jargon.

## 9. The monsters

- **Parametric SVG**: a JSON genome (body, eyes, mouth, horns, ears, tail, legs, spots, tuft, hue, personality)
  combines vector parts drawn once, with anchors and pivots. Colors derive from the hue in OKLCH (a dark outline of
  the same hue, shadows, belly). Same name → same monster.
- **Shared animations** on all monsters: idle (breathing, eyelashes), talk, think, celebrate, error; walking in
  Phase 2 with a small steering engine of ours. Personality modulates amplitude and speed.
- **Generator** `design_monster`: for every new agent the LLM produces a genome constrained to the schema, the code
  validates it and keeps it apart from the hues already used.
- **The 7 monsters** each take a trait from their Saturn moon (e.g. Mimas a cyclops like the Herschel crater,
  Enceladus with a geyser tuft). The maintainer chooses the concepts.
- The external style reference (not included in the repo) is **reference only**: no img2img, no derived assets.

## 10. How we develop (the agentic system applied to ourselves)

The same pattern as the product: orchestrator, sub-agents with targeted context, memory in files.

- **Orchestrator** (the main session): plans from the ROADMAP, writes the brief for every task, delegates, verifies,
  integrates, updates the internal progress record and `DECISIONS.md`.
- **Sub-agents per area**: core, vault, provider, UI, monsters, tests. Each receives: goal, files and documents to
  read, constraints, completion criterion. It returns: done, files touched, decisions, open problems.
- **Parallel work** on separate git worktrees when tasks don't touch each other; never two agents on the same files.
- **Whoever does doesn't judge**: every milestone goes through a different reviewer agent (correctness, security) and
  the automated tests. The UI is checked with real screenshots (chrome-devtools) in light and dark themes.
- **Definition of done** for every task: typecheck, lint and tests green in CI; for visible features, a recorded
  e2e demo.
