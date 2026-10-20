#!/usr/bin/env bash
# Checks the AppArmor profile of the .deb on this machine (Ubuntu 24.04+, user namespaces restricted):
# extracts the package to a temporary folder, loads a copy of its profile bound to that path for
# the length of the test (sudo), starts the app WITH the Chromium sandbox under Xvfb up to a
# healthy core, then unloads the profile. Without the profile the same start aborts
# ("The SUID sandbox helper binary was found, but is not configured correctly").
#
#   bash apps/desktop/scripts/test-apparmor.sh apps/desktop/release/Monsters-<v>-linux-amd64.deb
set -euo pipefail

deb=$(realpath "${1:?usage: test-apparmor.sh <file.deb>}")
[[ $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null) == 1 ]] ||
  echo "note: user namespaces are not restricted here, the test proves little"
work=$(mktemp -d "${TMPDIR:-/tmp}/monsters-apparmor.XXXXXX")
profile=$work/monsters-test.apparmor
loaded=0
cleanup() {
  pkill -TERM -f "$work/opt/Monsters/monsters" 2>/dev/null || true
  sleep 1
  ((loaded)) && sudo apparmor_parser -R "$profile" && echo "profile unloaded"
  rm -rf "$work"
}
trap cleanup EXIT

dpkg-deb -x "$deb" "$work"
bin=$work/opt/Monsters/monsters
src=$work/opt/Monsters/resources/apparmor-profile
sudo apparmor_parser --skip-kernel-load "$src" && echo "shipped profile: parses"
sed -e "s|profile \"monsters\" \"/opt/Monsters/monsters\"|profile \"monsters-test-$$\" \"$bin\"|" \
  -e 's|include if exists <local/monsters>||' "$src" >"$profile"
grep -q "monsters-test-$$" "$profile" || { echo "unexpected profile:"; cat "$src"; exit 1; }
sudo apparmor_parser -r "$profile"
loaded=1
echo "test profile loaded for $bin"

export MONSTERS_HOME=$work/home MONSTERS_DESKTOP_USER_DATA=$work/userdata MONSTERS_SECRETS=file \
  MONSTERS_UPDATE=off
# Never on the desktop of the person at this PC: X11 on the Xvfb of xvfb-run only, a private
# session bus without services (no tray icon or notification on their desktop) and a private
# XDG_RUNTIME_DIR (Electron finds a Wayland compositor through it).
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11 NO_AT_BRIDGE=1 XDG_RUNTIME_DIR=$work/runtime
mkdir -p "$MONSTERS_HOME" "$XDG_RUNTIME_DIR" "$MONSTERS_DESKTOP_USER_DATA"
chmod 700 "$XDG_RUNTIME_DIR"
# The first-start question already answered ("Su questo computer"): this test is about the
# sandbox, and nobody clicks in the window.
printf '{"version":1,"profiles":[],"last":"local"}\n' >"$MONSTERS_DESKTOP_USER_DATA/connections.json"
cat >"$XDG_RUNTIME_DIR/bus.conf" <<EOF
<busconfig><type>session</type><listen>unix:path=$XDG_RUNTIME_DIR/bus</listen>
<auth>EXTERNAL</auth><policy context="default"><allow send_destination="*" eavesdrop="true"/>
<allow eavesdrop="true"/><allow own="*"/></policy></busconfig>
EOF
dbus-run-session --config-file="$XDG_RUNTIME_DIR/bus.conf" -- \
  xvfb-run -a "$bin" --ozone-platform=x11 >"$work/app.log" 2>&1 &
pid=$!
ok=0
for i in $(seq 1 60); do
  if [[ -f $MONSTERS_HOME/server.json ]]; then
    url=$(sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' "$MONSTERS_HOME/server.json")
    if [[ -n $url ]] && curl -fsS "$url/api/health" >/dev/null; then ok=1; break; fi
  fi
  kill -0 $pid 2>/dev/null || break
  sleep 1
done
if grep -q -- '--no-sandbox\|SUID sandbox' "$work/app.log"; then ok=0; fi
if ((ok)); then
  echo "healthy core after ${i}s, Chromium sandbox on (no --no-sandbox)"
else
  tail -20 "$work/app.log"
  echo "test-apparmor: FAILED"
  exit 1
fi
echo "test-apparmor: OK"
