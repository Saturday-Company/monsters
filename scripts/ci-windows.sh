#!/usr/bin/env bash
# Windows CI on a local QEMU/KVM virtual machine (GitHub Actions is blocked).
#
#   pnpm ci:windows [--keep] [--fresh] [--no-package] [--commit <rev>]
#                                                         run the CI of a commit in the VM
#   scripts/ci-windows.sh setup [--force]                 build the VM from scratch (once)
#   scripts/ci-windows.sh start|stop|status|ssh [cmd]|screenshot <file.png>
#
# Run: if the VM is off it is reverted to the clean snapshot `ci-base` and booted headless; if it
# is already on (left by --keep) a new clean folder is used instead (--fresh forces the revert).
# The commit (never uncommitted changes) is copied with `git bundle` over scp and fetched with the
# VM's own git (CRLF checkout, like actions/checkout on Windows); then `scripts/ci-local.ts` of
# that commit runs inside the VM (the Windows steps of ci.yml: no e2e, tests with
# --testTimeout=30000 --hookTimeout=30000). The VM is shut down at the end unless --keep.
#
# Package step (M3.5, `package` in the result): before the VM boots (never a heavy build and the
# 6 GB VM together) the test-signed NSIS installer of the commit is built HERE, in a clean
# worktree (`install-test.ts --win-build`, MONSTERS_WIN_SIGN=test, no Wine); after ci:local, in the
# same boot of the VM, test-windows.ps1 installs it silently for the user, starts it up to the
# registration done from its window (install-probe.mjs), uninstalls it and checks that the folder
# and the uninstall entry are gone. --no-package skips it. In the VM `pnpm install` runs with
# ELECTRON_SKIP_BINARY_DOWNLOAD=1: no step there runs Electron.
#
# Results: those of ci:local (schema `monsters-ci/1`, type `CiResult` in scripts/ci-local.ts),
# copied back to $MONSTERS_CI_RESULTS or `ci-results/` of the main checkout:
# `<YYYYMMDD-HHMMSS>-<short commit>-windows.json` + `.log`, with `ref`/`dirty` of the host checkout;
# the VM part (boot, copy, shutdown) logs to `<stamp>-<short commit>-windows-vm.log`. If the VM
# fails before ci:local writes anything, a result with `failedStep: "vm"` and no steps is written.
# Exit code: as ci:local (0 passed, 1 a step failed, 130 interrupted), 2 usage or VM error.
#
# The VM lives outside the repo, in $MONSTERS_WINVM_DIR (default ~/.local/share/monsters/winvm;
# environment or scripts/ci.local.env, see scripts/ci-env.sh and docs/ci.md): Windows ISO,
# installers, disk.qcow2 (snapshot ci-base), UEFI vars, password of the user `ci` (ci-password,
# mode 600). SSH: user ci, key ~/.ssh/monsters_winvm only, port forwarded on 127.0.0.1 only.
# Image: Windows Server 2025 Datacenter Evaluation from the Microsoft Evaluation Center (180 days).
set -euo pipefail

# shellcheck source=ci-env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci-env.sh"
monsters_load_ci_env "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="${MONSTERS_WINVM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/monsters/winvm}"
SSH_PORT="${MONSTERS_WINVM_SSH_PORT:-22522}"
VM_CPUS="${MONSTERS_WINVM_CPUS:-6}"
# 6 GiB: the host (31 GiB) also runs other test suites; an 8 GiB VM got OOM-killed during setup.
VM_MEM="${MONSTERS_WINVM_MEM:-6G}"
VM_DISK_SIZE=80G
SSH_KEY="$HOME/.ssh/monsters_winvm"
SNAPSHOT=ci-base
OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.fd
OVMF_VARS_TEMPLATE=/usr/share/OVMF/OVMF_VARS_4M.fd
DISK="$VM_DIR/disk.qcow2"
VARS="$VM_DIR/OVMF_VARS.fd"
VARS_BASE="$VM_DIR/OVMF_VARS.$SNAPSHOT.fd"
PIDFILE="$VM_DIR/qemu.pid"
QMP_SOCK="$VM_DIR/qmp.sock"
CONFIG_ISO="$VM_DIR/config.iso"
KNOWN_HOSTS="$VM_DIR/known_hosts"
# Datacenter Evaluation (Desktop Experience) in the Server 2025 ISO; `setup` checks the name.
IMAGE_INDEX=4

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ci:windows: $*" >&2; exit 2; }
say() { echo "ci:windows: $*"; }

# --- VM control ------------------------------------------------------------------------------

# The pid file survives a killed QEMU: also check that the pid is still a QEMU.
vm_running() {
  [[ -f "$PIDFILE" ]] && [[ "$(cat "/proc/$(cat "$PIDFILE")/comm" 2>/dev/null)" == qemu-system-* ]]
}

# One QMP command (JSON), printed response lines.
qmp() {
  printf '{"execute":"qmp_capabilities"}\n%s\n' "$1" | socat -t 3 - "UNIX-CONNECT:$QMP_SOCK" 2>/dev/null || true
}

ssh_opts=(-i "$SSH_KEY" -p "$SSH_PORT" -o IdentitiesOnly=yes -o BatchMode=yes
  -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=5 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o LogLevel=ERROR)

vm_ssh() { ssh "${ssh_opts[@]}" ci@127.0.0.1 "$@"; }

# $1: extra mode (install | run). Starts QEMU daemonized, headless.
vm_start() {
  local mode="${1:-run}"
  vm_running && return 0
  [[ -f "$DISK" ]] || die "no VM disk in $VM_DIR: run scripts/ci-windows.sh setup"
  # Refuse to start rather than push the host into the OOM killer.
  local avail_mib need_mib
  avail_mib=$(($(sed -n 's/^MemAvailable: *\([0-9]*\) kB/\1/p' /proc/meminfo) / 1024))
  need_mib=$(($(numfmt --from=iec "$VM_MEM") / 1048576 + 1024))
  ((avail_mib >= need_mib)) ||
    die "only ${avail_mib} MiB of memory available, the VM needs ${need_mib} (MONSTERS_WINVM_MEM=$VM_MEM)"
  rm -f "$QMP_SOCK"
  local args=(
    -name monsters-ci-windows
    -machine q35,accel=kvm
    -cpu host,hv_relaxed,hv_vapic,hv_spinlocks=0x1fff,hv_time,hv_vpindex,hv_synic,hv_stimer,hv_frequencies,hv_tlbflush,hv_ipi,hv_runtime
    -smp "$VM_CPUS,sockets=1,cores=$VM_CPUS,threads=1"
    -m "$VM_MEM"
    -drive "if=pflash,format=raw,readonly=on,file=$OVMF_CODE"
    -drive "if=pflash,format=raw,file=$VARS"
    -device ahci,id=ahci
    # cache=unsafe: the disk is reverted to the snapshot anyway; only a host crash loses data.
    -drive "file=$DISK,if=none,id=disk0,format=qcow2,cache=unsafe,discard=unmap"
    -device ide-hd,drive=disk0,bus=ahci.0,bootindex=1
    # User-mode NAT; the only port reachable from the host is SSH, and only on 127.0.0.1.
    -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22"
    -device e1000e,netdev=net0
    -device qemu-xhci -device usb-tablet
    -vga std -display none -monitor none
    -rtc base=utc
    -qmp "unix:$QMP_SOCK,server=on,wait=off"
    -pidfile "$PIDFILE" -daemonize
  )
  if [[ "$mode" == install ]]; then
    local iso
    iso="$(windows_iso)"
    args+=(
      -drive "file=$iso,if=none,id=cd0,media=cdrom,readonly=on"
      -device ide-cd,drive=cd0,bus=ahci.1,bootindex=0
      -drive "file=$CONFIG_ISO,if=none,id=cd1,media=cdrom,readonly=on"
      -device ide-cd,drive=cd1,bus=ahci.2
    )
  fi
  # QEMU in its own systemd scope: if the kernel OOM-kills it, systemd stops only that scope and
  # not the terminal (or agent session) that started it. `9>&-`: the daemon must not inherit the
  # run lock, or a VM left on by --keep would block the next run.
  if command -v systemd-run >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
    systemd-run --user --scope --quiet --collect --unit="monsters-winvm-$(date +%s)" \
      qemu-system-x86_64 "${args[@]}" 9>&-
  else
    qemu-system-x86_64 "${args[@]}" 9>&-
  fi
}

# Waits until QEMU exits (guest powered off); $1 timeout in seconds.
vm_wait_off() {
  local deadline=$((SECONDS + $1))
  while vm_running; do
    ((SECONDS < deadline)) || return 1
    sleep 2
  done
  rm -f "$PIDFILE" "$QMP_SOCK"
}

vm_wait_ssh() {
  local deadline=$((SECONDS + ${1:-300}))
  until vm_ssh 'exit 0' >/dev/null 2>&1; do
    vm_running || return 1
    ((SECONDS < deadline)) || return 1
    sleep 3
  done
}

# Clean shutdown: Windows shutdown over SSH, then ACPI, then kill.
vm_stop() {
  vm_running || { rm -f "$PIDFILE" "$QMP_SOCK"; return 0; }
  vm_ssh 'shutdown /s /t 0 /f' >/dev/null 2>&1 || qmp '{"execute":"system_powerdown"}' >/dev/null
  vm_wait_off 180 && return 0
  qmp '{"execute":"system_powerdown"}' >/dev/null
  vm_wait_off 60 && return 0
  qmp '{"execute":"quit"}' >/dev/null
  vm_wait_off 15 || { kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 2; rm -f "$PIDFILE" "$QMP_SOCK"; }
}

vm_revert() {
  qemu-img snapshot -l "$DISK" | grep -qw "$SNAPSHOT" || die "snapshot $SNAPSHOT missing: run setup"
  qemu-img snapshot -a "$SNAPSHOT" "$DISK"
  cp "$VARS_BASE" "$VARS"
}

screenshot() {
  local out="$1"
  qmp "{\"execute\":\"screendump\",\"arguments\":{\"filename\":\"$out\",\"format\":\"png\"}}" >/dev/null
  [[ -f "$out" ]] && echo "$out"
}

windows_iso() {
  local iso
  iso="$(ls "$VM_DIR"/WinServer2025_Eval_*.iso 2>/dev/null | head -1)"
  [[ -n "$iso" ]] || die "no Windows Server 2025 evaluation ISO in $VM_DIR"
  echo "$iso"
}

# --- setup -----------------------------------------------------------------------------------

cmd_setup() {
  local force=0
  [[ "${1:-}" == --force ]] && force=1
  if [[ -f "$DISK" && $force -eq 0 ]]; then
    die "$DISK already exists (setup --force rebuilds the VM from scratch)"
  fi
  vm_running && die "the VM is running: scripts/ci-windows.sh stop"
  command -v xorriso >/dev/null || die "xorriso missing (sudo apt install xorriso)"
  command -v socat >/dev/null || die "socat missing"
  [[ -f "$SSH_KEY.pub" ]] || ssh-keygen -t ed25519 -N '' -C monsters-ci-windows-vm -f "$SSH_KEY" -q
  local password_file="$VM_DIR/ci-password"
  if [[ ! -f "$password_file" ]]; then
    (umask 077; echo "Ci-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)9a" >"$password_file")
  fi
  # The Visual C++ runtime is preinstalled on GitHub's Windows runners but not on a clean Windows:
  # native modules (e.g. @node-rs/argon2) fail to load without it.
  local iso git_setup node_msi vc_redist="$VM_DIR/installers/vc_redist.x64.exe"
  iso="$(windows_iso)"
  git_setup="$(ls "$VM_DIR"/installers/Git-*-64-bit.exe 2>/dev/null | head -1)"
  node_msi="$(ls "$VM_DIR"/installers/node-v24.*-x64.msi 2>/dev/null | head -1)"
  [[ -n "$git_setup" && -n "$node_msi" && -f "$vc_redist" ]] ||
    die "put Git-*-64-bit.exe (git-for-windows), node-v24.*-x64.msi (nodejs.org) and vc_redist.x64.exe (https://aka.ms/vs/17/release/vc_redist.x64.exe) in $VM_DIR/installers"
  if command -v wiminfo >/dev/null; then
    local mnt name
    mnt="$(mktemp -d)"
    sudo mount -o loop,ro "$iso" "$mnt"
    name="$(wiminfo "$mnt/sources/install.wim" "$IMAGE_INDEX" | sed -n 's/^Display Name: *//p')"
    sudo umount "$mnt"; rmdir "$mnt"
    say "image $IMAGE_INDEX: $name"
    [[ "$name" == *Datacenter*Desktop* ]] || die "image $IMAGE_INDEX is not Datacenter Desktop Experience"
  fi

  # Config ISO: autounattend.xml (with the password), first-logon script, key, installers.
  local repo pnpm_version staging
  repo="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
  pnpm_version="$(jq -r '.packageManager' "$repo/package.json" | sed 's/^pnpm@//')"
  staging="$(mktemp -d)"
  chmod 700 "$staging"
  sed -e "s|@PASSWORD@|$(cat "$password_file")|g" -e "s|@IMAGE_INDEX@|$IMAGE_INDEX|g" \
    "$SCRIPT_DIR/ci-windows.autounattend.xml" >"$staging/autounattend.xml"
  cp "$SCRIPT_DIR/ci-windows.setup.ps1" "$staging/ci-setup.ps1"
  cp "$SSH_KEY.pub" "$staging/authorized_keys"
  cp "$git_setup" "$node_msi" "$vc_redist" "$staging/"
  printf '{"pnpm":"%s"}\n' "$pnpm_version" >"$staging/ci-versions.json"
  (umask 077; xorriso -as mkisofs -quiet -J -r -V CI_CONFIG -o "$CONFIG_ISO" "$staging")
  rm -rf "$staging"
  chmod 600 "$CONFIG_ISO"

  rm -f "$DISK" "$VARS" "$VARS_BASE" "$KNOWN_HOSTS"
  qemu-img create -q -f qcow2 "$DISK" "$VM_DISK_SIZE"
  cp "$OVMF_VARS_TEMPLATE" "$VARS"

  say "installing Windows (unattended, ~20-40 min); screenshots: $0 screenshot <file.png>"
  local t0=$SECONDS
  vm_start install
  # The ISO asks "Press any key to boot from CD or DVD" for a few seconds: press Enter.
  for _ in $(seq 1 20); do
    qmp '{"execute":"send-key","arguments":{"keys":[{"type":"qcode","data":"ret"}]}}' >/dev/null
    sleep 1
  done
  vm_wait_off 7200 || die "install not finished after 2 hours (VM left running)"
  say "install and provisioning done in $(((SECONDS - t0) / 60)) min"

  # Second boot without the ISOs: check, warm the pnpm store with this commit, snapshot.
  vm_start run
  vm_wait_ssh 600 || die "SSH not reachable after install"
  vm_ssh 'type C:\ci-setup.done' || die "provisioning did not finish (see C:\ci-setup.log in the VM)"
  scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" ci@127.0.0.1:/C:/ci-setup.log "$VM_DIR/ci-setup.log" || true
  vm_ssh 'node --version && git --version && pnpm --version && dir /b C:\Windows\System32\vcruntime140.dll && cscript //nologo C:\Windows\System32\slmgr.vbs /xpr'
  local sha
  sha="$(git -C "$repo" rev-parse HEAD)"
  copy_commit "$repo" "$sha" warm
  vm_ssh 'cd /d C:\ci\warm && pnpm install --frozen-lockfile' >"$VM_DIR/warmup.log" 2>&1 ||
    say "warm-up install failed (see $VM_DIR/warmup.log), the snapshot is taken anyway"
  vm_ssh 'cd /d C:\ && rmdir /s /q C:\ci' || true
  vm_stop
  qemu-img snapshot -c "$SNAPSHOT" "$DISK"
  cp "$VARS" "$VARS_BASE"
  say "VM ready, snapshot $SNAPSHOT taken ($(((SECONDS - t0) / 60)) min in total)"
}

# --- run -------------------------------------------------------------------------------------

# Copies commit $2 of repo $1 into C:\ci\$3 in the VM (git bundle, then init + fetch + checkout
# with the VM's git, like actions/checkout).
copy_commit() {
  local repo="$1" sha="$2" dir="$3" tmp
  tmp="$(mktemp -d)"
  git -C "$repo" update-ref "refs/ci-windows/$dir" "$sha"
  git -C "$repo" bundle create -q "$tmp/repo.bundle" "refs/ci-windows/$dir"
  git -C "$repo" update-ref -d "refs/ci-windows/$dir"
  vm_ssh 'if not exist C:\ci mkdir C:\ci' >/dev/null
  scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" "$tmp/repo.bundle" "ci@127.0.0.1:/C:/ci/$dir.bundle"
  rm -rf "$tmp"
  vm_ssh "cd /d C:\\ci && git init -q $dir && cd $dir && git fetch -q ..\\$dir.bundle refs/ci-windows/$dir && git -c advice.detachedHead=false checkout -q --detach $sha && del ..\\$dir.bundle"
}

fmt_duration() {
  local ms=$1
  if ((ms < 60000)); then
    printf '%d.%ds' $((ms / 1000)) $((ms % 1000 / 100))
  else
    local s=$(((ms + 500) / 1000))
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  fi
}

now_ms() { date +%s%3N; }

cmd_run() {
  local keep=0 fresh=0 rev=HEAD package=1
  while (($#)); do
    case "$1" in
      --keep) keep=1 ;;
      --fresh) fresh=1 ;;
      --no-package) package=0 ;;
      --commit) rev="${2:?--commit needs a revision}"; shift ;;
      --) ;;
      -h | --help) sed -n '2,9p' "$0"; exit 0 ;;
      *) die "unknown argument $1" ;;
    esac
    shift
  done
  command -v jq >/dev/null || die "jq missing"
  command -v socat >/dev/null || die "socat missing"
  [[ -f "$SSH_KEY" ]] || die "SSH key $SSH_KEY missing: run setup"

  local repo common sha short ref dirty
  repo="$(git rev-parse --show-toplevel)" || die "not a git checkout"
  common="$(git rev-parse --path-format=absolute --git-common-dir)"
  sha="$(git rev-parse --verify "$rev^{commit}")" || die "unknown commit $rev"
  short="${sha:0:7}"
  ref="$(git symbolic-ref --short -q HEAD || true)"
  dirty=false
  [[ "$rev" == HEAD && -n "$(git status --porcelain)" ]] && dirty=true

  # One run at a time on this VM.
  exec 9>"$VM_DIR/ci.lock"
  flock -n 9 || die "another ci:windows run is using the VM"

  RESULTS="${MONSTERS_CI_RESULTS:-$(dirname "$common")/ci-results}"
  mkdir -p "$RESULTS"
  STARTED_MS="$(now_ms)"
  STARTED_ISO="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  local run_dir
  run_dir="$(date -u +%Y%m%d-%H%M%S)-$short"
  # Host-side log of the VM part (boot, copy, retrieval); the steps log comes from ci:local.
  VM_LOG="$RESULTS/$run_dir-windows-vm.log"
  : >"$VM_LOG"

  echo "ci:windows $short \"$(git log -1 --format=%s "$sha")\""
  [[ "$dirty" == true ]] && echo "note: uncommitted changes in this checkout are not tested"

  # Without a result from ci:local (VM or SSH failure, interruption) a minimal one is written
  # here, same schema, so nothing reads an outcome that does not exist.
  fallback_result() {
    local status="$1" file
    file="$RESULTS/$run_dir-windows.json"
    jq -n --arg host "$(hostname)" --arg commit "$sha" --arg short "$short" \
      --arg subject "$(git log -1 --format=%s "$sha")" --arg ref "$ref" --argjson dirty "$dirty" \
      --arg status "$status" --arg started "$STARTED_ISO" \
      --arg finished "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" --argjson duration $(($(now_ms) - STARTED_MS)) \
      --arg log "$(basename "$VM_LOG")" \
      '{schema: "monsters-ci/1", platform: "windows", host: $host, commit: $commit, shortCommit: $short,
        subject: $subject, ref: (if $ref == "" then null else $ref end), dirty: $dirty, mode: "full",
        status: $status, failedStep: "vm", startedAt: $started, finishedAt: $finished,
        durationMs: $duration, node: "unknown", pnpm: "unknown", os: "windows", log: $log, steps: []}' >"$file"
    echo "$file"
  }
  finish() {
    local code="$1" result="${2:-}"
    trap - INT TERM HUP
    # The installer's build folder and its worktree (left there by an interruption).
    if [[ -n ${PKG_WORK:-} && -d $PKG_WORK ]]; then
      git -C "$repo" worktree remove --force "$PKG_WORK/checkout" >/dev/null 2>&1 || true
      rm -rf "$PKG_WORK"
      git -C "$repo" worktree prune >/dev/null 2>&1 || true
    fi
    if ((keep)); then
      echo "VM kept running: scripts/ci-windows.sh ssh (sources in C:\\ci\\$run_dir)"
    else
      vm_stop >>"$VM_LOG" 2>&1 || true
    fi
    if [[ -z "$result" ]]; then
      result="$(fallback_result "$( ((code == 130)) && echo interrupted || echo failed)")"
    fi
    echo "ci:windows: $(jq -r .status "$result") in $(fmt_duration $(($(now_ms) - STARTED_MS))) (VM included)"
    echo "results: $result"
    exit "$code"
  }
  trap 'finish 130' INT TERM HUP

  # Package step, part 1: the installer, built here before the VM starts.
  PKG_STATUS=skipped PKG_NOTE="--no-package" PKG_CODE=null PKG_BUILD_MS=0 PKG_TEST_MS=0 PKG_DIR=
  PKG_WORK=
  PKG_LOG="$RESULTS/$run_dir-windows-package.log"
  if ((package)); then
    win_package_build "$repo" "$sha" "$run_dir"
  fi

  # VM: revert + boot if off (or --fresh), otherwise a new folder in the running VM.
  local t0
  t0="$(now_ms)"
  echo "# memory before the VM: $(free -h | sed -n 2p)" >>"$VM_LOG"
  if vm_running && ((fresh)); then
    echo "# stopping the running VM (--fresh)" >>"$VM_LOG"
    vm_stop >>"$VM_LOG" 2>&1
  fi
  if ! vm_running; then
    echo "# reverting to $SNAPSHOT and booting" >>"$VM_LOG"
    { vm_revert && vm_start run; } >>"$VM_LOG" 2>&1 || { echo "VM start failed: $VM_LOG"; finish 2; }
  else
    echo "# VM already running: new folder C:\\ci\\$run_dir" >>"$VM_LOG"
  fi
  vm_wait_ssh 600 || { echo "VM not reachable over SSH: $VM_LOG"; finish 2; }
  echo "  vm    boot + ssh           $(fmt_duration $(($(now_ms) - t0)))"
  t0="$(now_ms)"
  copy_commit "$repo" "$sha" "$run_dir" >>"$VM_LOG" 2>&1 || { echo "copy of the commit failed: $VM_LOG"; finish 2; }
  # ci:local of the commit itself (its steps follow its own ci.yml); older commits without it
  # get the one of this checkout.
  local runner="scripts\\ci-local.ts"
  if ! git cat-file -e "$sha:scripts/ci-local.ts" 2>/dev/null; then
    scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
      -o UserKnownHostsFile="$KNOWN_HOSTS" "$repo/scripts/ci-local.ts" "ci@127.0.0.1:/C:/ci/ci-local.ts"
    runner='C:\ci\ci-local.ts'
  fi
  echo "  ok    copy of the commit   $(fmt_duration $(($(now_ms) - t0)))"

  # ci:local inside the VM: clean worktree of the commit in C:\ci\w (short paths), results in
  # C:\ci\results, then copied back next to the Linux ones. NODE_OPTIONS: with 6 GB Node's default
  # heap limit is ~2 GB and the type-checked lint of the whole repo needs more (3.2 GB RSS on
  # Linux, out of memory in the VM on 15/10); GitHub's Windows runners have 16 GB.
  set +e
  # Results in a folder of this run: with a VM kept running (--keep), an older result of the
  # same commit must never be read as this run's.
  vm_ssh "cd /d C:\\ci\\$run_dir && set \"MONSTERS_CI_RESULTS=C:\\ci\\results\\$run_dir\" && set \"MONSTERS_CI_WORKDIR=C:\\ci\\w\" && set \"ELECTRON_SKIP_BINARY_DOWNLOAD=1\" && set \"NODE_OPTIONS=--max-old-space-size=4096\" && node $runner --commit $sha" </dev/null
  local code=$?
  set -e
  ((code == 255)) && { echo "SSH to the VM failed during the run"; code=2; }

  # Package step, part 2: the installer in this same boot of the VM.
  if [[ $PKG_STATUS == built ]]; then
    if ((code == 2)); then
      PKG_STATUS=not-run PKG_NOTE="VM unreachable after ci:local"
    else
      win_package_test
    fi
  fi
  [[ -n $PKG_DIR ]] && rm -rf "$(dirname "$PKG_DIR")"

  local vm_json result=""
  vm_json="$(vm_ssh "dir /b /o-d C:\\ci\\results\\$run_dir\\*-$short-windows.json" 2>/dev/null | tr -d '\r' | head -1)"
  if [[ -n "$vm_json" ]]; then
    local name="${vm_json%.json}"
    scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
      -o UserKnownHostsFile="$KNOWN_HOSTS" "ci@127.0.0.1:/C:/ci/results/$run_dir/$name.json" \
      "ci@127.0.0.1:/C:/ci/results/$run_dir/$name.log" "$RESULTS/" >>"$VM_LOG" 2>&1 || true
    if [[ -f "$RESULTS/$name.json" ]]; then
      result="$RESULTS/$name.json"
      # The checkout in the VM is detached and clean: report the host's branch and state.
      jq --arg ref "$ref" --argjson dirty "$dirty" --arg host "$(hostname)" \
        '.ref = (if $ref == "" then null else $ref end) | .dirty = $dirty | .host = "\(.host) (VM on \($host))"' \
        "$result" >"$result.tmp" && mv "$result.tmp" "$result"
    fi
  fi
  if [[ -n $result ]]; then
    win_package_record "$result"
    [[ $PKG_STATUS == failed && $code == 0 ]] && code=1
  fi
  finish "$code" "$result"
}

# --- package step (M3.5) ---------------------------------------------------------------------

# Builds the test-signed installer of commit $2 in a clean worktree of this host and puts what the
# VM needs (installer, test CA, test-windows.ps1, install-probe.mjs, version) in $PKG_DIR.
# Sets PKG_STATUS: built | failed | skipped.
win_package_build() {
  local repo="$1" sha="$2" run_dir="$3" work t0
  if ! git -C "$repo" cat-file -e "$sha:apps/desktop/scripts/install-test.ts" 2>/dev/null; then
    PKG_NOTE="this commit has no apps/desktop/scripts/install-test.ts"
    return 0
  fi
  work="${XDG_CACHE_HOME:-$HOME/.cache}/monsters-ci/$run_dir-winpkg"
  PKG_WORK="$work"
  PKG_DIR="$work/for-vm"
  t0="$(now_ms)"
  echo "# ---- package, build on $(hostname): install-test.ts --win-build" >"$PKG_LOG"
  # Every command stops the subshell on its own: `set -e` has no effect in a subshell that is
  # the condition of an `if`, and a failed `worktree add` or `cd` would build the main checkout.
  if (
    # Nothing of the calling pnpm or of a git hook leaks into the build.
    while read -r var; do unset "$var"; done < <(compgen -e | grep -E '^(GIT_|npm_|MONSTERS_)')
    git -C "$repo" worktree add -q --detach "$work/checkout" "$sha" || exit 1
    cd "$work/checkout" || exit 1
    [[ "$(git rev-parse HEAD)" == "$sha" ]] || { echo "the checkout is not $sha"; exit 1; }
    pnpm install --frozen-lockfile || exit 1
    node apps/desktop/scripts/install-test.ts --win-build "$PKG_DIR" || exit 1
  ) >>"$PKG_LOG" 2>&1 </dev/null; then
    PKG_STATUS=built
  else
    PKG_STATUS=failed PKG_CODE=1 PKG_NOTE="the installer did not build on Linux, see the log"
  fi
  git -C "$repo" worktree remove --force "$work/checkout" >/dev/null 2>&1 || rm -rf "$work/checkout"
  git -C "$repo" worktree prune >/dev/null 2>&1 || true
  PKG_BUILD_MS=$(($(now_ms) - t0))
  if [[ $PKG_STATUS == built ]]; then
    echo "  ok    package build        $(fmt_duration "$PKG_BUILD_MS") (Linux, before the VM)"
  else
    echo "  FAIL  package build        $(fmt_duration "$PKG_BUILD_MS") (Linux)"
    tail -n 30 "$PKG_LOG"
    rm -rf "$work"
    PKG_DIR=
  fi
}

# Installs, starts up to the registration and uninstalls the installer in the running VM.
win_package_test() {
  local t0 dir='C:\Users\ci\monsters-test' installer version pcode
  installer="$(tr -d '\n' <"$PKG_DIR/installer")"
  version="$(tr -d '\n' <"$PKG_DIR/version")"
  t0="$(now_ms)"
  echo "# ---- package, in the VM: test-windows.ps1 $installer, version $version" >>"$PKG_LOG"
  set +e
  {
    vm_ssh "powershell -NoProfile -Command \"New-Item -Force -ItemType Directory $dir | Out-Null\"" &&
      scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
        -o UserKnownHostsFile="$KNOWN_HOSTS" "$PKG_DIR"/* ci@127.0.0.1:monsters-test/ &&
      vm_ssh "powershell -NoProfile -ExecutionPolicy Bypass -File $dir\\test-windows.ps1 -Installer $dir\\$installer -TestCert $dir\\test-ca.crt -Version $version -Probe $dir\\install-probe.mjs"
  } </dev/null >>"$PKG_LOG" 2>&1
  pcode=$?
  set -e
  PKG_TEST_MS=$(($(now_ms) - t0))
  PKG_CODE=$pcode
  if ((pcode == 0)); then
    PKG_STATUS=passed
    PKG_NOTE="NSIS $version firmato di prova: costruito su Linux in $(fmt_duration "$PKG_BUILD_MS"); nella VM installato per utente, registrazione dalla finestra, disinstallato senza resti in $(fmt_duration "$PKG_TEST_MS")"
    echo "  ok    package in the VM    $(fmt_duration "$PKG_TEST_MS")"
  else
    PKG_STATUS=failed
    PKG_NOTE="failed in the VM (exit $pcode): install, registration or uninstall, see the log"
    echo "  FAIL  package in the VM    $(fmt_duration "$PKG_TEST_MS")"
    tail -n 40 "$PKG_LOG"
  fi
}

# Writes the package step into the Windows result (ci:local in the VM left it `skipped`) and
# appends its log to the result's log.
win_package_record() {
  local result="$1" status="$PKG_STATUS" ms log
  [[ $status == built ]] && status=not-run
  ms=$((PKG_BUILD_MS + PKG_TEST_MS))
  jq --arg status "$status" --arg note "$PKG_NOTE" --argjson code "$PKG_CODE" --argjson ms "$ms" '
    .steps |= (map(select(.id != "package")) + [{
      id: "package",
      command: "pnpm desktop:install-test --win-build (Linux) + test-windows.ps1 (VM)",
      status: $status,
      durationMs: (if $status == "passed" or $status == "failed" then $ms else null end),
      exitCode: $code,
      note: $note
    }])
    | if $status == "failed" and .status == "passed" then .status = "failed" | .failedStep = "package" else . end
    | if .durationMs != null then .durationMs += $ms else . end
  ' "$result" >"$result.tmp" && mv "$result.tmp" "$result"
  log="${result%.json}.log"
  if [[ -f $PKG_LOG ]]; then
    { echo; cat "$PKG_LOG"; echo "# ---- package: $status in $(fmt_duration "$ms")"; } >>"$log"
    rm -f "$PKG_LOG"
  fi
}

# --- main ------------------------------------------------------------------------------------

[[ -d "$VM_DIR" ]] || die "$VM_DIR missing (sudo mkdir -p $VM_DIR && sudo chown \$USER $VM_DIR)"
case "${1:-run}" in
  setup) shift; cmd_setup "$@" ;;
  start) vm_start run; vm_wait_ssh 600 && say "VM up: $0 ssh" ;;
  stop) vm_stop ;;
  status)
    if vm_running; then say "running (pid $(cat "$PIDFILE")), ssh on 127.0.0.1:$SSH_PORT"; else say "off"; fi
    qemu-img snapshot -l "$DISK" 2>/dev/null || true
    ;;
  ssh) shift; vm_ssh "$@" ;;
  screenshot) screenshot "$(realpath -m "${2:?file.png}")" ;;
  run) shift $(($# > 0)); cmd_run "$@" ;;
  -*) cmd_run "$@" ;;
  *) die "unknown command $1 (setup|run|start|stop|status|ssh|screenshot)" ;;
esac
