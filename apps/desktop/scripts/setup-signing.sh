#!/usr/bin/env bash
# Tools for signing the Windows installer from Linux (M3.4, D-040, D-046): jsign and a Java
# runtime for it, installed under ~/.local/opt/monsters-signing (no sudo, nothing global), and
# the self-signed TEST certificate used by `MONSTERS_WIN_SIGN=test`.
#
#   bash apps/desktop/scripts/setup-signing.sh            jsign + Java (checksums pinned below)
#   bash apps/desktop/scripts/setup-signing.sh --test-cert also the test certificate in
#                                                          apps/desktop/.signing/ (gitignored)
#
# Environment: MONSTERS_SIGNING_TOOLS (default ~/.local/opt/monsters-signing).
#
# The test certificate is NOT trusted by Windows (`signtool verify /pa` fails, Get-Authenticode-
# Signature says UnknownError): it only proves that the signing chain works. The real one (Certum,
# D-040) is configured with the MONSTERS_JSIGN_* variables, see docs/signing.md.
set -euo pipefail

JSIGN_VERSION=7.5
# https://repo1.maven.org/maven2/net/jsign/jsign/7.5/jsign-7.5.jar: sha1 f71ce8b6… as published
# on Maven Central, PGP signature of Emmanuel Bourg (B8CE4DE21080DCF903E16C40F513C419E4B9D0AC)
# checked on 15/10/2026.
JSIGN_SHA256=602a51c3545a6dc4fb99bd2ea7152b26d1345916d0c93ddfbd5936cb735af91c
JRE_NAME=OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz
JRE_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/$JRE_NAME"
# The .sha256.txt of the release and the Adoptium API agree (15/10/2026).
JRE_SHA256=2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500

tools=${MONSTERS_SIGNING_TOOLS:-$HOME/.local/opt/monsters-signing}
app_dir=$(cd "$(dirname "$0")/.." && pwd)
want_cert=0
for arg in "$@"; do
  case $arg in
    --test-cert) want_cert=1 ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "setup-signing: unknown argument $arg" >&2; exit 2 ;;
  esac
done

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || {
  echo "setup-signing: only Linux x64 is supported (the signing runs on the PC, D-040)" >&2
  exit 2
}

check() { # file sha256
  local got
  got=$(sha256sum "$1" | cut -d' ' -f1)
  [[ $got == "$2" ]] || { echo "setup-signing: checksum of $(basename "$1") is $got, expected $2" >&2; exit 1; }
}

mkdir -p "$tools"
tmp=$(mktemp -d "$tools/.download.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

jar="$tools/jsign-$JSIGN_VERSION.jar"
if [[ -f $jar ]] && [[ $(sha256sum "$jar" | cut -d' ' -f1) == "$JSIGN_SHA256" ]]; then
  echo "jsign $JSIGN_VERSION: already in $jar"
else
  curl -fsSL --retry 3 -o "$tmp/jsign.jar" \
    "https://repo1.maven.org/maven2/net/jsign/jsign/$JSIGN_VERSION/jsign-$JSIGN_VERSION.jar"
  check "$tmp/jsign.jar" "$JSIGN_SHA256"
  mv "$tmp/jsign.jar" "$jar"
  echo "jsign $JSIGN_VERSION: installed in $jar"
fi

if [[ -x $tools/jre/bin/java ]] && [[ $(cat "$tools/jre/.sha256" 2>/dev/null) == "$JRE_SHA256" ]]; then
  echo "Java: already in $tools/jre"
else
  curl -fsSL --retry 3 -o "$tmp/$JRE_NAME" "$JRE_URL"
  check "$tmp/$JRE_NAME" "$JRE_SHA256"
  mkdir "$tmp/jre"
  tar -xzf "$tmp/$JRE_NAME" -C "$tmp/jre" --strip-components=1
  echo "$JRE_SHA256" >"$tmp/jre/.sha256"
  rm -rf "$tools/jre"
  mv "$tmp/jre" "$tools/jre"
  echo "Java: installed in $tools/jre ($("$tools/jre/bin/java" -version 2>&1 | head -1))"
fi

if ((want_cert)); then
  dir="$app_dir/.signing"
  if [[ -f $dir/test.p12 && -f $dir/test-ca.crt ]]; then
    echo "test certificate: already in $dir/test.p12"
  else
    rm -rf "$dir"
    mkdir -p "$dir"
    chmod 700 "$dir"
    # A test CA and a code signing certificate issued by it, like a real chain: Windows trusts
    # the signature once test-ca.crt is among its roots (only inside the test VM).
    openssl rand -hex 24 >"$dir/test.pass"
    openssl req -x509 -newkey rsa:3072 -sha256 -days 730 -nodes \
      -subj "/CN=Monsters Test CA (NON FIDATA)/O=Saturday Company (test)" \
      -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
      -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -keyout "$dir/test-ca.key" -out "$dir/test-ca.crt" 2>/dev/null
    openssl req -newkey rsa:3072 -sha256 -nodes \
      -subj "/CN=Monsters Test Signing (NON FIDATO)/O=Saturday Company (test)" \
      -keyout "$dir/test-signer.key" -out "$dir/test-signer.csr" 2>/dev/null
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n' \
      >"$dir/signer.ext"
    openssl x509 -req -sha256 -days 730 -in "$dir/test-signer.csr" -CA "$dir/test-ca.crt" \
      -CAkey "$dir/test-ca.key" -CAcreateserial -extfile "$dir/signer.ext" \
      -out "$dir/test-signer.crt" 2>/dev/null
    openssl pkcs12 -export -inkey "$dir/test-signer.key" -in "$dir/test-signer.crt" \
      -certfile "$dir/test-ca.crt" -name monsters-test -passout "file:$dir/test.pass" -out "$dir/test.p12"
    rm -f "$dir/test-ca.key" "$dir/test-signer.key" "$dir/test-signer.csr" "$dir/signer.ext" "$dir"/*.srl
    chmod 600 "$dir"/*
    echo "test certificate: $dir/test.p12 (CN=Monsters Test Signing (NON FIDATO), issued by test-ca.crt, 2 years)"
  fi
fi
