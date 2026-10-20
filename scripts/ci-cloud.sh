#!/usr/bin/env bash
# Cloud CI (CircleCI, GitLab.com): the checks of .github/workflows/ci.yml on a hosted runner,
# run through `scripts/ci-local.ts`, so the step list per OS lives in one place and the result
# has the same format as the local CI (`ci-results/<stamp>-<commit>-<os>.json` + `.log`, kept
# as job artifacts). Never started by a push: see .circleci/config.yml, .gitlab-ci.yml and
# docs/ci.md.
#
#   bash scripts/ci-cloud.sh setup   Node 24 (official build, checksum verified) if the runner has
#                                    no Node 24, pnpm of `packageManager`, and on Linux the system
#                                    libraries of Playwright's Chromium (via sudo when not root)
#   bash scripts/ci-cloud.sh run     `node scripts/ci-local.ts --no-package` on the checked-out
#                                    commit (extra arguments are passed on)
#
# The package step (D-048) is skipped: it needs sudo + chroot (Linux), signing material (macOS)
# or the local VM (Windows), and costs minutes for little extra signal in the cloud.
#
# Environment:
#   CLOUD_CI_NODE_DIR    where Node 24 and pnpm go (default ~/.monsters-ci-node)
#   CLOUD_CI_PNPM_STORE  pnpm store, the folder the CI caches (default ~/.pnpm-store)
#   CLOUD_CI_NO_DEPS=1   setup skips the system libraries (to try the script on a dev machine)
# Works in bash on Linux, macOS and Windows (Git Bash).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$(uname -s)" in
  Linux*) os=linux ;;
  Darwin*) os=darwin ;;
  MINGW* | MSYS* | CYGWIN*) os=win ;;
  *) echo "ci-cloud: unsupported system $(uname -s)" >&2; exit 2 ;;
esac

NODE_DIR=${CLOUD_CI_NODE_DIR:-$HOME/.monsters-ci-node}
STORE=${CLOUD_CI_PNPM_STORE:-$HOME/.pnpm-store}
NODE_DIST=https://nodejs.org/dist/latest-v24.x

# Folder with the node/npm/pnpm executables of NODE_DIR (Windows zips have no bin/).
bin_dir() { if [[ $os == win ]]; then echo "$NODE_DIR"; else echo "$NODE_DIR/bin"; fi; }
# A path as native programs (node.exe, pnpm) expect it.
native() { if [[ $os == win ]]; then cygpath -w "$1"; else echo "$1"; fi; }
use_node_dir() { if [[ -d $(bin_dir) ]]; then export PATH="$(bin_dir):$PATH"; fi; }
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

sha256_check() {
  if command -v sha256sum >/dev/null; then sha256sum -c -; else shasum -a 256 -c -; fi
}

install_node() {
  local plat ext tmp file
  case "$os-$(uname -m)" in
    linux-x86_64) plat=linux-x64 ext=tar.xz ;;
    linux-aarch64) plat=linux-arm64 ext=tar.xz ;;
    darwin-arm64) plat=darwin-arm64 ext=tar.gz ;;
    darwin-x86_64) plat=darwin-x64 ext=tar.gz ;;
    win-*) plat=win-x64 ext=zip ;;
    *) echo "ci-cloud: no Node build for $os $(uname -m)" >&2; exit 2 ;;
  esac
  tmp=$(mktemp -d)
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "$NODE_DIST/SHASUMS256.txt"
  file=$(awk -v re="^node-v24[.][0-9]+[.][0-9]+-$plat[.]$ext\$" '$2 ~ re { print $2; exit }' \
    "$tmp/SHASUMS256.txt")
  if [[ -z $file ]]; then
    echo "ci-cloud: node $plat.$ext not listed in $NODE_DIST/SHASUMS256.txt" >&2
    exit 2
  fi
  echo "ci-cloud: downloading $file"
  curl -fsSL --retry 3 -o "$tmp/$file" "$NODE_DIST/$file"
  (cd "$tmp" && grep "  $file\$" SHASUMS256.txt | sha256_check)
  case $ext in
    tar.xz) tar -xJf "$tmp/$file" -C "$tmp" ;;
    tar.gz) tar -xzf "$tmp/$file" -C "$tmp" ;;
    zip)
      if command -v unzip >/dev/null; then
        unzip -q "$tmp/$file" -d "$tmp"
      else
        powershell.exe -NoProfile -Command \
          "Expand-Archive -LiteralPath '$(native "$tmp/$file")' -DestinationPath '$(native "$tmp")'"
      fi
      ;;
  esac
  rm -rf "$NODE_DIR"
  mkdir -p "$(dirname "$NODE_DIR")"
  mv "$tmp/${file%."$ext"}" "$NODE_DIR"
  rm -rf "$tmp"
}

setup() {
  use_node_dir
  if [[ $(node_major) != 24 ]]; then
    install_node
    use_node_dir
  fi
  local want
  want=$(node -p 'require("./package.json").packageManager.split("@")[1]')
  # pnpm goes next to our Node (or alone in NODE_DIR when the runner's Node 24 is used): no
  # global prefix of the image is touched, and `run` finds it the same way.
  if [[ $(pnpm --version 2>/dev/null || true) != "$want" ]]; then
    # --allow-scripts: pnpm's install script links its native binary (and the Windows shims).
    npm install --global --no-fund --no-audit --allow-scripts=pnpm --prefix "$(native "$NODE_DIR")" "pnpm@$want"
    use_node_dir
  fi
  echo "ci-cloud: node $(node --version), pnpm $(pnpm --version)"

  if [[ $os == linux && ${CLOUD_CI_NO_DEPS:-} != 1 ]]; then
    # System libraries of Chromium (the browsers themselves are downloaded by the
    # playwright-browsers step of ci-local). Playwright calls sudo itself when not root.
    local pw
    pw=$(node -p 'require("./apps/web/package.json").devDependencies["@playwright/test"]')
    npx --yes "playwright@$pw" install-deps chromium
  fi
}

run() {
  use_node_dir
  if [[ $(node_major) != 24 ]]; then
    echo "ci-cloud: Node 24 not found, run 'bash scripts/ci-cloud.sh setup' first" >&2
    exit 2
  fi
  # ci-local drops npm_* and MONSTERS_* from the steps' environment, not pnpm_config_*.
  pnpm_config_store_dir=$(native "$STORE")
  export pnpm_config_store_dir
  # No cloud step runs Electron (the package step is skipped): no 100 MB binary per run.
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  # Typed lint needs ~2.1 GB of heap: Node's default limit on these runners is lower (first
  # CircleCI run, 15/10/2026: "JavaScript heap out of memory"); same value as ci-windows.sh.
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=4096"
  exec node scripts/ci-local.ts --no-package "$@"
}

cmd=${1:-}
shift || true
case $cmd in
  setup) setup ;;
  run) run "$@" ;;
  *) echo "usage: bash scripts/ci-cloud.sh setup | run [ci-local arguments]" >&2; exit 2 ;;
esac
