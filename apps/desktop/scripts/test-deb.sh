#!/usr/bin/env bash
# Installs the .deb in a clean Ubuntu 24.04 (ubuntu-base, in a chroot with its own mount
# namespace), checks what the package put on the system (files, link, AppArmor profile), starts
# the installed app under Xvfb as a normal user up to the registration done from its window
# (install-probe.mjs), then removes the package and checks that nothing of it is left in /opt,
# /usr and /etc. Needs sudo; no container engine needed (M3.4, D-046; in the CI since M3.5).
#
#   bash apps/desktop/scripts/test-deb.sh apps/desktop/release/Monsters-<v>-linux-amd64.deb [version]
#
# MONSTERS_TEST_UPDATE_KEY=<file name>: the package is a test build with a feed (install-test.ts,
# review of wave 5, item 5): its update keys must be in /opt/Monsters/resources/update-keys, with
# that one (the test key of the run) among them, next to app-update.yml and update-test-build.
#
# The clean system has no Node, and the app's binary is not one (RunAsNode fuse off, S-M8: the
# run checks that ELECTRON_RUN_AS_NODE does not make it one): the probe runs with a copy of the
# Node of MONSTERS_TEST_NODE (install-test.ts passes its own, an official build), else of the
# `node` on the PATH, in /tmp of the chroot, outside the PATH and the snapshot.
#
# `version`: what the app must report (default: the Version of the deb, which for a prerelease
# may be spelled differently by the packager).
# The chroot has no AppArmor of its own (the kernel's profiles are the host's), so the installed
# app starts with --no-sandbox here; the profile itself is tested on the host by
# test-apparmor.sh. The package scripts must not touch the host's profiles: in the pid namespace
# `ischroot` says "not a chroot", so until 17/10/2026 the postrm unloaded the host's `monsters`
# profile and the installed app stopped starting after every evening CI (D-087). The chroot gets
# an `ischroot` that says yes and a read-only AppArmor filesystem, and the run checks after that
# the host's profile is still loaded. Base image cached in ~/.cache/monsters-test (signature and checksum checked).
# The chroot shares the host's network: the core and the DevTools port listen on 127.0.0.1. The
# app gets no session bus (no tray or notification can reach a desktop) and, as the packaged app
# requires for the DevTools port (D-049), its own MONSTERS_HOME and user data folder.
set -euo pipefail

deb=$(realpath "${1:?usage: test-deb.sh <file.deb> [version]}")
probe=$(realpath "$(dirname "$0")/install-probe.mjs")
version=${2:-$(dpkg-deb -f "$deb" Version)}
node_bin=$(realpath "${MONSTERS_TEST_NODE:-$(command -v node || echo /nonexistent)}")
[[ -x $node_bin ]] || { echo "test-deb: no Node for the probe (MONSTERS_TEST_NODE)" >&2; exit 1; }
BASE=ubuntu-base-24.04.5-base-amd64.tar.gz
BASE_URL=https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release
cache=${XDG_CACHE_HOME:-$HOME/.cache}/monsters-test
mkdir -p "$cache"

if [[ ! -f $cache/$BASE.ok ]]; then
  curl -fsSL --retry 3 -o "$cache/SHA256SUMS" "$BASE_URL/SHA256SUMS"
  curl -fsSL --retry 3 -o "$cache/SHA256SUMS.gpg" "$BASE_URL/SHA256SUMS.gpg"
  gpgv --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg "$cache/SHA256SUMS.gpg" \
    "$cache/SHA256SUMS" 2>/dev/null || { echo "test-deb: bad signature on SHA256SUMS" >&2; exit 1; }
  curl -fsSL --retry 3 -o "$cache/$BASE" "$BASE_URL/$BASE"
  (cd "$cache" && grep " \*$BASE\$" SHA256SUMS | sha256sum -c --quiet -) ||
    { echo "test-deb: checksum of $BASE does not match" >&2; rm -f "$cache/$BASE"; exit 1; }
  touch "$cache/$BASE.ok"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/monsters-deb.XXXXXX")
root=$work/root
cleanup() {
  # The mounts live in the namespace of the unshare below and are gone with it.
  sudo rm -rf --one-file-system "$work"
}
trap cleanup EXIT
mkdir -p "$root"
sudo tar -xzf "$cache/$BASE" -C "$root"
sudo cp "$deb" "$root/tmp/monsters.deb"
sudo cp "$probe" "$root/tmp/install-probe.mjs"
sudo chmod 644 "$root/tmp/install-probe.mjs"
sudo cp "$node_bin" "$root/tmp/node"
sudo chmod 755 "$root/tmp/node"
sudo cp /etc/resolv.conf "$root/etc/resolv.conf"
# This is a chroot: the postinst copies the profile but does not load it, the postrm does not
# unload it (both check /usr/bin/ischroot).
printf '#!/bin/sh\nexit 0\n' | sudo tee "$root/usr/bin/ischroot" >/dev/null
sudo chmod 755 "$root/usr/bin/ischroot"
host_profile() { sudo grep -qx 'monsters (.*)' /sys/kernel/security/apparmor/profiles 2>/dev/null; }
host_had_profile=no
host_profile && host_had_profile=yes

sudo tee "$root/tmp/inner.sh" >/dev/null <<'INNER'
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
version=$1
update_key=${2:-}
step() { printf '\n== %s\n' "$*"; }
# Everything under /opt, /usr and /etc, by name (content changes such as caches do not count).
snapshot() { find /opt /usr /etc -xdev -not -path '/etc/resolv.conf' 2>/dev/null | sort; }

step "dependencies (apt resolves the Depends of the package on a clean system)"
apt-get update -qq
apt-get install -y -qq --no-install-recommends apparmor xvfb xauth ca-certificates >/dev/null
apt-get satisfy -y -qq --no-install-recommends "$(dpkg-deb -f /tmp/monsters.deb Depends)" >/dev/null
# The test user before the snapshot: useradd leaves /etc/subuid- and /etc/subgid- behind.
# A uid no account of the host has: the chroot shares the host's kernel and, before M3.5, a
# `pkill -u tester` here matched the processes of the host user with the same uid (1000).
useradd -m -u 59123 tester
snapshot >/tmp/before.txt

step "install"
apt-get install -y -qq --no-install-recommends /tmp/monsters.deb 2>&1 | grep -v '^debconf' | tail -5
dpkg -s monsters | grep -E '^(Status|Version):'

step "files"
# `test … && …` does not stop a `set -e` script when the test fails: every check says so itself.
fail() { echo "FAILED: $*"; exit 1; }
test -x /opt/Monsters/monsters || fail "no /opt/Monsters/monsters"
echo "binary: /opt/Monsters/monsters"
test "$(readlink -f /usr/bin/monsters)" = /opt/Monsters/monsters || fail "/usr/bin/monsters does not point to the app"
echo "link: /usr/bin/monsters -> /opt/Monsters/monsters"
test -f /usr/share/applications/monsters.desktop || fail "no /usr/share/applications/monsters.desktop"
grep -E '^(Exec|StartupWMClass)=' /usr/share/applications/monsters.desktop || fail "monsters.desktop without Exec"
ls /opt/Monsters/resources/core/node_modules/@node-rs /opt/Monsters/resources/core/node_modules/@napi-rs
stat -c 'chrome-sandbox: %a %U' /opt/Monsters/chrome-sandbox
# Written after the afterPack hook, so they take the umask of the build: never group-writable.
# package-type exists only in a build with the update feed (not in the install test's).
for f in /opt/Monsters/resources/package-type /opt/Monsters/resources/apparmor-profile \
         /usr/share/applications/monsters.desktop; do
  if [ "$f" = /opt/Monsters/resources/package-type ] && [ ! -e "$f" ]; then continue; fi
  test "$(stat -c %a "$f")" = 644 || fail "$f has mode $(stat -c %a "$f"), not 644"
done
echo "modes: package-type, apparmor-profile and monsters.desktop are 0644"
missing=$(ldd /opt/Monsters/monsters /opt/Monsters/*.so* 2>/dev/null | grep 'not found' | sort -u || true)
if [ -n "$missing" ]; then echo "libraries missing after install (Depends):"; echo "$missing"; exit 1; fi
echo "shared libraries: all found"
# The fuse wire of the installed binary (@electron/fuses: sentinel, version, length, one byte per
# fuse, RunAsNode first): the app's binary must never run as a plain Node (S-M8).
/tmp/node -e '
  const b = require("fs").readFileSync("/opt/Monsters/monsters");
  const at = b.indexOf("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
  if (at < 0) { console.log("FAILED: no fuse wire in /opt/Monsters/monsters"); process.exit(1); }
  const runAsNode = String.fromCharCode(b[at + 32 + 2]);
  console.log(`RunAsNode fuse: ${runAsNode === "0" ? "off" : `NOT off (${runAsNode})`}`);
  process.exit(runAsNode === "0" ? 0 : 1);
' || fail "RunAsNode is not off"
# The root script of the updates checks the signature with /usr/bin/openssl: 3.0 at least (Depends).
case "$(/usr/bin/openssl version 2>/dev/null)" in
  'OpenSSL '[3-9].*) echo "openssl: $(/usr/bin/openssl version)" ;;
  *) fail "no /usr/bin/openssl 3.0 or later" ;;
esac
if [ -n "$update_key" ]; then
  keys=/opt/Monsters/resources/update-keys
  test -f "$keys/$update_key" || fail "no $update_key in $keys"
  test "$(stat -c '%a %U' "$keys/$update_key")" = '644 root' || fail "$keys/$update_key is not root's, 0644"
  test -f /opt/Monsters/resources/app-update.yml || fail "no app-update.yml (a build with a feed)"
  test -f /opt/Monsters/resources/update-test-build || fail "no update-test-build marker"
  echo "update keys: $(ls "$keys" | tr '\n' ' ')(test build with a feed)"
fi
echo "installed: $(comm -13 /tmp/before.txt <(snapshot) | wc -l) paths under /opt, /usr, /etc"

if cmp -s /opt/Monsters/resources/apparmor-profile /etc/apparmor.d/monsters; then
  echo "AppArmor profile installed in /etc/apparmor.d/monsters (not loaded: chroot, ischroot says so)"
else
  echo "AppArmor profile NOT installed"; exit 1
fi

step "first start as a normal user, up to the registration from the window"
su tester -s /bin/bash -c '
  set -u
  unset DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR WAYLAND_DISPLAY DISPLAY
  export MONSTERS_HOME=$HOME/test-home MONSTERS_DESKTOP_USER_DATA=$HOME/test-userdata \
    MONSTERS_SECRETS=file MONSTERS_UPDATE=off MONSTERS_EMBEDDINGS=off MONSTERS_TELEGRAM=off \
    NO_AT_BRIDGE=1
  # A free port for the DevTools protocol, chosen by the Node of the probe.
  cdp=$(/tmp/node -e "
    const s = require(\"net\").createServer().listen(0, \"127.0.0.1\", () => {
      console.log(s.address().port); s.close(); });")
  xvfb-run -a /opt/Monsters/monsters --no-sandbox --remote-debugging-port=$cdp >/tmp/app.log 2>&1 &
  /tmp/node /tmp/install-probe.mjs \
    --home "$MONSTERS_HOME" --cdp "$cdp" --version '"$version"' --timeout 150
  ok=$?
  grep -E "Monsters desktop|updates:|started core|automatic login" "$MONSTERS_HOME/logs/desktop.log" || true
  [ $ok = 0 ] || { echo "-- app.log"; tail -30 /tmp/app.log; }
  # By process name: a pattern on the command line would match this very shell.
  pkill -TERM -u tester -x monsters || true
  for i in $(seq 1 20); do pgrep -u tester -x monsters >/dev/null || break; sleep 0.5; done
  pkill -KILL -u tester -x monsters || true
  pkill -KILL -u tester -x Xvfb || true
  # xvfb-run cleans up after its server (xauth, xkbcomp): wait for it, not only for the app.
  wait
  [ $ok = 0 ]
'
# A few seconds for what the wrapper leaves to exit on its own; then anything left is a leak.
for i in $(seq 1 20); do pgrep -u tester >/dev/null || break; sleep 0.5; done
if pgrep -u tester >/dev/null; then echo "processes of the app still running:"; pgrep -a -u tester; exit 1; fi
echo "app stopped, no process left"

step "remove"
apt-get remove -y -qq monsters >/dev/null
dpkg -s monsters 2>/dev/null | grep -q '^Status: install' && { echo "still installed"; exit 1; }
test ! -e /etc/apparmor.d/monsters || fail "AppArmor profile still there after the removal"
echo "AppArmor profile removed"
left=$(comm -13 /tmp/before.txt <(snapshot))
if [ -n "$left" ]; then
  echo "left behind under /opt, /usr, /etc after the removal:"
  echo "$left" | head -40
  exit 1
fi
echo "nothing left under /opt, /usr and /etc"
INNER
sudo chmod +x "$root/tmp/inner.sh"

# Own mount AND pid namespaces: pgrep/pkill in the chroot see only its processes, and whatever
# is left is killed when the namespace's first process exits.
sudo unshare --mount --pid --fork --propagation private bash -c '
  set -e
  root=$1
  mount --rbind /dev "$root/dev"
  mount -t proc proc "$root/proc"
  mount --rbind /sys "$root/sys"
  # Read-only in this namespace: nothing in the chroot can load or unload a host profile.
  if mountpoint -q "$root/sys/kernel/security"; then
    mount -o bind,remount,ro "$root/sys/kernel/security"
  fi
  mount -t tmpfs tmpfs "$root/dev/shm"
  # A clean system gets a clean environment: nothing of the host reaches the chroot (D-152;
  # a runner exports XDG_CONFIG_HOME=/home/runner/.config, and the app of the test user died
  # with "Failed to get userData path").
  chroot "$root" /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root TERM=dumb /tmp/inner.sh "$2" "$3"
' _ "$root" "$version" "${MONSTERS_TEST_UPDATE_KEY:-}"
if [[ $host_had_profile == yes ]] && ! host_profile; then
  echo "test-deb: the host's AppArmor profile 'monsters' is no longer loaded after the test" >&2
  exit 1
fi
echo
echo "test-deb: OK ($(basename "$deb"), $version)"
