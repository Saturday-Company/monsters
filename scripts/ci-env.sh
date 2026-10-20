# Sourced by the CI scripts that reach machines of their own (ci-mac.sh, ci-windows.sh,
# apps/desktop/scripts/test-windows.sh): loads `scripts/ci.local.env`, a gitignored file of
# KEY=VALUE lines with the hosts, users, keys and folders of the maintainer's machines
# (docs/ci.md). It is read from this checkout or, from a git worktree, from the main checkout.
# Variables already set in the environment win; a leading `~/` in a value becomes $HOME/.
# Nothing in the file is executed: only `[export ]NAME=value` lines are read.

monsters_load_ci_env() {
  local dir=$1 file common line name value
  file="$dir/ci.local.env"
  if [[ ! -f $file ]]; then
    common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=
    [[ -n $common ]] && file="$(dirname "$common")/scripts/ci.local.env"
  fi
  [[ -f $file ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    name=${BASH_REMATCH[2]}
    value=${BASH_REMATCH[3]}
    value=${value%$'\r'}
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    [[ $value == "~/"* ]] && value="$HOME/${value#\~/}"
    [[ -n ${!name+x} ]] && continue
    export "$name=$value"
  done <"$file"
}
