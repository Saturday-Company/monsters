#!/bin/bash
# One-shot setup of the signing user `monsters-sign` on the Mac: steps 1, 2, 3, 4 and 7 of
# docs/signing.md, section "Mac: utente di firma". Run it ONCE, from a Terminal on the
# Mac, with sign-build.sh in the same folder, the signing identity and the App Store Connect key id:
#
#   sudo MONSTERS_MAC_SIGN_IDENTITY='Developer ID Application: Jane Doe (ABCDE12345)' \
#     MONSTERS_MAC_NOTARY_KEY_ID=XYZ123ABCD bash setup-monsters-sign.sh
#
# Left to do by hand: step 5 (App Store Connect key with the Developer role). Step 6 (first signed
# build) is started from the PC.
#
# Idempotent: what already exists (user, folders, sudoers rule, keychain) is checked and kept. The
# only destructive part is step 7, after an explicit confirmation and only if the proofs of step 4
# passed.
#
# Secrets: no password is written to a temporary file or to a log, and none is exported to the
# environment of a child. They travel through shell builtins (printf, read) and stdin pipes.
# Where a tool insists on a password in its arguments (sysadminctl -password, security
# create-keychain -p, security import -P, set-key-partition-list -k, unlock-keychain -p), the
# password is visible in `ps` for the instant the command runs: unavoidable with these tools, on a
# Mac used by its owner alone.
# macOS /bin/bash is 3.2: nothing newer than that is used here.
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

SIGN_USER=monsters-sign
CI_USER=monsters-ci
SHARED=/Users/Shared/monsters-sign
LIBEXEC=/usr/local/libexec/monsters
SIGNER=$LIBEXEC/sign-build.sh
SUDOERS=/etc/sudoers.d/monsters-sign
RULE="$CI_USER ALL=($SIGN_USER) NOPASSWD: $SIGNER"
KEYCHAIN_NAME=monsters-signing.keychain-db
IDENTITY=${MONSTERS_MAC_SIGN_IDENTITY:?set MONSTERS_MAC_SIGN_IDENTITY ('Developer ID Application: Name (TEAMID)')}
KEY_ID=${MONSTERS_MAC_NOTARY_KEY_ID:?set MONSTERS_MAC_NOTARY_KEY_ID (the App Store Connect API key id)}
P12=developer-id.p12
P8=AuthKey_$KEY_ID.p8
G2=devid-g2-ca.pem
G2_URL=https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
# No known sha256 of DeveloperIDG2CA.cer in the repo: it is printed for the owner, with subject and issuer.

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
confirm() { # confirm "question" -> 0 only for y/Y
  local a=
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r a </dev/tty || true
  case $a in y | Y) return 0 ;; *) return 1 ;; esac
}
as_sign() { sudo -u "$SIGN_USER" -H "$@"; }

[ "$(uname -s)" = Darwin ] || die "this script is for macOS"
[ "$(id -u)" = 0 ] || die "run it as root: sudo bash $0"
[ -r /dev/tty ] || die "a Terminal is needed (questions are asked on /dev/tty)"
[ -f "$HERE/sign-build.sh" ] || die "sign-build.sh must be in the same folder as this script ($HERE)"

CI_HOME=$(dscl . -read "/Users/$CI_USER" NFSHomeDirectory 2>/dev/null | awk '{ print $2 }')
[ -n "$CI_HOME" ] && [ -d "$CI_HOME" ] || die "user $CI_USER not found"
CI_SECRETS=$CI_HOME/monsters-ci/secrets

NEW_PASSWORD=

# --- step 1: the user ------------------------------------------------------------------------

say "1. User $SIGN_USER"
if dscl . -read "/Users/$SIGN_USER" UniqueID >/dev/null 2>&1; then
  note "already exists: checked, not touched"
else
  NEW_PASSWORD=$(openssl rand -hex 24)
  note "creating it (not an administrator)"
  sysadminctl -addUser "$SIGN_USER" -fullName "Monsters firma" -password "$NEW_PASSWORD" >/dev/null 2>&1 ||
    die "sysadminctl -addUser failed"
fi
SIGN_HOME=$(dscl . -read "/Users/$SIGN_USER" NFSHomeDirectory | awk '{ print $2 }')
[ "$SIGN_HOME" = "/Users/$SIGN_USER" ] || die "unexpected home for $SIGN_USER: $SIGN_HOME"
[ -d "$SIGN_HOME" ] || createhomedir -c -u "$SIGN_USER" >/dev/null 2>&1 || true
[ -d "$SIGN_HOME" ] || die "no home directory $SIGN_HOME"
if dseditgroup -o checkmember -m "$SIGN_USER" admin 2>/dev/null | grep -q '^yes'; then
  die "$SIGN_USER is an administrator: remove it from the admin group and start again"
fi
chown "$SIGN_USER":staff "$SIGN_HOME"
chmod 700 "$SIGN_HOME"
# The user's own folders first (it must be able to write its keychain), then LaunchAgents of root.
as_sign mkdir -p -m 700 "$SIGN_HOME/Library" "$SIGN_HOME/Library/Keychains"
mkdir -p "$SIGN_HOME/Library/LaunchAgents"
chown root:wheel "$SIGN_HOME/Library/LaunchAgents"
chmod 755 "$SIGN_HOME/Library/LaunchAgents"
if crontab -u "$SIGN_USER" -l >/dev/null 2>&1; then
  die "$SIGN_USER has a crontab (sudo crontab -u $SIGN_USER -l): look at it, remove it with 'sudo crontab -u $SIGN_USER -r' and start again"
fi
note "home 700, Library/LaunchAgents root:wheel 755, no crontab"

# --- step 2: shared folders ----------------------------------------------------------------

say "2. Shared folders"
mkdir -p "$SHARED/inbox" "$SHARED/outbox"
chown root:wheel "$SHARED" && chmod 755 "$SHARED"
chown "$CI_USER":staff "$SHARED/inbox" && chmod 755 "$SHARED/inbox"
chown "$SIGN_USER":staff "$SHARED/outbox" && chmod 755 "$SHARED/outbox"
note "$SHARED root:wheel 755; inbox $CI_USER:staff 755; outbox $SIGN_USER:staff 755"

# --- step 3: fixed script and sudoers ---------------------------------------------------------

say "3. sign-build.sh and sudoers"
SRC_SHA=$(shasum -a 256 "$HERE/sign-build.sh" | awk '{ print $1 }')
INST_SHA=
[ -f "$SIGNER" ] && INST_SHA=$(shasum -a 256 "$SIGNER" | awk '{ print $1 }')
if [ "$SRC_SHA" = "$INST_SHA" ]; then
  note "$SIGNER is already installed and identical (sha256 $SRC_SHA)"
else
  note "sha256 of $HERE/sign-build.sh:"
  note "  $SRC_SHA"
  note "(this is the script that will run with the signing secrets: read it first if you have not)"
  confirm "Install it as $SIGNER?" || die "not installed: stopped"
  mkdir -p "$LIBEXEC"
  # umask 077 would leave /usr/local/libexec 700: monsters-ci could not reach the signer.
  chown root:wheel "$(dirname "$LIBEXEC")" "$LIBEXEC" && chmod 755 "$(dirname "$LIBEXEC")" "$LIBEXEC"
  install -o root -g wheel -m 755 "$HERE/sign-build.sh" "$SIGNER"
  note "installed"
fi
chmod 755 "$(dirname "$LIBEXEC")" "$LIBEXEC"
if [ -f "$SUDOERS" ] && [ "$(cat "$SUDOERS")" = "$RULE" ]; then
  note "$SUDOERS is already right"
else
  WORK=$(mktemp -d)
  printf '%s\n' "$RULE" >"$WORK/rule"
  visudo -cf "$WORK/rule" >/dev/null || die "the sudoers rule does not pass visudo: nothing installed"
  install -o root -g wheel -m 440 "$WORK/rule" "$SUDOERS"
  rm -rf "$WORK"; WORK=
fi
if ! visudo -c >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  die "visudo -c failed: $SUDOERS removed, stopped"
fi
note "sudoers ok (visudo -c)"

# --- step 4: secrets into monsters-sign's keychain ---------------------------------------------

say "4. Secrets into the keychain of $SIGN_USER"
KC=$SIGN_HOME/Library/Keychains/$KEYCHAIN_NAME
PROOFS=no
have_identity() {
  as_sign /usr/bin/security find-identity -p codesigning "$KC" 2>/dev/null | grep -qF "$IDENTITY"
}

if [ -f "$KC" ]; then
  have_identity || die "$KC exists but has no '$IDENTITY': delete it by hand (sudo rm $KC) and start again"
  as_sign test -f "$SIGN_HOME/secrets/signing.env" ||
    die "$KC exists but $SIGN_HOME/secrets/signing.env does not (its password is lost): delete the keychain and start again"
  note "keychain and signing.env already there: step 4 not repeated"
  as_sign /usr/bin/security list-keychains -d user -s "$KC" /Library/Keychains/System.keychain
  note "search list of $SIGN_USER: its signing keychain, then the System keychain"
  note "(the export proof needs the keychain password: it is not repeated, it passed the first time)"
  PROOFS=ok
else
  [ -d "$CI_SECRETS" ] || die "no $CI_SECRETS and no keychain: the secrets are not on this Mac"
  for f in "$P12" "$P8"; do [ -f "$CI_SECRETS/$f" ] || die "missing $CI_SECRETS/$f"; done
  [ -f "$CI_SECRETS/signing.env" ] || note "no $CI_SECRETS/signing.env: the two values will be asked"

  # signing.env is read line by line as KEY=VALUE, never executed.
  CSC_KEY_PASSWORD=; APPLE_API_ISSUER=
  if [ -f "$CI_SECRETS/signing.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case $line in '' | '#'*) continue ;; esac
      k=${line%%=*}; v=${line#*=}
      v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
      case $k in
        CSC_KEY_PASSWORD) CSC_KEY_PASSWORD=$v ;;
        APPLE_API_ISSUER) APPLE_API_ISSUER=$v ;;
      esac
    done <"$CI_SECRETS/signing.env"
  fi
  if [ -z "$CSC_KEY_PASSWORD" ]; then
    printf 'Password of developer-id.p12 (not shown): ' >/dev/tty
    read -rs CSC_KEY_PASSWORD </dev/tty; printf '\n' >/dev/tty
  fi
  if [ -z "$APPLE_API_ISSUER" ]; then
    printf 'Issuer ID of App Store Connect (not shown): ' >/dev/tty
    read -rs APPLE_API_ISSUER </dev/tty; printf '\n' >/dev/tty
  fi
  [ -n "$CSC_KEY_PASSWORD" ] && [ -n "$APPLE_API_ISSUER" ] || die "p12 password and issuer id are both needed"

  # Folders of the user, then the files copied in by root (mode 600, owner monsters-sign).
  as_sign /bin/bash -c 'umask 077; mkdir -p -m 700 "$HOME/secrets" "$HOME/import"'
  IMPORT=$SIGN_HOME/import
  for f in "$P12" "$P8"; do
    install -o "$SIGN_USER" -g staff -m 600 "$CI_SECRETS/$f" "$IMPORT/$f"
  done
  if [ -f "$CI_SECRETS/$G2" ]; then
    install -o "$SIGN_USER" -g staff -m 600 "$CI_SECRETS/$G2" "$IMPORT/$G2"
  else
    note "no $G2: downloading the G2 intermediate from Apple"
    WORK=$(mktemp -d)
    curl -fsSL --retry 3 -o "$WORK/g2.cer" "$G2_URL" || die "download of $G2_URL failed"
    openssl x509 -inform der -in "$WORK/g2.cer" -out "$WORK/g2.pem" || die "the downloaded file is not a certificate"
    subj=$(openssl x509 -in "$WORK/g2.pem" -noout -subject)
    iss=$(openssl x509 -in "$WORK/g2.pem" -noout -issuer)
    case $subj in *"Developer ID Certification Authority"*) ;; *) die "unexpected certificate: $subj" ;; esac
    case $iss in *"Apple Root CA"*) ;; *) die "unexpected issuer: $iss" ;; esac
    note "sha256 of the .cer (no known value in the repo, check it if you want): $(shasum -a 256 "$WORK/g2.cer" | awk '{ print $1 }')"
    note "$subj"
    note "$iss"
    install -o "$SIGN_USER" -g staff -m 600 "$WORK/g2.pem" "$IMPORT/$G2"
    rm -rf "$WORK"; WORK=
  fi

  # Everything below runs as monsters-sign. Secrets arrive on stdin (3 lines: p12 password, issuer id,
  # then nothing else); the keychain password is generated there and never leaves it, except into
  # ~/secrets/signing.env (600), where sign-build.sh reads it.
  # shellcheck disable=SC2016
  INNER='
set -euo pipefail
umask 077
KC="$HOME/Library/Keychains/'"$KEYCHAIN_NAME"'"
IMPORT="$HOME/import"
IFS= read -r P12PW
IFS= read -r ISSUER
KCPW=$(/usr/bin/openssl rand -hex 32)
/usr/bin/security create-keychain -p "$KCPW" "$KC"
# codesign builds the chain from the search list: the signing keychain must be in it.
/usr/bin/security list-keychains -d user -s "$KC" /Library/Keychains/System.keychain
/usr/bin/security set-keychain-settings -lut 900 "$KC"
/usr/bin/security unlock-keychain -p "$KCPW" "$KC"
/usr/bin/security import "$IMPORT/'"$P12"'" -k "$KC" -f pkcs12 -P "$P12PW" -x -T /usr/bin/codesign >/dev/null
/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k "$KCPW" "$KC" >/dev/null
# The .p12 may already carry the G2 intermediate: import it only when it is not there yet.
if /usr/bin/security find-certificate -c "Developer ID Certification Authority" "$KC" >/dev/null 2>&1; then
  echo "G2 intermediate already in the keychain (it came with the .p12)"
else
  /usr/bin/security import "$IMPORT/'"$G2"'" -k "$KC" >/dev/null
fi
/usr/bin/xcrun notarytool store-credentials monsters-notary --key "$IMPORT/'"$P8"'" --key-id '"$KEY_ID"' --issuer "$ISSUER" --keychain "$KC"
printf "%s\n" "CSC_NAME='"$IDENTITY"'" "CSC_KEYCHAIN=$KC" "APPLE_KEYCHAIN_PROFILE=monsters-notary" "MONSTERS_SIGNING_KEYCHAIN_PASSWORD=$KCPW" >"$HOME/secrets/signing.env"
chmod 600 "$HOME/secrets/signing.env"
echo "-- proofs"
/usr/bin/security unlock-keychain -p "$KCPW" "$KC"
# The identity is in the keychain (without -v: the trust check of find-identity -v often fails for
# another user under sudo, while codesign signs fine).
if ! /usr/bin/security find-identity -p codesigning "$KC" | grep -qF "'"$IDENTITY"'"; then
  echo "PROOF FAILED: identity not found. What the keychain has:"
  /usr/bin/security find-identity -p codesigning "$KC" || true
  exit 3
fi
# The real proof: sign a small file with it, as the build will, and verify the signature.
T=$(mktemp -d "$HOME/sigtest.XXXXXX")
cp /usr/bin/true "$T/probe"
if ! /usr/bin/codesign --force --sign "'"$IDENTITY"'" --keychain "$KC" --timestamp=none "$T/probe" 2>"$T/err"; then
  echo "PROOF FAILED: codesign cannot sign with the identity:"; cat "$T/err"
  echo "Identities (with the trust check):"; /usr/bin/security find-identity -v -p codesigning "$KC" || true
  rm -rf "$T"; exit 5
fi
/usr/bin/codesign --verify --strict "$T/probe" || { echo "PROOF FAILED: the test signature does not verify"; rm -rf "$T"; exit 6; }
/usr/bin/codesign -dvv "$T/probe" 2>&1 | grep -E "^Authority=" | head -3
rm -rf "$T"
echo "codesign signs and verifies with the identity"
echo "Now a try to EXPORT the private key, which must fail. If macOS asks for the password of the keychain"
echo "\"monsters-signing\" (random, you do not know it): press Rifiuta / Deny."
EXP=$(mktemp -d "$HOME/exp.XXXXXX")
if /usr/bin/security export -k "$KC" -t identities -f pkcs12 -P probe -o "$EXP/x.p12" >/dev/null 2>&1 && [ -s "$EXP/x.p12" ]; then
  rm -P "$EXP/x.p12"; rmdir "$EXP"
  echo "PROOF FAILED: the private key was EXPORTED"; exit 4
fi
rm -rf "$EXP"
echo "export of the key fails, as it must"
/usr/bin/security lock-keychain "$KC"
'
  rc=0
  printf '%s\n%s\n' "$CSC_KEY_PASSWORD" "$APPLE_API_ISSUER" |
    as_sign /bin/bash -c "$INNER" || rc=$?
  CSC_KEY_PASSWORD=; APPLE_API_ISSUER=
  if [ "$rc" = 0 ]; then
    PROOFS=ok
    note "proofs passed: identity found, codesign signs with it, export fails"
  else
    note "step 4 FAILED (exit $rc): the secrets of $CI_USER are untouched, step 7 is skipped."
    note "To retry after fixing: sudo rm $KC $SIGN_HOME/secrets/signing.env, then run the script again."
  fi
  # The copies in the import folder go away in any case (rm -P, then the folder).
  as_sign /bin/bash -c 'for f in "$HOME"/import/*; do [ -f "$f" ] && rm -P "$f"; done; rmdir "$HOME/import" 2>/dev/null; true'
  [ "$rc" = 0 ] || exit 1
fi

# --- the G2 intermediate in the System keychain ---------------------------------------------------
# codesign, run as monsters-sign over SSH, builds the chain from the search list: the public G2
# intermediate of Apple in the System keychain is found by every user (no secret in it).
say "G2 intermediate in the System keychain"
# Always the G2 file itself: a name match could find the older G1 intermediate, same name.
WORK=$(mktemp -d)
curl -fsSL --retry 3 -o "$WORK/g2.cer" "$G2_URL" || die "download of $G2_URL failed"
if out=$(security add-certificates -k /Library/Keychains/System.keychain "$WORK/g2.cer" 2>&1); then
  note "added"
elif printf '%s' "$out" | grep -qi "already exists"; then
  note "already there"
else
  die "cannot add the G2 intermediate: $out"
fi
rm -rf "$WORK"; WORK=

# --- step 7: cleanup of monsters-ci -----------------------------------------------------------

say "7. Clean up $CI_USER"
if [ "$PROOFS" != ok ]; then
  note "proofs of step 4 not passed: nothing is deleted"
else
  CA_KC=$CI_HOME/Library/Keychains/monsters-ca.keychain-db
  if [ -d "$CI_SECRETS" ] || [ -e "$CA_KC" ]; then
    note "will be deleted: $CI_SECRETS (rm -P -r) and $CA_KC"
    note "Make sure the .p12, its password and the .p8 are in your password manager."
    if confirm "Delete them now?"; then
      [ ! -d "$CI_SECRETS" ] || rm -P -r "$CI_SECRETS"
      rm -f "$CA_KC"
      sudo -u "$CI_USER" -H /usr/bin/security list-keychains -d user -s /Library/Keychains/System.keychain >/dev/null
      note "deleted; search list of $CI_USER reset to the System keychain"
    else
      note "NOT deleted: do it soon (docs/signing.md, step 7)"
    fi
  else
    note "already clean"
  fi
  say "Checks"
  if sudo -u "$CI_USER" ls "$CI_SECRETS" >/dev/null 2>&1; then
    note "FAIL: $CI_USER still sees $CI_SECRETS"
  else
    note "ok: $CI_USER finds no secrets"
  fi
  if sudo -u "$CI_USER" ls "$SIGN_HOME" >/dev/null 2>&1; then
    note "FAIL: $CI_USER can read $SIGN_HOME"
  else
    note "ok: $CI_USER gets Permission denied on $SIGN_HOME"
  fi
  [ "$(stat -f '%Su:%Lp' "$SIGN_HOME")" = "$SIGN_USER:700" ] && note "ok: home 700" || note "FAIL: home is not 700"
  [ "$(stat -f '%Su:%Sg:%Lp' "$SIGN_HOME/Library/LaunchAgents")" = "root:wheel:755" ] && note "ok: LaunchAgents root:wheel 755" || note "FAIL: LaunchAgents"
  [ "$(stat -f '%Su:%Sg:%Lp' "$SHARED/inbox")" = "$CI_USER:staff:755" ] && [ "$(stat -f '%Su:%Sg:%Lp' "$SHARED/outbox")" = "$SIGN_USER:staff:755" ] &&
    note "ok: inbox/outbox" || note "FAIL: inbox/outbox"
fi

# --- what is left -------------------------------------------------------------------------------

say "Remote login (SSH)"
if ! dseditgroup -o read com.apple.access_ssh >/dev/null 2>&1; then
  note "NOTE: no group com.apple.access_ssh: every user may log in over SSH."
  note "Settings > General > Sharing > Remote Login > Allow access for 'Only these users' without $SIGN_USER."
elif dseditgroup -o checkmember -m "$SIGN_USER" com.apple.access_ssh 2>/dev/null | grep -q '^yes'; then
  note "ATTENTION: $SIGN_USER IS among the Remote Login users: remove it (Settings > General > Sharing > Remote Login)."
else
  note "ok: $SIGN_USER is not among the Remote Login 'Only these users'"
fi

say "What is left"
if [ -n "$NEW_PASSWORD" ]; then
  printf '\n   PASSWORD of %s (shown once: put it in your password manager now):\n\n   %s\n\n' "$SIGN_USER" "$NEW_PASSWORD" >/dev/tty
  NEW_PASSWORD=
else
  note "$SIGN_USER already existed: its password was not touched"
fi
note "- Save in the password manager: encrypted copy of the .p12, its password, the .p8 (only to rebuild the keychain)."
note "- Step 5 (you): appstoreconnect.apple.com > Users and Access > Integrations > Team Keys: $KEY_ID with"
note "  access Developer, the only active key, none with Admin or App Manager."
note "- Step 6 (Claude, from the PC): first signed build, pnpm desktop:dist:mac."
