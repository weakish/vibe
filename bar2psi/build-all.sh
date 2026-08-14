#!/usr/bin/env bash
# Build all bar2psi variants and print executable sizes for the current platform.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ZIG_BIN="$ROOT/zig/bar2psi"
LUA_BIN="$ROOT/lua/bar2psi"
GO_BIN="$ROOT/goblin/bar2psi"
REASON_BIN="$ROOT/reason/bar2psi"
REASON_JS_BIN="$ROOT/reason/bar2psi-js"

GOBLIN_SRC="${GOBLIN_SRC:-}"
GOBLIN_COMMIT=c6f7001043e00275fc66eafb5c400db3789cee1c
SMOKE_BAR=2.5
SMOKE_EXPECTED="${SMOKE_BAR} bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi"

build_zig() {
  command -v zig >/dev/null || { echo "skip zig: zig not in PATH" >&2; return 1; }
  (cd "$ROOT/zig" && zig build-exe -O ReleaseSmall -fstrip -fsingle-threaded bar2psi.zig)
}

build_lua() {
  command -v tl >/dev/null || { echo "skip lua: tl not in PATH (luarocks install teal)" >&2; return 1; }
  command -v clx >/dev/null || { echo "skip lua: clx not in PATH" >&2; return 1; }
  (cd "$ROOT/lua" && tl gen --check bar2psi.tl && clx bar2psi.lua --output bar2psi)
}

ensure_goblin_src() {
  if [ -n "$GOBLIN_SRC" ]; then
    # -e: .git may be a dir (clone) or file (worktree)
    if [ ! -e "$GOBLIN_SRC/.git" ]; then
      echo "skip goblin: GOBLIN_SRC is not a git checkout: $GOBLIN_SRC" >&2
      return 1
    fi
    local goblin_head goblin_want
    if ! goblin_head="$(git -C "$GOBLIN_SRC" rev-parse --quiet --verify "HEAD^{commit}")"; then
      echo "skip goblin: cannot resolve GOBLIN_SRC HEAD: $GOBLIN_SRC" >&2
      return 1
    fi
    if ! goblin_want="$(git -C "$GOBLIN_SRC" rev-parse --quiet --verify "${GOBLIN_COMMIT}^{commit}")"; then
      echo "skip goblin: GOBLIN_COMMIT not in GOBLIN_SRC ($GOBLIN_SRC): $GOBLIN_COMMIT" >&2
      return 1
    fi
    if [ "$goblin_head" != "$goblin_want" ]; then
      echo "skip goblin: GOBLIN_SRC at $goblin_head, want $goblin_want" >&2
      return 1
    fi
    return 0
  fi
  GOBLIN_SRC="${TMPDIR:-/tmp}/goblin-src"
  if [ ! -e "$GOBLIN_SRC/.git" ]; then
    git clone https://github.com/aisk/goblin "$GOBLIN_SRC" || return 1
  fi
  if ! git -C "$GOBLIN_SRC" cat-file -e "${GOBLIN_COMMIT}^{commit}" 2>/dev/null; then
    git -C "$GOBLIN_SRC" fetch --quiet origin "$GOBLIN_COMMIT" || return 1
  fi
  git -C "$GOBLIN_SRC" checkout --quiet "$GOBLIN_COMMIT" || return 1
}

build_goblin() {
  command -v go >/dev/null || { echo "skip goblin: go not in PATH" >&2; return 1; }
  command -v git >/dev/null || { echo "skip goblin: git not in PATH (needed to pin GOBLIN_COMMIT)" >&2; return 1; }
  ensure_goblin_src || return 1
  (
    # Subshell is in `|| return 1`, so bash does not apply set -e here.
    cd "$GOBLIN_SRC" || exit 1
    # GOBLIN_ROOT overrides cwd, so do not let a caller replace this pin.
    unset GOBLIN_ROOT
    # Run the checkout itself so the compiler and local runtime stay pinned together.
    GOFLAGS='-ldflags=-s -w' go run . build-exe "$ROOT/goblin/bar2psi.goblin" -o "$GO_BIN"
  ) || return 1
  strip "$GO_BIN" 2>/dev/null || true
}

build_reason_native() {
  BAR2PSI_REASON_FROM_ALL=1 "$ROOT/reason/build.sh" native
}

build_reason_js() {
  BAR2PSI_REASON_FROM_ALL=1 "$ROOT/reason/build.sh" js
}

size_bytes() {
  if [ -f "$1" ]; then
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
  fi
}

ratio_vs_zig() {
  awk -v zig="$1" -v other="$2" 'BEGIN { if (zig > 0) printf "%.2fx", other / zig; else print "n/a" }'
}

fmt_kb() {
  awk -v n="$1" 'BEGIN { printf "~%.0f KB", n / 1024 }'
}

run_smoke() {
  local label="$1"
  shift
  local out ec
  set +e
  out="$("$@")"
  ec=$?
  set -e
  if [ "$ec" -ne 0 ]; then
    echo "smoke crash ($label): exit $ec" >&2
    SMOKE_FAILED=1
    return 0
  fi
  if [ "$out" != "$SMOKE_EXPECTED" ]; then
    echo "smoke mismatch ($label):" >&2
    echo "  expected: $SMOKE_EXPECTED" >&2
    echo "  got:      $out" >&2
    SMOKE_FAILED=1
  fi
  echo "$out"
}

echo "== bar2psi build-all ($(uname -s) $(uname -m)) =="

ZIG_OK=0 LUA_OK=0 GO_OK=0 REASON_OK=0 REASON_JS_OK=0
build_zig && ZIG_OK=1 || true
build_lua && LUA_OK=1 || true
build_goblin && GO_OK=1 || true
build_reason_native && REASON_OK=1 || true
build_reason_js && REASON_JS_OK=1 || true

echo
echo "== smoke test (expected: ${SMOKE_EXPECTED}) =="
SMOKE_FAILED=0
if [ "$ZIG_OK" != 1 ]; then
  echo "skip smoke compare: zig not built (reference required)" >&2
else
  run_smoke zig "$ZIG_BIN" "$SMOKE_BAR"
  [ "$LUA_OK" = 1 ] && run_smoke "teal/clx" "$LUA_BIN" "$SMOKE_BAR"
  [ "$GO_OK" = 1 ] && run_smoke goblin "$GO_BIN" "$SMOKE_BAR"
  [ "$REASON_OK" = 1 ] && run_smoke "reason native" "$REASON_BIN" "$SMOKE_BAR"
  [ "$REASON_JS_OK" = 1 ] && run_smoke "reason js" "$REASON_JS_BIN" "$SMOKE_BAR"
  if [ "$SMOKE_FAILED" = 1 ]; then
    echo "smoke test failed: output differs from expected or a binary crashed" >&2
    exit 1
  fi
fi

echo
echo "== AOT native executable sizes (vs Zig) =="
printf "| Language | Bytes | Approx | vs Zig |\n"
printf "|----------|------:|-------:|-------:|\n"

ZIG_SIZE=""
[ "$ZIG_OK" = 1 ] && ZIG_SIZE="$(size_bytes "$ZIG_BIN")"
[ "$LUA_OK" = 1 ] && LUA_SIZE="$(size_bytes "$LUA_BIN")"
[ "$GO_OK" = 1 ] && GO_SIZE="$(size_bytes "$GO_BIN")"
[ "$REASON_OK" = 1 ] && REASON_SIZE="$(size_bytes "$REASON_BIN")"

if [ -n "$ZIG_SIZE" ]; then
  printf "| Zig | %s | %s | 1.00x |\n" "$ZIG_SIZE" "$(fmt_kb "$ZIG_SIZE")"
fi
if [ -n "${LUA_SIZE:-}" ]; then
  printf "| Teal→Lua (clx) | %s | %s | %s |\n" "$LUA_SIZE" "$(fmt_kb "$LUA_SIZE")" "$(ratio_vs_zig "$ZIG_SIZE" "$LUA_SIZE")"
fi
if [ -n "${GO_SIZE:-}" ]; then
  printf "| Go (goblin, stripped) | %s | %s | %s |\n" "$GO_SIZE" "$(fmt_kb "$GO_SIZE")" "$(ratio_vs_zig "$ZIG_SIZE" "$GO_SIZE")"
fi
if [ -n "${REASON_SIZE:-}" ]; then
  printf "| Reason (ocamlopt) | %s | %s | %s |\n" "$REASON_SIZE" "$(fmt_kb "$REASON_SIZE")" "$(ratio_vs_zig "$ZIG_SIZE" "$REASON_SIZE")"
fi

if [ "$REASON_JS_OK" = 1 ]; then
  echo
  echo "== bundled runtime executable sizes =="
  printf "| Language | Bytes | Approx | Note |\n"
  printf "|----------|------:|-------:|------|\n"
  REASON_JS_SIZE="$(size_bytes "$REASON_JS_BIN")"
  printf "| Reason→JS (deno compile) | %s | %s | embeds Deno runtime |\n" \
    "$REASON_JS_SIZE" "$(fmt_kb "$REASON_JS_SIZE")"
fi
