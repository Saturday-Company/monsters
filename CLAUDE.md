# Monsters

See [`AGENTS.md`](AGENTS.md): it is the main guide (commands, structure, conventions, pre-PR checklist) and applies to
every coding agent.

Key rules, in short:

- Code, comments, guides and community files in English; `docs/DECISIONS.md`, `docs/research/` and `docs/eval/` are an
  Italian archive. The app is English first with Italian as a choice: visible texts live in `*.strings.ts` EN/IT
  dictionaries (`docs/i18n.md`).
- TypeScript strict, ESM, erasable syntax only, relative imports with the `.ts` extension.
- Every agent action goes through `EventLog.append`; every job starts from `RunController.startRun` with its
  `AbortSignal`; child processes are started with `scope.spawn` so the kill switch reaches them.
- Run JavaScript scripts with `nodeRuntime()` from `@monsters/shared/node`, never `process.execPath`.
- New tables are numbered migrations in their own namespace; never edit an applied one.
- Tests never use real accounts or the real keychain (`MONSTERS_SECRETS=file`, `MONSTERS_EMBEDDINGS=off`).
- Before a PR: `pnpm typecheck`, `pnpm lint`, `pnpm test`; sign off commits (DCO).
- Record non-obvious technical decisions in `docs/DECISIONS.md`.

Personal instructions for your own setup can go in `CLAUDE.local.md`, which is gitignored and never committed.
