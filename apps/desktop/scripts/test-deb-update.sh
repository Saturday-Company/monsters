#!/usr/bin/env bash
# The update of the .deb from the app (D-105), for real, in a clean Ubuntu 24.04 chroot (the one of
# test-deb.sh: ubuntu-base, own mount and pid namespaces, sudo): installs the old package, starts
# it as a normal user under Xvfb with MONSTERS_UPDATE_AUTO_INSTALL=1 (the user's "Riavvia ora"),
# and the app downloads the new package from the feed baked into it (a local server of
# update-e2e.ts --deb, on the host: the chroot shares its network), checks the sha512 and
# installs it with `dpkg -i` through pkexec. Called by `pnpm desktop:update-e2e --deb`.
#
#   bash apps/desktop/scripts/test-deb-update.sh <old.deb> <old version> <new version> <scenario>...
#
# There is no polkit agent in the chroot: /usr/bin/pkexec is a stand-in that checks
# --disable-internal-agent, records its arguments and runs the command as root with sudo (what
# pkexec does once the password is accepted), or answers like a cancelled prompt. Everything
# else is the real thing: electron-updater, the root script, dpkg, the package's scripts.
# Scenarios, in this order on the same system:
#   cancel   the password prompt cancelled (126): nothing stopped, the old version keeps running
#            with its core, dpkg never runs;
#   dpkg     dpkg fails after the core stopped (the app's binary made immutable): dpkg puts the
#            old files back, the old version starts again, healthy;
#   ok       the new version installed and started, with a healthy core; the core was already
#            stopped when dpkg ran (a dpkg pre-invoke hook knocks on its port), the package's
#            postinst ran (AppArmor profile, link).
set -euo pipefail

deb=$(realpath "${1:?usage: test-deb-update.sh <old.deb> <old version> <new version> <scenario>...}")
old=${2:?old version}
new=${3:?new version}
shift 3
[[ $# -gt 0 ]] || set -- cancel dpkg ok
BASE=ubuntu-base-24.04.5-base-amd64.tar.gz
cache=${XDG_CACHE_HOME:-$HOME/.cache}/monsters-test
[[ -f $cache/$BASE.ok ]] || { echo "test-deb-update: run test-deb.sh once first (base image)" >&2; exit 1; }

work=$(mktemp -d "${TMPDIR:-/tmp}/monsters-deb-update.XXXXXX")
root=$work/root
cleanup() {
  sudo chattr -i "$root/opt/Monsters/monsters" 2>/dev/null || true
  sudo rm -rf --one-file-system "$work"
}
trap cleanup EXIT
mkdir -p "$root"
sudo tar -xzf "$cache/$BASE" -C "$root"
sudo cp "$deb" "$root/tmp/old.deb"
sudo cp /etc/resolv.conf "$root/etc/resolv.conf"
# A chroot: the package scripts must not touch the host's AppArmor profiles (D-087).
printf '#!/bin/sh\nexit 0\n' | sudo tee "$root/usr/bin/ischroot" >/dev/null
sudo chmod 755 "$root/usr/bin/ischroot"
host_profile() { sudo grep -qx 'monsters (.*)' /sys/kernel/security/apparmor/profiles 2>/dev/null; }
host_had_profile=no
host_profile && host_had_profile=yes

sudo tee "$root/tmp/inner.sh" >/dev/null <<'INNER'
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
old=$1 new=$2
shift 2
step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAILED: $*"; [ -n "${h:-}" ] && tail -40 "$h/home/logs/desktop.log" 2>/dev/null; exit 1; }

step "dependencies"
apt-get update -qq
apt-get install -y -qq --no-install-recommends apparmor xvfb xauth ca-certificates sudo e2fsprogs >/dev/null
apt-get satisfy -y -qq --no-install-recommends "$(dpkg-deb -f /tmp/old.deb Depends)" >/dev/null
useradd -m -u 59123 tester
echo 'tester ALL=(root) NOPASSWD: ALL' >/etc/sudoers.d/tester
chmod 440 /etc/sudoers.d/tester

step "install $old"
apt-get install -y -qq --no-install-recommends /tmp/old.deb 2>&1 | grep -v '^debconf' | tail -3
dpkg-query -W -f='${Version} ${Status}\n' monsters

# The stand-in for pkexec (see the header).
cat >/usr/bin/pkexec <<'PKEXEC'
#!/bin/sh
[ "$1" = --disable-internal-agent ] || { echo "pkexec (test): no --disable-internal-agent" >&2; exit 3; }
shift
printf '%s\n' "$@" >/tmp/pkexec-args
case $(cat /tmp/pkexec-mode) in
  cancel) echo 'Error executing command as another user: Request dismissed' >&2; exit 126 ;;
esac
exec sudo -n -- "$@"
PKEXEC
chmod 755 /usr/bin/pkexec
# Before every dpkg run from now on: is the core of the running app still listening?
cat >/usr/local/bin/core-at-dpkg <<'HOOK'
#!/bin/bash
port=$(cat /tmp/core-port 2>/dev/null || echo 0)
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then state=up; else state=down; fi
echo "core $state on port $port" >>/tmp/core-at-dpkg
HOOK
chmod 755 /usr/local/bin/core-at-dpkg
echo 'pre-invoke=/usr/local/bin/core-at-dpkg' >/etc/dpkg/dpkg.cfg.d/monsters-test

core_port() { grep -o '"url": *"http://127.0.0.1:[0-9]*' "$1/server.json" 2>/dev/null | grep -o '[0-9]*$'; }
healthy() {
  local port
  port=$(core_port "$1") || return 1
  timeout 3 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
    printf "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:%s\r\n\r\n" "$1" >&3
    head -1 <&3 | grep -q " 200 "' _ "$port"
}
# Waits until desktop.log matches all the patterns and the core answers.
wait_for() {
  local what=$1 i p ok
  shift
  for i in $(seq 1 240); do
    ok=yes
    for p in "$@"; do grep -qF -- "$p" "$h/home/logs/desktop.log" 2>/dev/null || ok=no; done
    if [ $ok = yes ] && healthy "$h/home"; then echo "$what (${i}s)"; return 0; fi
    sleep 1
  done
  fail "not $what after 240s"
}
starts() { grep -c "Monsters desktop $1" "$h/home/logs/desktop.log" || true; }
stop_app() {
  pkill -TERM -u tester -x monsters || true
  for i in $(seq 1 20); do pgrep -u tester -x monsters >/dev/null || break; sleep 0.5; done
  pkill -KILL -u tester -x monsters || true
  pkill -KILL -u tester -x Xvfb || true
}

scenario() {
  local name=$1
  step "scenario $name"
  h=/home/tester/$name
  rm -f /tmp/core-at-dpkg /tmp/core-port /tmp/pkexec-args
  echo "$2" >/tmp/pkexec-mode
  su tester -s /bin/bash -c '
    set -eu
    h=$1
    mkdir -p "$h/home" "$h/userdata" "$h/cache"
    # The first-start question already answered ("Su questo computer").
    echo "{\"version\":1,\"profiles\":[],\"last\":\"local\"}" >"$h/userdata/connections.json"
    setsid Xvfb -displayfd 3 -nolisten tcp -screen 0 1280x800x24 3>"$h/display" >"$h/xvfb.log" 2>&1 &
    for i in $(seq 1 50); do [ -s "$h/display" ] && break; sleep 0.1; done
    unset DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR WAYLAND_DISPLAY
    # Its own download cache (electron-updater: $XDG_CACHE_HOME/monsters-updater).
    DISPLAY=:$(cat "$h/display") XDG_CACHE_HOME=$h/cache MONSTERS_HOME=$h/home \
      MONSTERS_DESKTOP_USER_DATA=$h/userdata MONSTERS_SECRETS=file MONSTERS_EMBEDDINGS=off \
      MONSTERS_TELEGRAM=off MONSTERS_UPDATE_AUTO_INSTALL=1 NO_AT_BRIDGE=1 \
      setsid /opt/Monsters/monsters --no-sandbox --ozone-platform=x11 >"$h/app.log" 2>&1 </dev/null &
  ' _ "$h"
  # The port of the old core, for the dpkg hook (as soon as it is up).
  for i in $(seq 1 120); do core_port "$h/home" >/tmp/core-port 2>/dev/null && break; sleep 0.5; done
}

report() {
  grep -E "Monsters desktop|updates:|core (started|stopped)|started core" "$h/home/logs/desktop.log" | sed 's/^/    /' || true
  [ -f /tmp/core-at-dpkg ] && sed 's/^/    dpkg hook: /' /tmp/core-at-dpkg
  if [ -f /tmp/pkexec-args ]; then
    echo "    pkexec: $(head -2 /tmp/pkexec-args | tr '\n' ' ')… $(tail -3 /tmp/pkexec-args | tr '\n' ' ')"
  fi
  echo "    package: $(dpkg-query -W -f='${Version} ${Status}' monsters)"
}

# Common to every scenario: the password was asked with pkexec as the app does it.
check_pkexec() {
  [ "$(sed -n 1p /tmp/pkexec-args)" = /bin/sh ] || fail "pkexec did not run /bin/sh"
  [ "$(sed -n 2p /tmp/pkexec-args)" = -c ] || fail "pkexec did not run sh -c"
  grep -q "^/home/tester/$1/cache/monsters-updater/pending/.*\.deb$" /tmp/pkexec-args ||
    fail "pkexec was not given the downloaded .deb"
  grep -qE '^[0-9a-f]{128}$' /tmp/pkexec-args || fail "pkexec was not given the sha512 in hex"
  # The signed channel file the app verified, checked again by root (S-A4).
  grep -qx 'alpha-linux.yml' /tmp/pkexec-args || fail "pkexec was not given the channel file's name"
  grep -q 'channel\.yml\.sig$' /tmp/pkexec-args || fail "pkexec was not given the signature"
  grep -qF "/opt/Monsters/resources/update-keys" /tmp/pkexec-args || fail "the root script does not use root's keys"
  if grep -qE '(^|[^-])\bapt(-get)?\b|allow-unauthenticated' /tmp/pkexec-args; then fail "apt in the root command"; fi
}

old_version=$(dpkg-query -W -f='${Version}' monsters)

for s in "$@"; do
  case $s in
    cancel)
      scenario cancel cancel
      wait_for "the install cancelled, $old still running" \
        "updates: version $new not installed (cancelled), still running $old"
      report
      check_pkexec cancel
      grep -qF 'stopping the core' "$h/home/logs/desktop.log" && fail "the core was stopped"
      [ "$(starts "$old")" = 1 ] || fail "the app restarted"
      [ ! -f /tmp/core-at-dpkg ] || fail "dpkg ran"
      [ "$(dpkg-query -W -f='${Version}' monsters)" = "$old_version" ] || fail "the package changed"
      stop_app
      echo "cancel: OK"
      ;;
    dpkg)
      chattr +i /opt/Monsters/monsters
      scenario dpkg ok
      wait_for "dpkg failed, $old started again" "updates: install failed (dpkg exit" \
        "Monsters desktop $old"
      for i in $(seq 1 60); do [ "$(starts "$old")" -ge 2 ] && healthy "$h/home" && break; sleep 1; done
      report
      chattr -i /opt/Monsters/monsters
      check_pkexec dpkg
      [ "$(starts "$old")" -ge 2 ] || fail "$old did not start again"
      grep -qx "core down on port $(cat /tmp/core-port)" /tmp/core-at-dpkg || fail "the core was running when dpkg ran"
      healthy "$h/home" || fail "no healthy core after the restart"
      [ "$(dpkg-query -W -f='${Version}' monsters)" = "$old_version" ] || fail "the package changed"
      stop_app
      echo "dpkg: OK"
      ;;
    ok)
      scenario ok ok
      wait_for "$new running" "Monsters desktop $new"
      report
      check_pkexec ok
      grep -qx "core down on port $(cat /tmp/core-port)" /tmp/core-at-dpkg || fail "the core was running when dpkg ran"
      for l in "updates: password accepted, stopping the core before dpkg" \
        "updates: installing version $new with dpkg" "updates: version $new installed, restarting"; do
        grep -qF -- "$l" "$h/home/logs/desktop.log" || fail "no '$l' in desktop.log"
      done
      [ "$(dpkg-query -W -f='${Status}' monsters)" = "install ok installed" ] || fail "package not configured"
      [ "$(dpkg-query -W -f='${Version}' monsters)" != "$old_version" ] || fail "the package did not change"
      cmp -s /opt/Monsters/resources/apparmor-profile /etc/apparmor.d/monsters || fail "no AppArmor profile after the update"
      [ "$(readlink -f /usr/bin/monsters)" = /opt/Monsters/monsters ] || fail "no /usr/bin/monsters"
      ls /var/tmp | grep -q monsters-update && fail "root's copy left in /var/tmp"
      echo "    $(dpkg-query -W -f='${Version}' monsters), profile and link in place, /var/tmp clean"
      stop_app
      echo "ok: OK"
      ;;
    *) fail "unknown scenario $s" ;;
  esac
done
INNER
sudo chmod +x "$root/tmp/inner.sh"

sudo unshare --mount --pid --fork --propagation private bash -c '
  set -e
  root=$1
  shift
  # The work folder may be on a nosuid /tmp: sudo (the stand-in for pkexec) must be setuid.
  mount --bind "$root" "$root"
  mount -o remount,bind,suid,dev "$root"
  mount --rbind /dev "$root/dev"
  mount -t proc proc "$root/proc"
  mount --rbind /sys "$root/sys"
  if mountpoint -q "$root/sys/kernel/security"; then
    mount -o bind,remount,ro "$root/sys/kernel/security"
  fi
  mount -t tmpfs tmpfs "$root/dev/shm"
  chroot "$root" /tmp/inner.sh "$@"
' _ "$root" "$old" "$new" "$@"
if [[ $host_had_profile == yes ]] && ! host_profile; then
  echo "test-deb-update: the host's AppArmor profile 'monsters' is no longer loaded after the test" >&2
  exit 1
fi
echo
echo "test-deb-update: OK ($*)"
