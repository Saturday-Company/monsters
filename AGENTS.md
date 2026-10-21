# Monsters: guide for contributors and coding agents

Monsters is a local-first, provider-agnostic agentic hub: a team of AI agents ("monsters") that run on your own
computer, with an Obsidian-compatible vault, an action log, spending caps and a kill switch. Architecture is in
`docs/ARCHITECTURE.md`, technical decisions in `docs/DECISIONS.md`, direction in `docs/ROADMAP.md`, the security model
in `docs/security-model.md`. Most of `docs/` is in Italian.

## Commands (Node 24, pnpm 12)

- `pnpm install` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format` · `pnpm build`
- CLI: `pnpm --filter @monsters/cli exec monsters start|status|kill|resume|chat|answer|vault reindex|mcp|password`.
  `password` sets a new account password on the machine running the core (asked twice, closes all sessions); `mcp` is
  the vault's stdio MCP server for Claude Desktop and other clients (`docs/mcp-vault.md`); `chat` without text opens the
  interactive terminal chat, also over SSH. The Telegram bot lives in `packages/core/src/channels/telegram/`, with
  per-monster bots in `bots.ts` (one polling loop per token, one conversation per chat with `thread`); in tests use the
  fake Bot API `packages/core/test/telegram-fake.ts`, never real bots. See `docs/remote.md`.
- Desktop app: `pnpm desktop:dev` (bundles the core, builds `apps/desktop`, runs Electron on your usual
  `MONSTERS_HOME`); `pnpm --filter @monsters/desktop test:e2e` (Playwright `_electron` under `xvfb-run`; needs
  `pnpm build:core`; the client-mode e2e tests use a throwaway sshd and skip without `/usr/sbin/sshd`;
  `MONSTERS_E2E_SHOTS=<folder>` saves screenshots), also `… screenshots` and `… icons`. The app logs to
  `<home>/logs/desktop.log`. On first launch (no `connections.json` in the user data) the app asks where the monsters
  work and does not start the core until you answer; the e2e `launch()` helper and `install-probe.mjs` answer "On this
  computer" with Enter, and scripts that do not look at the window write a `connections.json` first.
- Web UI: `pnpm --filter @monsters/web build` (served by the core at `/`), `… dev` (Vite, also `?mock=demo` for fake
  data), `… test:e2e` (flows against the mock core), `… test:e2e:core` (build + real core with a fake provider),
  `… test:e2e:onboarding` (onboarding on the real core). First time: `pnpm --filter @monsters/web exec playwright
  install chromium`. The web e2e run in English; `lingua.e2e.ts` covers Italian.
- Website: `apps/site` (Astro, static, D-144): `pnpm site:dev`, `pnpm site:build` (`MONSTERS_SITE_OFFLINE=1` skips the
  feed and GitHub calls), `pnpm site:deploy [-- --dry-run]` (assets-only Worker `monsters` on workers.dev via `cf`).
  Monsters come from `@monsters/monster-kit`, never from reference images.
- Packaged core: `pnpm build:core` (web UI + esbuild bundle in `packages/cli/dist-bundle/`; externals listed in
  `EXTERNALS` in `scripts/build-core.ts`), `pnpm smoke:bundle` (runs the bundle under Node 24 and under Electron as
  Node).
- Data lives in `MONSTERS_HOME` (default `~/.monsters`). For experiments use a temporary folder, and pass the same
  `MONSTERS_HOME` (or `--home`) to `status`, `kill`, `answer` and `automations`; without it they talk to the core in
  `~/.monsters`. Ports 4791 and 5181 are fixed for the onboarding e2e tests (and CI): start a hand-run test core on
  another port (e.g. `--port 4810`). New project folders go in `<folder above MONSTERS_HOME>/Monsters Progetti`.
- CI: `pnpm ci:local` runs the CI steps on a clean checkout of a commit, plus the packaged-core smoke test and a
  `package` step (installs the built package from scratch, registers from the window, uninstalls); `--quick` skips
  e2e, smoke and packaging. `pnpm ci:mac` and `pnpm ci:windows` run it on a macOS machine and a Windows VM that you
  provide. Details, flags and results format in `docs/ci.md`. Optional hook: `git config core.hooksPath
  scripts/git-hooks` (pre-push with `--quick`).
- GitHub Actions (`.github/workflows/ci.yml`, D-152): pull requests run the light jobs required by the ruleset
  (`linux`, `unit (windows-latest)`, `unit (macos-latest)`); every push to `main`, and `gh workflow run ci.yml --ref
  <branch>`, run the full CI on the three systems, `full (linux|windows|macos)` = `node scripts/ci-local.ts --github`
  (e2e everywhere, unsigned packages installed and uninstalled on the runner, packages kept as artifacts for 3 days).
  No secret is used there: signing and publishing stay local.
- Release gate (D-147, D-152): the full CI must be green on the commit on the three systems. `pnpm release:check`
  shows it, per system from the `full (…)` check runs of a push or manual run of this repo (never a PR) or from
  local results (`--source auto|github|local`, `MONSTERS_CI_GATE`); `pnpm release:ci` follows or starts the
  GitHub run for HEAD and then runs the harness tools probe locally (`--local`: `ci:local`, `ci:windows`, `ci:mac` in
  sequence, then posts `local-ci/*` commit statuses with `pnpm ci:status`); `pnpm desktop:publish` refuses to publish
  while the gate is closed (`--skip-ci-gate` overrides it, loudly). Status descriptions never carry paths, hosts or
  personal data.
- Packaging and signing (details in `docs/signing.md`): `pnpm desktop:pack` (unpacked folder for this system),
  `pnpm desktop:dist --linux|--win [--arch x64,arm64] [--version v] [--feed url] [--target AppImage]` (output in
  `apps/desktop/release/`), `pnpm desktop:dist:mac` (macOS only). A build with an update feed needs a public key in
  `apps/desktop/build-resources/update-keys/` (`pnpm desktop:update-key`); `pnpm desktop:publish` signs the update
  manifests. Update tests: `pnpm desktop:update-e2e`, install tests: `pnpm desktop:install-test --linux|--mac`. Tests
  that open windows run in Xvfb only, never on your desktop.

## Structure

- `packages/shared`: zod schemas of events and API, ULID, agent ids; `@monsters/shared/node` is Node-only (Node for
  child processes, npm, PATH from the login shell).
- `packages/db`: SQLite adapter (`node:sqlite`) and per-namespace migrations, used by core and vault.
- `packages/core`: config, event log, auth, kill switch, Hono server and WebSocket, agent runtime (`src/agents/`: agent
  folder, AGENTS.md template, `runAgent`), team, orchestrator and DecisionGate (`src/team/`), first run and team
  generation (`src/onboarding/`), composition of vault, providers and team at startup (`src/hub.ts`).
- `packages/providers`: `Provider` interface, registry, OpenRouter, fallback, pinned model, `RateBudget`; subscriptions:
  `chatgpt` with Sign in with ChatGPT (`src/chatgpt`), Claude Agent and Codex harnesses (`src/harness`); fake provider,
  fake OpenAI and fake `claude`/`codex` binaries in `@monsters/providers/testing`. User guide in `docs/subscriptions.md`.
- `packages/tools`: built-in tools (`web_search` with a swappable backend, `web_fetch`, `shell` and `fs_*` on granted
  folders in `src/system/`); per-agent permissions are in `packages/core/src/team/permissions.ts`.
- `packages/vault`: the Markdown vault (parser, index, git per action, trash, undo, MCP server).
- `packages/monster-kit`: the SVG parts, genome and generator of the monsters' characters.
- `packages/cli`: the `monsters` command.
- `packages/remote`: SSH client mode: profiles, tunnels with the system `ssh`, server key confirmed on first use,
  reconnection, Origin rewriting for the app window. No Electron dependency; a throwaway sshd lives in
  `@monsters/remote/testing`.
- `apps/web`: web UI (React, Vite); the core serves it from `apps/web/dist`. Mocks only in development
  (`src/lib/mock`).
- `apps/desktop`: Electron app; `src/main` (core in a `utilityProcess` or attached, automatic sign-in, navigation
  rules, tray and menu, client mode), `src/preload`, `src/fuses.ts`. The non-Electron part is tested with Vitest in
  `test/`. The app's core talks to `packages/cli/src/desktop-bridge.ts`.
- `apps/update-server`: the update feed server.

## Conventions

- Code and comments in English. UI copy is Italian and English. Documentation in `docs/` is mostly Italian; community
  files (README, CONTRIBUTING, SECURITY, AGENTS) are in English. Commit messages are in English for public
  contributions, short, and signed off (`git commit -s`, see the DCO in `CONTRIBUTING.md`).
- TypeScript strict, ESM, erasable syntax only (no enums or namespaces): Node runs the `.ts` files directly. Relative
  imports include the `.ts` extension.
- Packages are imported from source (`exports` point to `src/index.ts`); `dist/` is only for publishing.
- Every agent action goes through `EventLog.append`. Every job starts from `RunController.startRun` and uses its
  `AbortSignal`. Child processes are started with `scope.spawn` so the kill switch reaches them. A JavaScript script is
  run with `nodeRuntime()` from `@monsters/shared/node`, never with `process.execPath` (inside the app that is
  Electron, which with the `RunAsNode` fuse off does not behave as Node: there `nodeRuntime()` is the `node` on the
  PATH, or `null`).
- New tables are numbered migrations in their own namespace (`migrate(db, 'vault', …)`); never edit an applied one.
- Few dependencies, exact versions. Vitest tests live in `test/` next to each package.
- Tests never use real accounts, real bots or the real keychain: use `MONSTERS_SECRETS=file` (set in CI, e2e and
  `smoke:bundle`), and `MONSTERS_EMBEDDINGS=off` so tests never download the embedding model (already set in
  `vitest.config.ts`). A real-keychain check on Linux runs in a throwaway D-Bus session:
  `scripts/test-keychain-linux.sh`.
- Optional real tests need your own keys and are skipped without them: OpenRouter integration tests with
  `MONSTERS_TEST_ENV_FILE=<.env with OPENROUTER_API_KEY> pnpm test integration` (a handful of free requests per
  suite); real Wikipedia search with `MONSTERS_TEST_NETWORK=1 pnpm test wikipedia`; semantic search with the real
  model on ~200 notes with `MONSTERS_TEST_NETWORK=1 pnpm test semantic-real` (downloads ~120 MB the first time).
- Evals are outside CI, use real requests and cost a little: agent behavior `pnpm --filter @monsters/core eval --case
  post --times 3`; large-MCP-server context `eval:context`; compaction `eval:compaction`; the instinct gate
  `eval:instinct` (`--dry-run` makes no calls, `--cap` sets a spending cap); the Claude Agent usage comparison in
  `packages/core/eval/automatica/` runs against your own Claude plan and consumes its quota. Method and results are in
  `docs/eval/`; cases are in `packages/core/eval/`.
- Third-party reference material (watermarked images, other products' assets) never goes into the product.

## Before you open a PR

1. `pnpm typecheck`
2. `pnpm lint`: it also runs `scripts/check-public.ts`, which blocks personal data, private IPs and paths, and secret
   patterns in the repo.
3. `pnpm test` (and `pnpm format:check`). For UI changes also the relevant e2e tests; for risky changes on a specific
   OS, `pnpm ci:local` or the matching `ci:*` script.
4. Record non-obvious technical decisions in `docs/DECISIONS.md` (context, choice, rationale).
5. Sign off your commits (`git commit -s`) and describe what changed and why in the PR.
