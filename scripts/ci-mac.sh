#!/usr/bin/env bash
# macOS CI on a Mac (arm64) reached over SSH (e.g. on a VPN like Tailscale), as a dedicated
# standard user (`monsters-ci` in docs/ci.md): pushes the commit to a repo in that user's home and runs `scripts/ci-local.ts`
# of the commit there (the macOS steps of ci.yml, no e2e, plus the package step of M3.5: dmg
# built, mounted, app copied to a temporary Applications folder, started up to the registration,
# quit, removed), then copies its results back here.
#
#   pnpm ci:mac [--keep] [--quick] [--no-package] [--commit <rev>]
#                                            run the CI on the Mac (default commit: HEAD)
#   pnpm ci:mac --clean                      remove checkouts, caches and results on the Mac
#                                            (keeps Node)
#   pnpm ci:mac --uninstall                  remove ~/monsters-ci from the Mac
#   pnpm desktop:dist:mac [-- <package.ts options>]
#                                            (= ci-mac.sh --package) builds the macOS packages
#                                            of the commit on the Mac (dmg + zip, arm64 and x64,
#                                            M3.4) and copies them to apps/desktop/release/mac/
#
#   --keep           keep the run folder on the Mac afterwards (its path is printed)
#   --commit <rev>   commit to test; uncommitted changes are never tested
#   --quick          as ci:local: no package step (no e2e on macOS anyway)
#   --no-package     as ci:local: no package step
#   --package        build the app instead of the CI; the options after it go to
#                    apps/desktop/scripts/package.ts (e.g. --version 0.1.0 --feed <url>)
#
# Signing on the Mac (--package only, review 19/10 wave 5, item 2): `monsters-ci` holds no
# signing secret. The signed build is done by the user `monsters-sign`, through sudo, with a fixed
# script the Mac's owner installed as root outside the repo (scripts/mac-sign/sign-build.sh, copied
# to /usr/local/libexec/monsters/sign-build.sh; docs/signing.md): monsters-ci hands it the commit as a
# git bundle in /Users/Shared/monsters-sign/inbox/ and copies the packages back from
# /Users/Shared/monsters-sign/outbox/<run>/. monsters-sign checks out the commit by its sha in a
# repo of its own, runs its own `pnpm install --frozen-lockfile --ignore-scripts` (never this
# user's node_modules) and signs with its own keychain. Without the signer the packages are built
# here, signed ad-hoc (never publishable). A CI run is always ad-hoc. No secret travels over SSH.
#
# Environment (or scripts/ci.local.env, gitignored, see scripts/ci-env.sh and docs/ci.md):
#   MONSTERS_MAC_HOST     address of the Mac (required)
#   MONSTERS_MAC_USER     SSH user (required)
#   MONSTERS_MAC_KEY      SSH key (required)
#   MONSTERS_CI_RESULTS   results folder (default: `ci-results/` in the main checkout)
#
# Results: the files of ci:local, `<results>/<YYYYMMDD-HHMMSS>-<short commit>-macos.json`
# (`CiResult`, schema `monsters-ci/1`) and `.log`; `ref` and `dirty` describe this checkout.
#
# Exit code: as ci:local (0 passed, 1 a step failed, 2 usage or setup error, 130 interrupted),
# plus 75 when the Mac is not reachable, busy with another run or the connection was lost:
# retry later.
#
# On the Mac everything stays in ~/monsters-ci of `monsters-ci` (no sudo, nothing global):
#   node-v<version>-darwin-arm64/   official tarball from nodejs.org, checked against SHASUMS256
#   bin/                            pnpm shims of corepack (in the PATH of the runs only)
#   repo/                           git repo the commits are pushed to (refs/ci-mac/run)
#   cache.noindex/                  corepack (the pnpm of `packageManager`) and the pnpm store
#   work.noindex/<run>/             one run: runner.sh, home/, tmp/, the checkout of ci:local
#   results/<run>/                  JSON and log of the last runs (kept: 10)
#   run.lock                        one run at a time
# `.noindex` keeps Spotlight out and ~/monsters-ci is excluded from Time Machine. Runs use
# `nice`, `caffeinate -i` (no idle sleep while running) and a clean environment (HOME and TMPDIR
# inside the run folder). At the end, on Ctrl-C or when the SSH connection drops, every process
# of the run is killed and the run folder removed.
set -uo pipefail

NODE_VERSION=24.21.0
# node-v24.21.0-darwin-arm64.tar.gz, from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
NODE_SHA256=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057

USAGE='usage: pnpm ci:mac [--keep] [--commit <rev>] | --clean | --uninstall'
EX_RETRY=75

# shellcheck source=ci-env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci-env.sh"
monsters_load_ci_env "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for v in MONSTERS_MAC_HOST MONSTERS_MAC_USER MONSTERS_MAC_KEY; do
  if [[ -z ${!v:-} ]]; then
    echo "ci:mac: $v is not set (environment or scripts/ci.local.env, see docs/ci.md)" >&2
    exit 2
  fi
done
host=$MONSTERS_MAC_HOST
user=$MONSTERS_MAC_USER
key=$MONSTERS_MAC_KEY
key=${key/#\~/$HOME}

mode=run
keep=0
rev=HEAD
pkg_args=()
ci_args=""
while (($#)); do
  if [[ $mode == package ]]; then
    [[ $1 == -- ]] && { shift; continue; }
    [[ $1 =~ ^[A-Za-z0-9._:/=,@+-]+$ ]] || { echo "ci:mac: unsupported package option: $1" >&2; exit 2; }
    pkg_args+=("$1")
    shift
    continue
  fi
  case $1 in
    --package) mode=package ;;
    --keep) keep=1 ;;
    --quick) ci_args="$ci_args --quick" ;;
    --no-package) ci_args="$ci_args --no-package" ;;
    --commit)
      [[ -n ${2:-} ]] || { echo "ci:mac: --commit needs a revision" >&2; exit 2; }
      rev=$2
      shift
      ;;
    --clean) mode=clean ;;
    --uninstall) mode=uninstall ;;
    -h | --help) echo "$USAGE" >&2; exit 0 ;;
    --) ;;
    *) echo "ci:mac: unknown argument $1" >&2; echo "$USAGE" >&2; exit 2 ;;
  esac
  shift
done

# Hooks run with GIT_DIR and friends set: they must not leak into git.
while read -r var; do unset "$var"; done < <(compgen -e | grep '^GIT_')

ssh_opts=(-i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10
  -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o LogLevel=ERROR)
remote() { ssh "${ssh_opts[@]}" "$user@$host" "$@"; }

# --- the script that runs on the Mac (macOS /bin/bash is 3.2) --------------------------------

runner_script() {
  printf '#!/bin/bash\nNODE_VERSION=%s\nNODE_SHA256=%s\n' "$NODE_VERSION" "$NODE_SHA256"
  cat <<'RUNNER'
# Runner of `pnpm ci:mac` on the Mac, written by scripts/ci-mac.sh of the Monsters repo.
#   runner.sh init                       create ~/monsters-ci/repo if missing
#   runner.sh run <run> <commit> <keep>  prepare Node and pnpm, run ci-local.ts of <commit>
#   runner.sh abort <run> <keep>         stop a run (Ctrl-C on the PC)
#   runner.sh clean | uninstall
# Lines starting with "@@ci-mac " are read by ci-mac.sh.
set -u
R="${CI_MAC_ROOT:-$HOME/monsters-ci}"
NODE_DIR="$R/node-v$NODE_VERSION-darwin-arm64"
CACHE="$R/cache.noindex"
WORKROOT="$R/work.noindex"
RESULTS="$R/results"
REPO="$R/repo"
LOCK="$R/run.lock"
# The signed build (--package): its user, the fixed script installed by root, the shared folders
# (the overrides are for scripts/ci-mac.test.ts: a run's clean environment never has them).
SIGN_USER=monsters-sign
SIGNER="${CI_MAC_SIGNER:-/usr/local/libexec/monsters/sign-build.sh}"
SHARED="${CI_MAC_SHARED:-/Users/Shared/monsters-sign}"
CHILD=
WATCHDOG=
OWN_LOCK=

say() { printf '@@ci-mac %s\n' "$*"; }

# Processes of a run: anything of this user running from ~/monsters-ci (paths contain
# "/monsters-ci/"), plus node and esbuild processes (cores started by tests may run as a bare
# `node`). The user exists only for this CI and runs are serialized by the lock.
sweep() {
  local sig pids p hit
  for sig in TERM TERM KILL; do
    pids=$({ pgrep -u "$(id -u)" -f '[/]monsters-ci/'; pgrep -u "$(id -u)" -x node
      pgrep -u "$(id -u)" -x esbuild; } 2>/dev/null | sort -u)
    hit=
    for p in $pids; do
      [ "$p" = "$$" ] && continue
      kill -"$sig" "$p" 2>/dev/null && hit=1
    done
    [ -z "$hit" ] && return 0
    sleep 2
  done
}

lock_holder() { cat "$LOCK/pid" 2>/dev/null; }

acquire_lock() {
  local holder
  mkdir -p "$R"
  if ! mkdir "$LOCK" 2>/dev/null; then
    holder=$(lock_holder)
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then return 1; fi
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || return 1
  fi
  echo $$ >"$LOCK/pid"
  OWN_LOCK=1
}

# Disk images still attached under ~/monsters-ci (the package step's dmg, when the run was
# interrupted before it unmounted it): the mount point is the last tab-separated field.
detach_dmgs() {
  local mp
  hdiutil info 2>/dev/null | awk -F'\t' -v r="$R/" 'index($NF, r) == 1 { print $NF }' |
    while IFS= read -r mp; do
      [ -n "$mp" ] && hdiutil detach -force "$mp" >/dev/null 2>&1
    done
}

cleanup() {
  trap '' PIPE
  [ -n "$WATCHDOG" ] && kill "$WATCHDOG" 2>/dev/null
  WATCHDOG=
  if [ -n "$CHILD" ] && kill -0 "$CHILD" 2>/dev/null; then
    # ci-local stops its step, writes `interrupted` and removes its checkout.
    kill -TERM "$CHILD" 2>/dev/null
    local n=0
    while kill -0 "$CHILD" 2>/dev/null && [ $n -lt 20 ]; do sleep 1; n=$((n + 1)); done
  fi
  CHILD=
  cd "$R" 2>/dev/null
  sweep
  detach_dmgs
  if [ -n "${W:-}" ] && [ -d "$W" ]; then
    if [ "${KEEP:-0}" = 1 ]; then say "info kept $W"; else rm -rf "$W"; fi
  fi
  git -C "$REPO" worktree prune 2>/dev/null
  [ -n "$OWN_LOCK" ] && rm -rf "$LOCK"
  OWN_LOCK=
}

fatal() {
  say "fatal $*"
  cleanup
  exit 2
}

on_signal() {
  trap '' TERM INT HUP PIPE
  exec >/dev/null 2>&1
  cleanup
  exit 130
}

setup_node() {
  local name dl listed actual old
  [ "$("$NODE_DIR/bin/node" --version 2>/dev/null)" = "v$NODE_VERSION" ] && return 0
  name="node-v$NODE_VERSION-darwin-arm64"
  dl="$CACHE/download"
  say "info setup downloading $name.tar.gz from nodejs.org"
  rm -rf "$dl" && mkdir -p "$dl" || fatal "cannot create $dl"
  curl -fsSL --retry 3 -o "$dl/$name.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" ||
    fatal "download of $name.tar.gz failed"
  curl -fsSL --retry 3 -o "$dl/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" ||
    fatal "download of SHASUMS256.txt failed"
  listed=$(awk -v f="$name.tar.gz" '$2 == f { print $1 }' "$dl/SHASUMS256.txt")
  actual=$(shasum -a 256 "$dl/$name.tar.gz" | awk '{ print $1 }')
  [ "$listed" = "$NODE_SHA256" ] || fatal "SHASUMS256.txt lists '$listed', expected $NODE_SHA256"
  [ "$actual" = "$NODE_SHA256" ] || fatal "checksum of $name.tar.gz is $actual, expected $NODE_SHA256"
  tar -xzf "$dl/$name.tar.gz" -C "$dl" || fatal "cannot extract $name.tar.gz"
  rm -rf "$NODE_DIR" && mv "$dl/$name" "$NODE_DIR" || fatal "cannot install $NODE_DIR"
  rm -rf "$dl"
  for old in "$R"/node-v*-darwin-arm64; do
    [ -d "$old" ] && [ "$old" != "$NODE_DIR" ] && rm -rf "$old"
  done
  [ "$("$NODE_DIR/bin/node" --version 2>/dev/null)" = "v$NODE_VERSION" ] || fatal "Node does not start"
  say "info setup Node v$NODE_VERSION installed in $NODE_DIR"
}

do_run() {
  RUN=$1
  COMMIT=$2
  KEEP=$3
  W="$WORKROOT/$RUN"
  if [ "${CI_MAC_CLEAN_ENV:-}" != 1 ]; then
    # Nothing inherited from the SSH session (locale included): only what a CI runner has.
    exec /usr/bin/env -i CI_MAC_CLEAN_ENV=1 CI_MAC_ROOT="$R" \
      HOME="$W/home" USER="$(id -un)" LOGNAME="$(id -un)" SHELL=/bin/bash \
      PATH="$R/bin:$NODE_DIR/bin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$W/tmp/" \
      LANG=en_US.UTF-8 \
      COREPACK_HOME="$CACHE/corepack" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 \
      pnpm_config_store_dir="$CACHE/pnpm-store" \
      MONSTERS_CI_WORKDIR="$W" MONSTERS_CI_RESULTS="$RESULTS/$RUN" \
      CI_MAC_MODE="${CI_MAC_MODE:-ci}" CI_MAC_PKG_ARGS="${CI_MAC_PKG_ARGS:-}" \
      CI_MAC_CI_ARGS="${CI_MAC_CI_ARGS:-}" \
      /bin/bash "$0" run "$RUN" "$COMMIT" "$KEEP"
  fi
  unset CI_MAC_CLEAN_ENV CI_MAC_ROOT
  trap on_signal TERM INT HUP PIPE

  if ! acquire_lock; then
    rm -rf "$W"
    say "busy pid $(lock_holder)"
    exit 75
  fi
  # Leftovers of a run ended by a lost connection or a crash: processes, folders, old results.
  sweep
  for old in "$WORKROOT"/*; do
    [ -d "$old" ] && [ "$old" != "$W" ] && [ ! -e "$old/.keep" ] && rm -rf "$old"
  done
  ls -1t "$RESULTS" 2>/dev/null | tail -n +11 | while read -r old; do rm -rf "${RESULTS:?}/$old"; done
  # Library/Preferences lets `security list-keychains -s` stick in the run's HOME: without it the
  # temporary keychain of electron-builder stays out of the search list, the Developer ID G2
  # intermediate is not found and signing is skipped (CSSMERR_TP_NOT_TRUSTED).
  mkdir -p "$W/home/Library/Preferences" "$W/home/Library/Keychains" "$W/tmp" "$RESULTS/$RUN" \
    "$CACHE" "$R/bin" || fatal "cannot create $W"
  [ "$KEEP" = 1 ] && touch "$W/.keep"

  # Stop the run if the SSH session goes away (sshd exits, the runner is re-parented to launchd).
  (
    while kill -0 $$ 2>/dev/null && [ "$(ps -o ppid= -p $$ | tr -d ' ')" != 1 ]; do sleep 5; done
    kill -TERM $$ 2>/dev/null
  ) </dev/null >/dev/null 2>&1 &
  WATCHDOG=$!
  caffeinate -i -w $$ </dev/null >/dev/null 2>&1 &

  if [ "$(tmutil isexcluded "$R" 2>/dev/null | cut -c1-10)" != '[Excluded]' ]; then
    tmutil addexclusion "$R" >/dev/null 2>&1
  fi
  setup_node
  "$NODE_DIR/bin/corepack" enable --install-directory "$R/bin" pnpm || fatal "corepack enable failed"

  cd "$REPO" || fatal "missing $REPO"
  git worktree prune
  git checkout -q --detach --force "$COMMIT" || fatal "cannot check out $COMMIT"
  git clean -q -d -f -x
  [ -f scripts/ci-local.ts ] || fatal "commit $COMMIT has no scripts/ci-local.ts"
  local pnpm_version
  pnpm_version=$(pnpm --version 2>&1) || fatal "pnpm via corepack failed: $pnpm_version"
  pnpm_version=$(printf '%s\n' "$pnpm_version" | tail -n 1)
  say "info versions node $(node --version), pnpm $pnpm_version"

  # Electron and electron-builder downloads kept between runs (HOME is the run folder).
  export electron_config_cache="$CACHE/electron" ELECTRON_BUILDER_CACHE="$CACHE/electron-builder"

  # The signing secrets are not this user's (review 19/10 wave 5, item 2): a leftover secrets/
  # folder is said, never read.
  if [ -e "$R/secrets" ]; then
    say "info WARNING: $R/secrets still exists: move it to monsters-sign, delete it here (docs/signing.md)"
  fi
  if [ "${CI_MAC_MODE:-ci}" = package ]; then
    local pcode
    mkdir -p "$RESULTS/$RUN/artifacts" || fatal "cannot create $RESULTS/$RUN/artifacts"
    # @@signer: the signed build runs as monsters-sign (scripts/mac-sign/sign-build.sh, installed
    # by root; sudoers lets monsters-ci run that one script). It gets the sha, the run and, of the
    # package options, only --version and --feed.
    if [ -x "$SIGNER" ] && sudo -n -l -u "$SIGN_USER" "$SIGNER" >/dev/null 2>&1; then
      local sargs="" a next=""
      # shellcheck disable=SC2086
      for a in $CI_MAC_PKG_ARGS; do
        if [ -n "$next" ]; then
          sargs="$sargs $next $a"
          next=""
          continue
        fi
        case $a in
          --version | --feed) next=$a ;;
          *) fatal "the signed build takes only --version and --feed, not $a" ;;
        esac
      done
      [ -z "$next" ] || fatal "$next needs a value"
      [ -d "$SHARED/inbox" ] && [ -w "$SHARED/inbox" ] || fatal "$SHARED/inbox missing or not writable"
      rm -f "$SHARED/inbox/$RUN.bundle"
      git -C "$REPO" bundle create -q "$SHARED/inbox/$RUN.bundle" refs/ci-mac/run ||
        fatal "cannot write the bundle of $COMMIT"
      chmod 644 "$SHARED/inbox/$RUN.bundle"
      say "info signed build of $COMMIT as $SIGN_USER ($SIGNER)"
      (
        # shellcheck disable=SC2086
        sudo -n -u "$SIGN_USER" -H "$SIGNER" "$COMMIT" "$RUN" $sargs &&
          cp -R "$SHARED/outbox/$RUN/." "$RESULTS/$RUN/artifacts/"
      ) </dev/null >"$RESULTS/$RUN/package.log" 2>&1 &
    else
      say "info no signer ($SIGNER for $SIGN_USER): ad-hoc signature, built as $(id -un)"
      (
        pnpm install --frozen-lockfile &&
          # shellcheck disable=SC2086
          MONSTERS_MAC_IDENTITY=- nice -n 10 node apps/desktop/scripts/package.ts --mac \
            $CI_MAC_PKG_ARGS --out "$RESULTS/$RUN/artifacts"
      ) </dev/null >"$RESULTS/$RUN/package.log" 2>&1 &
    fi
    CHILD=$!
    wait "$CHILD"
    pcode=$?
    CHILD=
    rm -f "$SHARED/inbox/$RUN.bundle"
    tail -n 40 "$RESULTS/$RUN/package.log"
    ls "$RESULTS/$RUN/artifacts"/*.dmg >/dev/null 2>&1 || pcode=1
    say "results $RUN"
    cleanup
    exit "$pcode"
  fi

  say "info CI run: no signing secrets, the package step is ad-hoc signed"
  local args="--commit $COMMIT"
  [ "$KEEP" = 1 ] && args="$args --keep"
  args="$args ${CI_MAC_CI_ARGS:-}"
  # shellcheck disable=SC2086
  nice -n 10 node scripts/ci-local.ts $args </dev/null 2>&1 &
  CHILD=$!
  wait "$CHILD"
  local code=$?
  CHILD=
  say "results $RUN"
  cleanup
  exit "$code"
}

case ${1:-} in
  init)
    mkdir -p "$R"
    [ -d "$REPO/.git" ] || git init -q "$REPO"
    ;;
  run) do_run "$2" "$3" "$4" ;;
  abort)
    W="$WORKROOT/$2"
    holder=$(lock_holder)
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
      kill -TERM "$holder"
      n=0
      while kill -0 "$holder" 2>/dev/null && [ $n -lt 40 ]; do sleep 1; n=$((n + 1)); done
    fi
    sweep
    if [ -d "$W" ] && [ "$3" != 1 ]; then rm -rf "$W"; fi
    git -C "$REPO" worktree prune 2>/dev/null
    holder=$(lock_holder)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then rm -rf "$LOCK"; fi
    ;;
  clean | uninstall)
    acquire_lock || { say "busy pid $(lock_holder)"; exit 75; }
    sweep
    if [ "$1" = uninstall ]; then
      tmutil removeexclusion "$R" >/dev/null 2>&1
      rm -rf "$R"
      say "info removed $R"
    else
      rm -rf "$WORKROOT" "$CACHE" "$RESULTS" "$REPO" "$LOCK"
      say "info removed checkouts, caches and results (Node kept: $NODE_DIR)"
    fi
    ;;
  *) echo "usage: runner.sh init | run <run> <commit> <keep> | abort <run> <keep> | clean | uninstall" >&2; exit 2 ;;
esac
RUNNER
}

# --- helpers ---------------------------------------------------------------------------------

unreachable() {
  echo "ci:mac: the Mac is not reachable ($user@$host): $1" >&2
  echo "ci:mac: it is probably off, asleep or off Tailscale; retry later (exit $EX_RETRY)" >&2
  exit "$EX_RETRY"
}

# --- reachability ----------------------------------------------------------------------------

[[ -r $key ]] || { echo "ci:mac: SSH key $key not found (MONSTERS_MAC_KEY)" >&2; exit 2; }
probe=$(remote -n true 2>&1)
probe_code=$?
if ((probe_code != 0)); then
  ((probe_code == 255)) && unreachable "${probe:-ssh failed}"
  echo "ci:mac: ssh to $user@$host failed ($probe_code): $probe" >&2
  exit 2
fi

if [[ $mode != run && $mode != package ]]; then
  output=$(runner_script | remote "bash -s -- $mode" 2>&1)
  code=$?
  printf '%s\n' "$output" | sed -n 's/^@@ci-mac info //p'
  if ((code == 75)); then
    echo "ci:mac: a run is in progress on the Mac, retry later" >&2
    exit "$EX_RETRY"
  fi
  ((code == 255)) && unreachable "connection lost"
  exit "$code"
fi

# --- commit ----------------------------------------------------------------------------------

if ! commit=$(git rev-parse --verify -q "$rev^{commit}"); then
  echo "ci:mac: not a git checkout, or unknown commit $rev" >&2
  exit 2
fi
short=${commit:0:7}
ref=$(git symbolic-ref --short -q HEAD || true)
dirty=false
# Only when HEAD is tested: with --commit the checkout's state says nothing about that commit.
[[ $rev == HEAD && -n $(git status --porcelain) ]] && dirty=true
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
results_dir=${MONSTERS_CI_RESULTS:-$(dirname "$common_dir")/ci-results}
mkdir -p "$results_dir" || exit 2
run_id="$(date -u +%Y%m%d-%H%M%S)-$short-mac"
remote_work="monsters-ci/work.noindex/$run_id"

echo "ci:mac: $short on $user@$host"
[[ $dirty == true ]] && echo "note: uncommitted changes in this checkout are not tested"

# Push the commit (only the missing objects travel) and upload the runner of this run.
init_out=$(runner_script | remote 'bash -s -- init' 2>&1) || {
  [[ $? == 255 ]] && unreachable "connection lost"
  echo "ci:mac: cannot prepare ~/monsters-ci/repo on the Mac: $init_out" >&2
  exit 2
}
push_out=$(GIT_SSH_COMMAND="ssh ${ssh_opts[*]}" git push -q --no-verify --force \
  "$user@$host:monsters-ci/repo" "$commit:refs/ci-mac/run" 2>&1) || {
  echo "ci:mac: cannot push $short to the Mac: $push_out" >&2
  exit "$EX_RETRY"
}
upload_out=$(runner_script | remote "mkdir -p '$remote_work' && cat > '$remote_work/runner.sh'" 2>&1) || {
  echo "ci:mac: cannot upload the runner: $upload_out" >&2
  exit "$EX_RETRY"
}

# --- run -------------------------------------------------------------------------------------

ssh_pid=
busy=
fatal_msg=
got_results=

fetch_results() {
  # Copy the JSON and the log of ci:local; ref and dirty describe this checkout, not the repo
  # on the Mac (always detached and clean there).
  # IFS may still be empty here: a signal trap runs inside `IFS= read`.
  local files f IFS=$' \t\n'
  files=$(remote -n "cd monsters-ci/results/$run_id 2>/dev/null && ls" 2>/dev/null) || return 1
  [[ -n $files ]] || return 1
  remote -n "tar -cf - -C monsters-ci/results/$run_id ." | tar -xf - -C "$results_dir" || return 1
  for f in $files; do
    [[ $f == *.json ]] || continue
    node -e '
      const fs = require("node:fs");
      const [file, ref, dirty] = process.argv.slice(1);
      const result = JSON.parse(fs.readFileSync(file, "utf8"));
      result.ref = ref || null;
      result.dirty = dirty === "true";
      fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
    ' "$results_dir/$f" "$ref" "$dirty" 2>/dev/null
    echo "results: $results_dir/$f"
  done
  got_results=1
}

on_signal() {
  trap '' INT TERM HUP
  [[ -n $ssh_pid ]] && kill "$ssh_pid" 2>/dev/null
  echo "ci:mac: interrupted, stopping the run on the Mac" >&2
  runner_script | timeout 90 ssh "${ssh_opts[@]}" "$user@$host" "bash -s -- abort $run_id $keep" \
    >/dev/null 2>&1
  fetch_results
  exit 130
}
trap on_signal INT TERM HUP

remote_env="CI_MAC_CI_ARGS='$ci_args'"
if [[ $mode == package ]]; then
  remote_env="CI_MAC_MODE=package CI_MAC_PKG_ARGS='${pkg_args[*]:-}'"
  echo "ci:mac: building the macOS packages of $short (${pkg_args[*]:-default options})"
fi
exec 3< <(exec ssh -n "${ssh_opts[@]}" "$user@$host" \
  "$remote_env exec bash \"\$HOME/$remote_work/runner.sh\" run $run_id $commit $keep" 2>&1)
ssh_pid=$!

while IFS= read -r -u 3 line; do
  line=${line%$'\r'}
  # Lines of ci:local (progress, failed step output) are shown as they are.
  if [[ $line != '@@ci-mac '* ]]; then
    case $line in
      'results: '* | 'checkout kept: '*) ;;
      'full log: '*) echo "full log: $results_dir/${line##*/}" ;;
      *) printf '%s\n' "$line" ;;
    esac
    continue
  fi
  read -r kind rest <<<"${line#@@ci-mac }"
  case $kind in
    info) echo "  ${rest#setup }" ;;
    fatal) fatal_msg=$rest ;;
    busy) busy=1 ;;
  esac
done
exec 3<&-
wait "$ssh_pid"
code=$?
ssh_pid=

if [[ -n $busy ]]; then
  echo "ci:mac: another ci:mac run is in progress on the Mac; retry later" >&2
  exit "$EX_RETRY"
fi
case $code in
  0 | 1 | 2 | 130) ;;
  *)
    # ssh ended without the exit code of the runner: the connection dropped. On the Mac the
    # watchdog stops the run within seconds; its results (interrupted) are fetched if possible.
    echo "ci:mac: connection to the Mac lost ($code); retry later" >&2
    sleep 15
    fetch_results
    exit "$EX_RETRY"
    ;;
esac
fetch_results
if [[ $mode == package && -d $results_dir/artifacts ]]; then
  # The packages (hundreds of MB) leave the Mac and the results folder.
  out_dir="$(git rev-parse --show-toplevel)/apps/desktop/release/mac"
  mkdir -p "$out_dir"
  # The unpacked apps (mac/, mac-arm64/) of the previous build are folders: mv does not
  # replace a folder that is not empty, so the old ones go first.
  for item in "$results_dir"/artifacts/*; do
    rm -rf "${out_dir:?}/$(basename "$item")"
  done
  mv "$results_dir"/artifacts/* "$out_dir"/ && rmdir "$results_dir/artifacts"
  remote -n "rm -rf monsters-ci/results/$run_id/artifacts" || true
  echo "ci:mac: packages in $out_dir:"
  (cd "$out_dir" && ls -l ./*.dmg ./*.zip ./*.yml 2>/dev/null)
fi
if [[ -n $fatal_msg ]]; then
  echo "ci:mac: setup failed on the Mac: $fatal_msg" >&2
  exit 2
fi
[[ -n $got_results ]] || echo "ci:mac: no results came back from the Mac" >&2
exit "$code"
