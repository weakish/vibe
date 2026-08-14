#!/usr/bin/env bash
# Build Melange web JS into site/js for the static article + calculator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REASON="$ROOT/reason"
SITE="$ROOT/site"

# shellcheck source=../reason/ensure-opam.sh
source "$REASON/ensure-opam.sh"

cd "$REASON"
ensure_reason_opam melange || {
  echo "dune/melange not available (opam switch bar2psi-reason + opam install . --deps-only)" >&2
  exit 1
}

dune build @melange-web

SRC="$REASON/_build/default/web/dist"
DEST="$SITE/js"
rm -rf "$DEST"
mkdir -p "$DEST"
# Melange emit layout: web/Site.mjs, shared/, node_modules/
cp -a "$SRC"/. "$DEST"/

echo "site JS → $DEST (open $SITE/index.html via a local static server)"
