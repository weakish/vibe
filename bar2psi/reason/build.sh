#!/usr/bin/env bash
# Build native (ocamlopt) and/or Deno-compiled Melange JS binaries.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# shellcheck source=ensure-opam.sh
source "$ROOT/ensure-opam.sh"

# When BAR2PSI_REASON_FROM_ALL=1 (build-all.sh), missing tools are skips.
die_or_skip() {
  if [ "${BAR2PSI_REASON_FROM_ALL:-}" = 1 ]; then
    echo "skip reason: $*" >&2
  else
    echo "$*" >&2
  fi
}

build_native() {
  if ! ensure_reason_opam; then
    die_or_skip "dune/refmt not available (opam switch bar2psi-reason + opam install . --deps-only)"
    return 1
  fi
  dune build --profile release_small native/bar2psi.exe
  cp -f _build/default/native/bar2psi.exe ./bar2psi
  chmod u+w ./bar2psi
  strip ./bar2psi 2>/dev/null || true
}

build_js() {
  if ! ensure_reason_opam melange; then
    die_or_skip "dune/refmt/melange not available (opam switch bar2psi-reason + opam install . --deps-only)"
    return 1
  fi
  if ! command -v deno >/dev/null; then
    die_or_skip "deno not in PATH"
    return 1
  fi
  dune build @melange
  (
    cd _build/default/dist
    # Melange typechecks Reason; deno check validates the emitted .mjs.
    deno check --node-modules-dir=manual Bar2psi_js.mjs
    deno compile --no-check --node-modules-dir=manual --output "$ROOT/bar2psi-js" Bar2psi_js.mjs
  )
}

case "${1:-all}" in
  native)
    build_native
    ;;
  js)
    build_js
    ;;
  all)
    build_native
    if command -v deno >/dev/null; then
      build_js
    else
      echo "skip js: deno not in PATH" >&2
    fi
    ;;
  *)
    echo "usage: $0 [native|js|all]" >&2
    exit 1
    ;;
esac
