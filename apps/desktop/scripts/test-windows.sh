#!/usr/bin/env bash
# Tries the Windows installer in the local Windows VM of `pnpm ci:windows` (D-039): Authenticode
# signature, per-user silent install, first start up to the registration done from the window
# (install-probe.mjs), uninstall with nothing left (test-windows.ps1). The VM starts from its clean
# snapshot and is shut down at the end. The CI does the same in its own boot of the VM
# (`pnpm ci:windows`, package step).
#
#   bash apps/desktop/scripts/test-windows.sh apps/desktop/release/Monsters-Setup-<v>-x64-<…>.exe [--keep]
#
# A test-signed installer is checked against the test certificate of apps/desktop/.signing/,
# trusted inside the VM only. The VM needs ~7 GiB of free memory (ci-windows.sh refuses less).
set -euo pipefail

installer=$(realpath "${1:?usage: test-windows.sh <installer.exe> [--keep]}")
keep=0
[[ ${2:-} == --keep ]] && keep=1
app_dir=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$app_dir/../.." && pwd)
ci="$repo/scripts/ci-windows.sh"
# shellcheck source=../../../scripts/ci-env.sh
. "$repo/scripts/ci-env.sh"
monsters_load_ci_env "$repo/scripts"
VM_DIR="${MONSTERS_WINVM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/monsters/winvm}"
ssh_opts=(-i "$HOME/.ssh/monsters_winvm" -o IdentitiesOnly=yes -o BatchMode=yes
  -o UserKnownHostsFile="$VM_DIR/known_hosts" -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=5 -o LogLevel=ERROR)
port=${MONSTERS_WINVM_SSH_PORT:-22522}

if [[ $(bash "$ci" status | head -1) == *off* ]]; then
  qemu-img snapshot -a ci-base "$VM_DIR/disk.qcow2"
  cp "$VM_DIR/OVMF_VARS.ci-base.fd" "$VM_DIR/OVMF_VARS.fd"
  started=1
else
  started=0
  echo "test-windows: the VM is already on (another run?), using it as it is"
fi
cleanup() { if ((started && !keep)); then bash "$ci" stop; fi; }
trap cleanup EXIT
bash "$ci" start

cert=none
files=("$installer" "$app_dir/scripts/test-windows.ps1" "$app_dir/scripts/install-probe.mjs")
# Monsters-Setup-<version>-x64-<label>.exe
version=$(basename "$installer" | sed -E 's/^Monsters-Setup-([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?)-(x64|arm64).*/\1/')
if [[ $installer == *-test-signed.exe ]]; then
  files+=("$app_dir/.signing/test-ca.crt")
  cert='C:\Users\ci\monsters-test\test-ca.crt'
fi
ssh "${ssh_opts[@]}" -p "$port" ci@127.0.0.1 'powershell -NoProfile -Command "New-Item -Force -ItemType Directory C:\Users\ci\monsters-test | Out-Null"'
scp -q "${ssh_opts[@]}" -P "$port" "${files[@]}" ci@127.0.0.1:monsters-test/
ssh "${ssh_opts[@]}" -p "$port" ci@127.0.0.1 \
  "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\ci\\monsters-test\\test-windows.ps1 -Installer C:\\Users\\ci\\monsters-test\\$(basename "$installer") -TestCert $cert -Version $version -Probe C:\\Users\\ci\\monsters-test\\install-probe.mjs"
