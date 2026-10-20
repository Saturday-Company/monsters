#!/bin/bash
# Signed macOS build of Monsters (review 19/10, wave 5, item 2), run as the user `monsters-sign`.
#
# NOT run from the repo: the Mac's owner installs a reviewed copy as root, outside any folder the CI can
# write (docs/signing.md, "Mac: utente di firma"):
#
#   /usr/local/libexec/monsters/sign-build.sh   root:wheel 755 (folder root:wheel 755)
#
# and `monsters-ci` may start it only through sudo, as `monsters-sign`, with this rule alone in
# /etc/sudoers.d/monsters-sign:
#
#   monsters-ci ALL=(monsters-sign) NOPASSWD: /usr/local/libexec/monsters/sign-build.sh
#
#   sudo -n -u monsters-sign -H /usr/local/libexec/monsters/sign-build.sh <sha> <run> \
#     [--version <v>] [--feed <FEED>]
#
#   <sha>    the full commit (40 hex digits) to build; it is fetched from the git bundle
#            /Users/Shared/monsters-sign/inbox/<run>.bundle (written by monsters-ci) into a repo
#            of monsters-sign and checked by its hash: the bundle can only carry that commit
#   <run>    the ci-mac.sh run id (YYYYMMDD-HHMMSS-<short sha>-mac)
#   --version <v>  version of the build (default: apps/desktop/package.json of the commit)
#   --feed <url>   the update feed: only FEED below is accepted (a release); without it the
#                  build has no updates
#
# Arguments are checked before
# anything else; sudo resets the environment, and nothing of monsters-ci's is read but the
# bundle. What it does, as monsters-sign, in its own home (700):
#   1. its own Node (official tarball, sha256 below) and pnpm (corepack);
#   2. a clean checkout of <sha> and `pnpm install --frozen-lockfile --ignore-scripts` with its
#      own store: never the node_modules of the CI, no dependency script runs (none is needed to
#      package: electron-builder downloads Electron itself);
#   3. `package.ts --mac --build-only` with the signing keychain still locked;
#   4. unlocks the keychain, `package.ts --mac --no-build` with the signing identity and the
#      notarization profile (never the keychain password), locks the keychain again;
#   5. copies the packages to /Users/Shared/monsters-sign/outbox/<run>/ (readable by monsters-ci)
#      and appends commit and dmg checksums to ~/signed.log.
#
# What remains (docs/signing.md): steps 3 and 4 run code of the commit (package.ts, electron-builder,
# after-pack.ts, the dependencies) as monsters-sign, step 4 with the keychain open. The key cannot
# be exported, but a malicious commit can have codesign sign something else while it runs. Only
# commits reviewed onto main should get here.
#
# Exit code: 0 packages delivered, 1 the build failed, 2 usage or setup error, 75 busy.
# macOS /bin/bash is 3.2.
set -u
umask 022

NODE_VERSION=24.21.0
# node-v24.21.0-darwin-arm64.tar.gz, from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
NODE_SHA256=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057
FEED=https://monsters-updates.saturdaycompany.workers.dev/desktop/
SIGN_USER=monsters-sign
SHARED=/Users/Shared/monsters-sign
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin

die() {
  echo "sign-build: $*" >&2
  exit 2
}

# --- arguments: checked before anything is read or run ----------------------------------------

[ $# -ge 2 ] || die "usage: sign-build.sh <sha> <run> [--version <v>] [--feed $FEED]"
SHA=$1
RUN=$2
shift 2
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' || die "not a full commit sha: $SHA"
printf '%s' "$RUN" | grep -Eq '^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}-mac$' || die "not a run id: $RUN"
[ "${RUN#*-*-}" = "${SHA:0:7}-mac" ] || die "run $RUN is not of commit $SHA"
VERSION=
FEED_ARGS=
while [ $# -gt 0 ]; do
  case $1 in
    --version)
      [ $# -ge 2 ] || die "--version needs a value"
      printf '%s' "$2" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$' ||
        die "not a version: $2"
      VERSION=$2
      shift 2
      ;;
    --feed)
      [ "${2:-}" = "$FEED" ] || die "--feed: only $FEED"
      FEED_ARGS="--feed $FEED"
      shift 2
      ;;
    *) die "unsupported argument: $1 (only --version <v>, --feed $FEED)" ;;
  esac
done

[ "$(/usr/bin/id -un)" = "$SIGN_USER" ] || die "must run as $SIGN_USER (sudo -u $SIGN_USER -H)"
export PATH=$SAFE_PATH
S=$(/usr/bin/dscl . -read "/Users/$SIGN_USER" NFSHomeDirectory 2>/dev/null | awk '{ print $2 }')
[ -n "$S" ] && [ -d "$S" ] || die "no home for $SIGN_USER"
cd "$S" || die "cannot enter $S"

# The secrets: monsters-sign's own, nobody else may read them.
SECRETS="$S/secrets"
ENV_FILE="$SECRETS/signing.env"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE (docs/signing.md)"
[ "$(stat -f '%Su %Lp' "$S")" = "$SIGN_USER 700" ] || die "$S must be $SIGN_USER's, mode 700"
[ "$(stat -f '%Su %Lp' "$SECRETS")" = "$SIGN_USER 700" ] || die "$SECRETS must be mode 700"
[ "$(stat -f '%Su %Lp' "$ENV_FILE")" = "$SIGN_USER 600" ] || die "$ENV_FILE must be mode 600"

# signing.env is read as KEY=VALUE lines (no shell), and only these keys are used.
CSC_NAME=
CSC_KEYCHAIN=
APPLE_KEYCHAIN=
APPLE_KEYCHAIN_PROFILE=
KEYCHAIN_PASSWORD=
while IFS= read -r line || [ -n "$line" ]; do
  case $line in '' | '#'*) continue ;; esac
  key=${line%%=*}
  value=${line#*=}
  value=${value#\"}
  value=${value%\"}
  case $key in
    CSC_NAME) CSC_NAME=$value ;;
    CSC_KEYCHAIN) CSC_KEYCHAIN=$value ;;
    APPLE_KEYCHAIN) APPLE_KEYCHAIN=$value ;;
    APPLE_KEYCHAIN_PROFILE) APPLE_KEYCHAIN_PROFILE=$value ;;
    MONSTERS_SIGNING_KEYCHAIN_PASSWORD) KEYCHAIN_PASSWORD=$value ;;
    *) die "unknown key in signing.env: $key" ;;
  esac
done <"$ENV_FILE"
[ -n "$CSC_NAME" ] && [ -n "$CSC_KEYCHAIN" ] && [ -n "$APPLE_KEYCHAIN_PROFILE" ] &&
  [ -n "$KEYCHAIN_PASSWORD" ] ||
  die "signing.env needs CSC_NAME, CSC_KEYCHAIN, APPLE_KEYCHAIN_PROFILE, MONSTERS_SIGNING_KEYCHAIN_PASSWORD"
[ -n "$APPLE_KEYCHAIN" ] || APPLE_KEYCHAIN=$CSC_KEYCHAIN
case $CSC_KEYCHAIN in "$S"/Library/Keychains/*.keychain-db) ;; *) die "CSC_KEYCHAIN not in $S/Library/Keychains" ;; esac
[ -f "$CSC_KEYCHAIN" ] || die "missing keychain $CSC_KEYCHAIN"

BUNDLE="$SHARED/inbox/$RUN.bundle"
OUTBOX="$SHARED/outbox"
[ -f "$BUNDLE" ] || die "missing $BUNDLE"
[ -d "$OUTBOX" ] && [ "$(stat -f '%Su' "$OUTBOX")" = "$SIGN_USER" ] || die "$OUTBOX must be $SIGN_USER's"

NODE_DIR="$S/node-v$NODE_VERSION-darwin-arm64"
CACHE="$S/cache.noindex"
REPO="$S/repo"
W="$S/work.noindex/$RUN"
LOCK="$S/run.lock"
OWN_LOCK=

cleanup() {
  trap '' TERM INT HUP PIPE
  # Always locked again, whatever happened in the packaging step.
  /usr/bin/security lock-keychain "$CSC_KEYCHAIN" >/dev/null 2>&1
  cd "$S" 2>/dev/null
  if [ -n "${W:-}" ] && [ -d "$W" ]; then
    git -C "$REPO" worktree remove --force "$W/src" >/dev/null 2>&1
    rm -rf "$W"
  fi
  git -C "$REPO" worktree prune >/dev/null 2>&1
  [ -n "$OWN_LOCK" ] && rm -rf "$LOCK"
  OWN_LOCK=
}
trap 'cleanup; exit 130' TERM INT HUP PIPE

if ! mkdir "$LOCK" 2>/dev/null; then
  holder=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "sign-build: busy (pid $holder)" >&2
    exit 75
  fi
  rm -rf "$LOCK"
  mkdir "$LOCK" || die "cannot take $LOCK"
fi
echo $$ >"$LOCK/pid"
OWN_LOCK=1
fail() {
  echo "sign-build: $*" >&2
  cleanup
  exit "${CODE:-2}"
}

# --- Node, the same official tarball as ci-mac.sh ------------------------------------------------

if [ "$("$NODE_DIR/bin/node" --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
  name="node-v$NODE_VERSION-darwin-arm64"
  dl="$CACHE/download"
  rm -rf "$dl" && mkdir -p "$dl" || fail "cannot create $dl"
  curl -fsSL --retry 3 -o "$dl/$name.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" ||
    fail "download of $name.tar.gz failed"
  actual=$(shasum -a 256 "$dl/$name.tar.gz" | awk '{ print $1 }')
  [ "$actual" = "$NODE_SHA256" ] || fail "checksum of $name.tar.gz is $actual, expected $NODE_SHA256"
  tar -xzf "$dl/$name.tar.gz" -C "$dl" || fail "cannot extract $name.tar.gz"
  rm -rf "$NODE_DIR" && mv "$dl/$name" "$NODE_DIR" || fail "cannot install $NODE_DIR"
  rm -rf "$dl"
fi
mkdir -p "$S/bin" "$CACHE" || fail "cannot create $S/bin"
# corepack is a `#!/usr/bin/env node` script: run it with our node, the PATH stays the safe one.
COREPACK_HOME="$CACHE/corepack" "$NODE_DIR/bin/node" "$NODE_DIR/bin/corepack" enable --install-directory "$S/bin" pnpm ||
  fail "corepack enable failed"

# --- a clean checkout of exactly <sha> ----------------------------------------------------------

[ -d "$REPO/.git" ] || git init -q "$REPO" || fail "cannot create $REPO"
git -C "$REPO" worktree prune
git -C "$REPO" -c transfer.fsckObjects=true fetch -q --no-tags "$BUNDLE" "+refs/ci-mac/run:refs/sign/run" ||
  fail "cannot fetch the commit from $BUNDLE"
got=$(git -C "$REPO" rev-parse --verify -q "refs/sign/run^{commit}")
[ "$got" = "$SHA" ] || fail "the bundle carries $got, not $SHA"
rm -rf "$W" && mkdir -p "$W/home/Library/Preferences" "$W/tmp" "$W/out" || fail "cannot create $W"
git -C "$REPO" -c core.hooksPath=/dev/null worktree add -q --detach "$W/src" "$SHA" ||
  fail "cannot check out $SHA"
[ "$(git -C "$W/src" rev-parse HEAD)" = "$SHA" ] || fail "checkout is not $SHA"
[ -z "$(git -C "$W/src" status --porcelain)" ] || fail "checkout of $SHA is not clean"
SUBJECT=$(git -C "$W/src" log -1 --format=%s "$SHA")
echo "sign-build: $SHA ($SUBJECT)"

# --- install and build: no secret, keychain locked ------------------------------------------------

/usr/bin/security lock-keychain "$CSC_KEYCHAIN" >/dev/null 2>&1
# A clean environment for the commit's code: no secret in it, ever.
run_clean() {
  /usr/bin/env -i HOME="$W/home" USER="$SIGN_USER" LOGNAME="$SIGN_USER" SHELL=/bin/bash \
    PATH="$S/bin:$NODE_DIR/bin:$SAFE_PATH" TMPDIR="$W/tmp/" LANG=en_US.UTF-8 \
    COREPACK_HOME="$CACHE/corepack" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 \
    pnpm_config_store_dir="$CACHE/pnpm-store" \
    electron_config_cache="$CACHE/electron" ELECTRON_BUILDER_CACHE="$CACHE/electron-builder" \
    "$@"
}
VERSION_ARGS=
[ -n "$VERSION" ] && VERSION_ARGS="--version $VERSION"
cd "$W/src" || fail "cannot enter $W/src"
CODE=1
run_clean pnpm install --frozen-lockfile --ignore-scripts </dev/null || fail "pnpm install failed"
# shellcheck disable=SC2086
run_clean nice -n 10 node apps/desktop/scripts/package.ts --mac $FEED_ARGS $VERSION_ARGS \
  --build-only </dev/null || fail "build failed"

# --- packaging: the keychain open for this step alone ---------------------------------------------

# The keychain's search list of the run's HOME: electron-builder finds the identity and the G2
# intermediate there (docs/signing.md).
HOME="$W/home" /usr/bin/security list-keychains -d user -s "$CSC_KEYCHAIN" /Library/Keychains/System.keychain ||
  fail "cannot set the keychain search list"
# The password is in argv for a moment (macOS ps shows it): the keychain file itself is in a home
# nobody else can read.
# codesign builds the chain (Developer ID -> G2 intermediate -> Apple Root) from the user's
# search list, not from --keychain: without the signing keychain in it the chain stops at the
# leaf ("unable to build chain to self-signed root", errSecInternalComponent).
/usr/bin/security list-keychains -d user -s "$CSC_KEYCHAIN" /Library/Keychains/System.keychain ||
  fail "cannot set the keychain search list"
/usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$CSC_KEYCHAIN" || fail "cannot unlock $CSC_KEYCHAIN"
KEYCHAIN_PASSWORD=
# shellcheck disable=SC2086
run_clean CSC_NAME="$CSC_NAME" CSC_KEYCHAIN="$CSC_KEYCHAIN" APPLE_KEYCHAIN="$APPLE_KEYCHAIN" \
  APPLE_KEYCHAIN_PROFILE="$APPLE_KEYCHAIN_PROFILE" CSC_IDENTITY_AUTO_DISCOVERY=false \
  nice -n 10 node apps/desktop/scripts/package.ts --mac $FEED_ARGS $VERSION_ARGS --no-build \
  --out "$W/out" </dev/null
pcode=$?
/usr/bin/security lock-keychain "$CSC_KEYCHAIN" >/dev/null 2>&1
[ "$pcode" = 0 ] || fail "packaging failed ($pcode)"
ls "$W/out"/*.dmg >/dev/null 2>&1 || fail "no dmg in the output"

# --- delivery -------------------------------------------------------------------------------------

# The last 3 deliveries are kept (monsters-ci copies them, it cannot remove them).
ls -1t "$OUTBOX" 2>/dev/null | tail -n +3 | while read -r old; do rm -rf "${OUTBOX:?}/$old"; done
rm -rf "${OUTBOX:?}/$RUN"
cp -R "$W/out" "$OUTBOX/$RUN" || fail "cannot deliver to $OUTBOX/$RUN"
chmod -R u+rwX,go+rX,go-w "$OUTBOX/$RUN"
{
  printf '%s %s %s%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SHA" "$RUN" "${VERSION:+ version $VERSION}"
  printf '  %s\n' "$SUBJECT"
  (cd "$W/out" && shasum -a 256 ./*.dmg ./*.zip 2>/dev/null | sed 's/^/  /')
} >>"$S/signed.log"
echo "sign-build: packages in $OUTBOX/$RUN"
cleanup
exit 0
