# Contributing to Monsters

Thanks for your interest. Monsters is a local-first, provider-agnostic agentic hub with a desktop
app for Linux, Windows and macOS. Contributions of all kinds are welcome: bug reports, ideas,
docs, code.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Security problems
go through [SECURITY.md](SECURITY.md), never through public issues.

## Setup

- Node 24.
- pnpm 12.11.2, pinned in `packageManager`. Enable it with `corepack enable`.

```sh
pnpm install
pnpm desktop:dev   # run the desktop app in development
```

## Repository layout

pnpm monorepo.

| Path                    | What it is                                                           |
| ----------------------- | -------------------------------------------------------------------- |
| `packages/shared`       | Shared schemas and types (events, API, ids)                          |
| `packages/db`           | SQLite adapter and namespaced migrations                             |
| `packages/core`         | Event log, auth, kill switch and local server                        |
| `packages/providers`    | Model providers: registry, fallback chains, shared rate budgets      |
| `packages/tools`        | Built-in agent tools (web search, web fetch)                         |
| `packages/vault`        | Obsidian-compatible Markdown vault, SQLite index, git history        |
| `packages/cli`          | The `monsters` command                                               |
| `packages/remote`       | Client mode: SSH tunnel to a core running on another machine         |
| `packages/monster-kit`  | Parametric SVG monster kit: genome, parts, palettes, renderer        |
| `apps/web`              | Web UI: chat per monster, terminal, notes, action log, kill switch   |
| `apps/desktop`          | Electron desktop app                                                 |
| `apps/update-server`    | Cloudflare Worker serving the desktop update feed                    |

Architecture notes live in `docs/ARCHITECTURE.md`.

## Commands

```sh
pnpm typecheck                      # TypeScript, whole workspace
pnpm lint                           # ESLint + scripts/check-public.ts
pnpm test                           # Vitest, all packages
pnpm format                         # Prettier
pnpm build
pnpm --filter @monsters/web test:e2e
pnpm ci:local --quick               # the CI checks, locally
```

`pnpm lint` includes `scripts/check-public.ts`, a guard that blocks personal data, private hosts
and paths, and secret patterns in tracked files. If it fails, remove the offending content rather
than silencing the check.

Before opening a PR, `pnpm typecheck && pnpm lint && pnpm test` must pass.

## Tests

- Tests are written with Vitest, next to each package in `test/`.
- Unit tests never use real accounts or the network. Use fakes and fixtures.
- Run them with `MONSTERS_SECRETS=file` and `MONSTERS_EMBEDDINGS=off` so they touch neither the
  system keychain nor embedding models (the test scripts already do this).
- A change in behavior comes with a test.

## Code style

- TypeScript in strict mode, ES modules.
- Erasable syntax only (no enums, namespaces or parameter properties): the code runs directly on
  Node's type stripping.
- Relative imports include the `.ts` extension.
- Prettier formats everything; run `pnpm format`.
- Dependencies are pinned to exact versions, and we keep them few. Think twice before adding one,
  and say why in the PR.

## Languages

- Code, comments and commit messages for public PRs: English.
- UI copy: Italian and English, both required.
- `docs/` technical documentation is mostly in Italian; community documents (README,
  CONTRIBUTING, issue templates, security and conduct policies) are in English.

## Commits and pull requests

- Keep PRs small and focused, and link an issue. For anything big, open an issue first to agree
  on the direction.
- Record non-obvious technical choices in `docs/DECISIONS.md` (context, choice, reason).
- Fill in the PR template.

### Developer Certificate of Origin (DCO)

Every commit must be signed off to certify that you have the right to submit it under the
project license. Add the sign-off with:

```sh
git commit -s -m "Fix the thing"
```

This appends `Signed-off-by: Your Name <you@example.com>`, using your git `user.name` and
`user.email`. To sign off commits you already made: `git rebase --signoff main`.

By signing off you agree to the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
(more at <https://developercontributor.org/>). In short, you certify that:

1. the contribution was created by you, in whole or in part, and you have the right to submit it
   under the project's open source license; or
2. it is based on previous work that is covered by an appropriate open source license and you
   have the right to submit it with modifications under the same license; or
3. it was provided to you by someone who certified (1) or (2) and you have not modified it; and
4. you understand that the contribution and your sign-off are public and kept indefinitely.

There is no CLA. You keep the copyright on your contributions and license them under
[Apache-2.0](LICENSE), the license of the project.

## Using coding agents

Working with coding agents is welcome. The repository includes `AGENTS.md` and `CLAUDE.md` with
the project rules; point your agent at them. You remain responsible for what you submit: review
it, run the checks and sign off the commits yourself.
