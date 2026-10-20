#!/usr/bin/env bash
# Runs the real-keychain test (packages/core/test/keychain-real.test.ts) on Linux
# against a throwaway Secret Service: a private D-Bus session with its own GNOME
# Keyring, keyrings in a temporary folder, no display (no prompt can reach the
# desktop). The user's own keyring and session bus are never touched (D-042).
#
#   scripts/test-keychain-linux.sh        (needs dbus-run-session and gnome-keyring-daemon)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
for bin in dbus-run-session gnome-keyring-daemon node; do
  command -v "$bin" >/dev/null || { echo "test-keychain: $bin not found, skipped" >&2; exit 0; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/data" "$tmp/config"
mkdir -m 700 "$tmp/run"

unset DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY
export XDG_DATA_HOME="$tmp/data" XDG_CONFIG_HOME="$tmp/config" XDG_RUNTIME_DIR="$tmp/run"
export MONSTERS_TEST_KEYCHAIN=1

cat >"$tmp/inner.sh" <<'EOF'
set -euo pipefail
# Creates and unlocks the "login" keyring of this private session (password on stdin).
printf 'monsters-test' | gnome-keyring-daemon --unlock --components=secrets >/dev/null
cd "$1"
node node_modules/vitest/vitest.mjs run packages/core/test/keychain-real.test.ts
EOF
dbus-run-session -- bash "$tmp/inner.sh" "$root"
