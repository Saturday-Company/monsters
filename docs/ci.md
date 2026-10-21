# CI

How Monsters is checked before and after a commit: lightweight GitHub Actions on pull requests, the full CI on the
three systems on GitHub Actions at every push to `main` (D-152), which is also the gate of every release; the local CI
on Linux, Mac and Windows stays as an alternative and a fallback (D-147), plus an optional cloud CI. The steps are the
same everywhere (`scripts/ci-local.ts`); what changes is where they run. Signing and publishing stay on the
maintainers' machines: GitHub holds no secrets.

## GitHub Actions

`.github/workflows/ci.yml` has two groups of jobs.

**On pull requests** (fast, required by the `main` ruleset: `linux`, `unit (windows-latest)`,
`unit (macos-latest)`):

- **`linux`:** install (`pnpm install --frozen-lockfile`), typecheck, lint (including `scripts/check-public.ts`, the
  check that no private data is in the repo), format check, unit tests (with `TZ=Pacific/Kiritimati`, D-148) and the
  UI's e2e tests (Playwright: flows with a fake core, the UI against a real core, onboarding).
- **`unit (…)`, Windows and macOS:** typecheck and unit tests (longer timeouts on Windows, where the tests that start
  a real core or git are slower).

Pull requests from a fork receive no secrets (there are none anyway) and don't open the gate: their jobs run the
fork's workflow file.

**On every push to `main` and by hand** (`workflow_dispatch`: `gh workflow run ci.yml --ref <branch>`, also on
another branch): the full CI, `full (linux)`, `full (windows)` and `full (macos)`, which is `node scripts/ci-local.ts
--github`. The same steps as the full `ci:local`, in the runner's checkout (no worktree), with the output of each
step in a collapsible group of the job's log:

| Step | Linux (`ubuntu-24.04`) | Windows (`windows-latest`) | macOS (`macos-latest`, arm64) |
|---|---|---|---|
| install, typecheck, check-public, lint, format, test | yes (tests with `TZ=Pacific/Kiritimati`) | yes (30 s timeout) | yes |
| UI build, e2e (mock, real core, onboarding) | yes (Chromium with `--with-deps`) | yes | yes |
| `build:core` + `smoke:bundle` (Node 24 and Electron as Node) | yes | yes (without the SIGTERM stop, which Windows doesn't have) | yes |
| `package` (`desktop:install-test`) | AppImage + deb, in Xvfb; the deb in an Ubuntu 24.04 chroot (the runner's passwordless sudo) | **unsigned** NSIS installer (`MONSTERS_WIN_SIGN=off`), installed per user, registration from the window, uninstalled (`install-test --win`, `test-windows.ps1` without a certificate) | arm64 dmg signed ad-hoc, **never notarized** |
| `update-e2e` (AppImage 0.0.1 → 0.0.2, feed signature) | yes | no | no |

- Environment as in D-148: `MONSTERS_SECRETS=file`, `MONSTERS_EMBEDDINGS=off`, `TZ=Pacific/Kiritimati` for the tests
  on Linux; `CSC_IDENTITY_AUTO_DISCOVERY=false` and `MONSTERS_MAC_NOTARIZE=0` so that a signing identity is never
  looked for. Lint runs with `--max-old-space-size=4096` (on the 7 GB macOS runner the default limit isn't enough).
- Cache: the pnpm store (`setup-node`), and with `actions/cache` tied to `pnpm-lock.yaml` the Electron and
  electron-builder downloads, Playwright's Chromium and (Linux) the Ubuntu base image of the deb test.
- Artifacts: `ci-results-<system>` (JSON and logs in the `ci:local` format, `runner: "github"`, 14 days) and
  `packages-<system>` (AppImage and deb, exe, dmg; 3 days). They are **test builds** (a feed nobody answers on;
  `publish-update.ts` refuses them) and unsigned: they are for trying by hand, not for distributing.
- Duration (October 2026): about 25 minutes on Linux and Windows, 32 on macOS (the e2e tests with the fake core are
  the longest part: 9-17 minutes). Job timeout 90 minutes; `concurrency` per ref: a new push to `main` stops the
  previous run.

The tests never download the embedding model (`MONSTERS_EMBEDDINGS=off`) and never touch the system keychain
(`MONSTERS_SECRETS=file`).

## Local CI: `pnpm ci:local`

The same steps as the `full` jobs of `ci.yml` on a clean checkout of the commit: locally the e2e tests only run on
Linux, and the `package` step (M3.5, D-048: packages are installed from scratch, registered from the window and
uninstalled; the deb needs `sudo -n`) is done on Windows by `ci:windows` in the VM. `smoke-bundle` tries the bundle
under Node and under Electron as Node; where the Electron binary isn't there (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`: the
Windows VM, the cloud CI) only under Node. On Windows the SIGTERM stop doesn't exist: the smoke test kills the process
and says so. About 5-6 minutes on a 16-core machine.

| Option | Effect |
|---|---|
| `--quick` | without e2e and package |
| `--no-package` | without the `package` step |
| `--keep` | keeps the working folder (useful to understand a red) |
| `--commit <rev>` | tries that commit instead of `HEAD` |
| `--github` | the mode of the `full` jobs (above): in the checkout itself, e2e and `package` on all three systems, packages copied to `MONSTERS_CI_ARTIFACTS` |

The result is in `ci-results/<date>-<commit>-<os>.json` + `.log` (folder ignored by git; the `CiResult` format is in
`scripts/ci-local.ts`).

**Optional hook:** `git config core.hooksPath scripts/git-hooks` turns on a pre-push that runs `ci:local --quick`.

## A Mac reachable over SSH: `pnpm ci:mac`

Runs the commit's `ci-local.ts` on a Mac as the user `monsters-ci` (in the design, an unprivileged user that can't see
the signing secrets: see `docs/signing.md`), everything in `~/monsters-ci` on the Mac; the results come back to the
same `ci-results/`. Here too there is the `package` step (arm64 dmg, always signed ad-hoc), which can be skipped with
`--quick` / `--no-package`. `pnpm desktop:dist:mac` uses the same script for the signed packages.

The Mac is configured with environment variables or with `scripts/ci.local.env` (ignored by git, `KEY=value` lines):

```sh
# scripts/ci.local.env
MONSTERS_MAC_HOST=100.64.0.1          # the Mac's address (LAN, VPN, Tailscale…)
MONSTERS_MAC_USER=alice               # SSH user on the Mac
MONSTERS_MAC_KEY=~/.ssh/id_ed25519    # SSH key
```

**Exit 75** = the Mac is off, unreachable or busy with another run: try again later, it isn't a red of the code.

## A local Windows VM: `pnpm ci:windows`

`pnpm ci:windows [--keep] [--fresh] [--no-package] [--commit <rev>]` runs `ci:local` in a local Windows VM
(QEMU/KVM) and reports the result in `ci-results/`. The VM lives outside the repo, in `$MONSTERS_WINVM_DIR` (default
`~/.local/share/monsters/winvm`: Windows ISO, disk, answers of the automatic installation) and starts again from the
`ci-base` snapshot every time. The `package` step builds the installer on Linux before turning the VM on and tries it
in the same run after `ci:local`.

| Variable | Default | What it does |
|---|---|---|
| `MONSTERS_WINVM_DIR` | `~/.local/share/monsters/winvm` | the VM's folder |
| `MONSTERS_WINVM_SSH_PORT` | 22522 | local port forwarded to the VM's SSH |
| `MONSTERS_WINVM_CPUS` | 6 | processors |
| `MONSTERS_WINVM_MEM` | 6G | memory (don't run heavy builds together with the VM) |

`scripts/ci-windows.sh` holds the commands to create and update the VM (`scripts/ci-windows.autounattend.xml` and
`scripts/ci-windows.setup.ps1` for the automatic installation).

## The gate of every release: `pnpm release:ci` and `pnpm release:check`

There is no nightly CI any more (D-147). The full CI on the three systems must be green **on the commit that goes
out**, and the release doesn't start without it. Since D-152 the default source is the `full (…)` jobs of GitHub
Actions; local results stay as a fallback, system by system.

- `pnpm release:ci [--commit <rev>] [--no-probe] [--no-wait]` (default, GitHub): the commit has to be on origin. If
  there is already a run of the workflow for that commit started by a push or by hand, it follows it (`gh run
  watch`); if there isn't, it starts one (`gh workflow run ci.yml --ref <branch>` on an origin branch that has the
  commit at its tip: a manual start begins from a branch, not from a hash); if the last one is red it says so, with
  the command to rerun the failed jobs (`gh run rerun <id> --failed`). `--no-wait` starts it or points to it and
  stops there.
- `pnpm release:ci --local [--commit <rev>] [--no-probe] [--no-status]`: as before D-152, it runs `ci:local`,
  `ci:windows` and `ci:mac` in a row (with the commit's full hash) and stops at the first red. A Mac with exit 75
  (off, unreachable or busy) is reported clearly and isn't a red of the code: turn it on and run again.
- At the end, in both modes, the **harness tools probe** runs on the local machine (D5 of the review of 19/10, D-127,
  `packages/core/test/fixtures/probe-harness-tools.ts`): it starts the real `claude` (and `codex`, if present) the way
  Monsters starts it and checks that every tool it sees is one it can execute; no request to the model, a few seconds;
  without `claude` (exit 3) it is skipped, not red. `--no-probe` skips it; by hand: `pnpm exec node
  packages/core/test/fixtures/probe-harness-tools.ts`.
- **Statuses on GitHub (`--local` only).** The `full (…)` jobs are already check runs of the commit; after a local CI,
  at the end (even if a system is red) `release:ci --local` publishes the result as a *commit status* on the commit,
  so that GitHub shows the check done locally: `local-ci/linux`, `local-ci/windows`, `local-ci/macos` (success,
  failure or pending, with a short description such as `ci:local full + package, 4m31s`) and
  `local-ci/release-gate` (success only if the three are green). It is done by `pnpm ci:status [--commit <rev>]
  [--dry-run]` (`scripts/ci-status.ts`, the mapping is pure and tested), with `gh api -X POST
  repos/<owner>/<repo>/statuses/<sha>`; owner and repo come from `git remote get-url origin` (default
  `Saturday-Company/monsters`). It only publishes if the commit is on origin (otherwise it explains that you should
  push first and run `pnpm ci:status` again). No `target_url` and no path, host or personal data in the descriptions.
  `--dry-run` prints the `gh` commands without running them; `pnpm release:ci --no-status` skips the publication.
  `pnpm ci:status` on its own publishes nothing if the commit already has the three `full (…)` jobs green on GitHub
  (`--force` publishes anyway).
- `pnpm release:check [--commit <rev>] [--source auto|github|local]` (`scripts/release-gate.ts`) prints the state of
  the gate for that commit and exits 0 if it's open, 1 if it's closed. A system counts if either source has it green
  (`auto`, the default; `MONSTERS_CI_GATE=github|local` or `--source` keeps one):
  - **GitHub:** the commit's `full (<system>)` check run (`gh api repos/<owner>/<repo>/commits/<sha>/check-runs`),
    concluded `success`, made by GitHub Actions in a run of `.github/workflows/ci.yml` started by a push or by hand
    in this same repo (read with `gh api repos/<owner>/<repo>/actions/runs/<id>`). A pull request's run never
    counts: a fork's PR runs the fork's workflow, which can call a job whatever it likes. If GitHub doesn't answer it
    says so and the local fallback remains.
  - **Local:** in `ci-results/`, a result for the commit's **full hash** with `mode: full`, `status: passed`, not made
    on a dirty checkout and with the `package` step passed (so neither `--quick` nor `--no-package`; on Windows the
    `package` step is written into the result by `ci-windows.sh`).

  If something is missing it says what, for both sources, and which command to run. A more recent red doesn't cancel
  a full green of the same commit.
- `pnpm desktop:publish` (the `desktop` feed and the GitHub Release) checks the gate on `HEAD` (both sources, like
  `release:check`) and **refuses** to publish if it's closed. `--skip-ci-gate` bypasses it with a very visible
  warning; `--dry-run` shows it but doesn't stop; test prefixes (`desktop/e2e-<run>`) aren't releases and don't pass
  through it.

## Cloud CI (optional)

A second opinion on clean machines that don't depend on yours. It runs **only on a schedule and by hand, never on a
push**, so as not to use up the credits of the free plans. The configurations are `.circleci/config.yml` and
`.gitlab-ci.yml`; every job runs `scripts/ci-cloud.sh`:

- `setup`: official Node 24 (downloaded from nodejs.org and checked with `SHASUMS256.txt` if the runner doesn't have
  it), pnpm at the `packageManager` version, on Linux the system libraries of Chromium for Playwright;
- `run`: `node scripts/ci-local.ts --no-package` (install, typecheck, lint, format, test, UI build, e2e on Linux
  only). The `package` step doesn't run in the cloud: it needs sudo, chroot, signing or a VM.

The result is in the same format as the local CI and stays among the job's artifacts. The Electron binary isn't
downloaded (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`) and the pnpm store is cached, tied to `pnpm-lock.yaml`.

- **CircleCI:** three workflows (`linux`, `windows`, `macos`), each turned on by its own parameter `run-linux` /
  `run-windows` / `run-macos`, false by default. Only schedules and manual or API launches turn them on; besides,
  every workflow switches itself off if the event is `push` or `pull_request`. It's best to also turn off the
  project's push trigger. Schedules are in UTC (with up to 10 minutes of random delay) and, for projects with the
  GitHub App, can only be created from the website (Project Setup).
- **GitLab.com:** `workflow:rules` creates a pipeline only for `schedule`, `web` and `api`; the `CLOUD_CI_PLATFORMS`
  variable (`linux`, `windows` or `linux windows`) chooses the jobs. If the GitLab project is a mirror, a push
  doesn't create pipelines. The variable requires that the minimum role allowed to use pipeline variables lets you set
  it.

**Results:** `pnpm ci:cloud-status` (`scripts/ci-cloud-status.ts`) reads the services' APIs with the tokens from `.env`
(ignored by git) and prints the last run of `main` per service and system: result, what started it, commit, time,
link. With `--json` it gives the raw data. It exits with 1 if a last run is red and with 2 if there are API or
configuration errors.

```sh
# .env
CIRCLECI_TOKEN=...
CIRCLECI_PROJECT_SLUG=circleci/<org>/<project>
CIRCLECI_DEFINITION_ID=...
GITLAB_TOKEN=glpat-...        # read_api scope (api to create schedules)
GITLAB_PROJECT=<group>/monsters
```

A manual run on CircleCI is launched from the API with the parameters of the workflow you want (without parameters
nothing starts):

```sh
curl -X POST "https://circleci.com/api/v2/project/$CIRCLECI_PROJECT_SLUG/pipeline/run" \
  -H "Circle-Token: $CIRCLECI_TOKEN" -H 'content-type: application/json' \
  -d '{"definition_id":"'"$CIRCLECI_DEFINITION_ID"'","config":{"branch":"main"},
       "checkout":{"branch":"main"},"parameters":{"run-windows":true}}'
```

On GitLab: Build > Pipelines > **Run pipeline** and choose `CLOUD_CI_PLATFORMS`.

**Known limits.** The `package` step doesn't run in the cloud (packages are tried by the local CI). Lint uses more
memory than Node's default: `ci-cloud.sh` passes `--max-old-space-size=4096`. The minutes and credits of the free
plans are few: keep schedules sparse (CircleCI macOS costs much more than Linux) and the retention of caches and
artifacts to a few days.
