# shellcheck shell=bash
# Activate ~/.opam/bar2psi-reason when the current env cannot build Reason targets.

REASON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

reason_dune_and_refmt_on_path() {
  command -v dune >/dev/null || return 1
  command -v refmt >/dev/null || return 1
}

reason_native_buildable() {
  reason_dune_and_refmt_on_path || return 1
  (cd "$REASON_ROOT" && dune rules native/bar2psi.exe >/dev/null 2>&1)
}

reason_melange_buildable() {
  reason_dune_and_refmt_on_path || return 1
  (cd "$REASON_ROOT" && dune rules @melange >/dev/null 2>&1)
}

# ensure_reason_opam [melange]
# With no args: current env (or bar2psi-reason) must build native.
# With melange: must also build @melange; switch even if native already works.
ensure_reason_opam() {
  local need_melange=0
  if [ "${1:-}" = melange ]; then
    need_melange=1
  fi

  if reason_native_buildable; then
    if [ "$need_melange" = 0 ] || reason_melange_buildable; then
      return 0
    fi
  fi

  if [ -d "${HOME}/.opam/bar2psi-reason" ]; then
    eval "$(opam env --switch=bar2psi-reason)"
    reason_native_buildable || return 1
    if [ "$need_melange" = 1 ]; then
      reason_melange_buildable
    else
      return 0
    fi
  else
    return 1
  fi
}
