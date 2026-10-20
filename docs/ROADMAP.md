# Roadmap

Where Monsters has been and where it is going. The project is in **alpha** (0.1.0-alpha.18). Phases close only when all
their completion criteria are verified: green automated tests plus a working end-to-end demo. Design rationale for each
choice lives in [`DECISIONS.md`](DECISIONS.md) (decision ids like D-045 below), the structure in
[`ARCHITECTURE.md`](ARCHITECTURE.md). Contributions to the open items are welcome: see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Phase 0 · Research and architecture (done)

Research on prior art and license, providers and engine, agents and the fast decision layer ("System 1"), the second
brain, and the monsters and interface (`docs/research/`). `ARCHITECTURE.md` and `DECISIONS.md` written; license and the
first agents chosen.

## Phase 1 · MVP (done)

Goal: a user installs Monsters on their computer, creates an account, answers a few questions, gets an orchestrator and
a team, asks for a job and sees it done, with the result in their Obsidian vault.

- **Foundations.** pnpm monorepo, Node 24, strict TypeScript, Vitest, CI on Linux, macOS and Windows. Zod schemas for
  events and API. Core with SQLite, the **event log**, a Hono server on 127.0.0.1 with WebSocket. Local auth (argon2id,
  sessions, CLI token, Origin check). The **kill switch**: hierarchical `AbortController`, persisted "stopped" state.
- **Second brain.** A vault with an initial structure or linked to an existing one; parser for frontmatter, wikilinks,
  embeds, tags; SQLite index (FTS5) with an incremental watcher; `vault_*` tools with per-agent permissions; one git
  commit per action with undo, restore and trash; every operation in the action log with the commit SHA.
- **Providers and agent runtime.** `Provider` interface, OpenRouter (free and paid), fake provider for tests, fallback
  chains, pinned model per session, shared `RateBudget` with a queue. Agent folders (`AGENTS.md`, `agent.yaml`,
  `genome.json`), step-limited loop with abort and per-step logging. `web_search` and `web_fetch`.
- **Orchestrator and decisions.** `delegate` with targeted context and a summary back, parallel delegation, `ask_user`
  with 2-4 options and a recommended one, `DecisionGate` (rules plus a small LLM behind `DecisionPort`).
- **Monsters v1.** A deterministic SVG generator (parts with anchors, genome, OKLCH colors) and a `<Monster>` component
  with idle and expressions.
- **Web interface.** Chat with streaming and clickable options, dashboard, per-agent terminal, action log with undo,
  always-visible kill switch, settings, light and dark themes, contrast checked automatically.
- **Onboarding.** Account, first OpenRouter key, a short interview, permissions, a proposed team and generated agent
  files.

Verified with an end-to-end demo from a clean install (create account, onboard, delegate research and writing, one
question with options, notes in Obsidian, edit in Obsidian then undo from the UI, kill mid-job), green CI on Linux,
macOS and Windows.

## Phase 2 · Integrations, advanced second brain, living monsters (done)

- **Tools.** Shell and file tools outside the vault on granted folders (timeouts, truncation, per-agent permissions;
  the kill switch stops long commands and their children in under 2 s). MCP client (stdio and HTTP, per-agent tools,
  results marked as external data) and a browser as a preconfigured Playwright MCP server.
- **Channels.** Telegram (grammY): allow-list, pairing code, buttons for questions, `/stop`. Remote access over SSH with
  `monsters chat`.
- **Providers.** Anthropic, OpenAI, Google, Mistral, Groq via `@ai-sdk/*`; Ollama and LM Studio. Subscriptions: Sign in
  with ChatGPT, the Codex harness, and the official Claude binary as the "Claude Agent" harness (clean environment,
  the user's own login, `~/.claude` never read by Monsters). See [`abbonamenti.md`](abbonamenti.md).
- **Second brain.** Local multilingual embeddings, hybrid search (RRF), related notes, Italian stemming, vault views
  (notes, backlinks, graph, trash, history), and an MCP server exposing the vault to other clients
  ([`mcp-vault.md`](mcp-vault.md)).
- **Living monsters.** Walking on the dashboard with a steering engine, speech bubbles showing what they are doing,
  click to open the terminal, expressions with Motion, personalities; 60 fps with seven agents; reduced motion honored.
- **Instinct (System 1).** Decision dataset export and a baseline comparison. A hosted small model is the default
  engine of the gate; a custom-trained model is deferred until the log holds enough decisions.

## Phase 3 · Desktop app (in progress)

Electron app for Linux (AppImage, deb), macOS (dmg arm64 and x64) and Windows (NSIS installer), with automatic updates
and secrets in the system keychain. Two modes: **local** (the core runs inside the app) and **client** (connects over
SSH to a core running on another machine).

Done:

- A bundleable core (M3.0): core and CLI compiled with a bundler, configurable Node runtime for child processes,
  PATH rebuilt from the login shell, UI from `MONSTERS_WEB_DIST`.
- The local app (M3.1, D-045): core in a `utilityProcess` or attached to one started from the CLI, automatic sign-in
  with a one-time token, kill switch in menu and tray, restart of a crashed core, hardened Electron (sandbox,
  `contextIsolation`, fuses, navigation locked to the core).
- Secrets in the system keychain (M3.2, D-042) with a declared file fallback (`MONSTERS_SECRETS=file`) and migration.
- Client mode over SSH (M3.3, D-044): profiles, tunnel through the system `ssh`, verified host key, reconnection.
- Packages, signing and updates (M3.4, D-046): electron-builder, signed update manifests, an update channel. See
  [`signing.md`](signing.md).
- Install-from-scratch checks in CI on all three systems (M3.5, D-048).
- Projects, the orchestrator as head of all teams ("Dio dei mostri"), and scheduled automations, with drafts under
  **Da rivedere** that need your confirmation; a Claude-subscription model mode that picks model and effort per
  sub-task; a Blender MCP server in the connector gallery.

Open:

- **Windows code signing with a certificate from a public CA.** The installer is currently not publicly signed
  (SmartScreen warns); update manifests are already signed with the project's key.
- **Turning off or neutralizing the `RunAsNode` Electron fuse before a public beta.** With it on, on macOS any program
  of the same user can launch the app's signed binary as Node and inherit its keychain permissions. Options: a separate
  signed Node used only for JavaScript child processes, or keychain access inside the app process over an
  authenticated channel to the core.
- **Moving release signing from a personal identity to an organization** (Apple and Windows).

## Toward a stable release (in progress)

A review in October 2026 produced waves of fixes; the first four are done.

- [x] Quick fixes: core, connectors, security, interface.
- [x] Money, limits and reliability: true spend tracking, MCP OAuth, search, stuck runs, lost work, Telegram, updates.
- [x] Defenses on newer paths: outgoing MCP, memory, dedicated bots, CLI token, project folders.
- [x] Interface: names, jargon, a crashed core, sidebar, chat, "Da rivedere".
- [x] Honest access reporting: monsters only see tools they can actually run, report the real cause of a failure, and
  ask for missing access with one tap; publishing always asks for confirmation.
- [ ] Release wave: signed updates on all systems, Windows certificate, `RunAsNode`, a week-long soak test, then a beta.

Completion criteria: no open Blocker or High issue; a test for every fix; green CI on the three systems and a
clean-clone walkthrough on video; a week of use without crashes or stalled automations.

## Later

- A project website and public documentation (the landing site is live).
- A mobile app.
- Optional hosted services around the open-source core: account, managed keys, hosted decision model, encrypted vault
  backup, relay for Telegram and mobile. The local core will always work without an account.
- Commercial approval for Sign in with ChatGPT and a review of the Anthropic commercial terms before any hosted
  offering.
- A custom-trained fast decision model, once enough logged decisions exist to beat the hosted baseline.
