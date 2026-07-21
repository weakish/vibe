#!/usr/bin/env bash
# Build all bar2psi variants and print executable sizes for the current platform.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ZIG_BIN="$ROOT/zig/bar2psi"
LUA_BIN="$ROOT/lua/bar2psi"
GO_BIN="$ROOT/goblin/bar2psi"

GOBLIN_SRC="${GOBLIN_SRC:-}"
GOBLIN_COMMIT=14a7a3faa9da

build_zig() {
  command -v zig >/dev/null || { echo "skip zig: zig not in PATH" >&2; return 1; }
  (cd "$ROOT/zig" && zig build-exe -O ReleaseSmall -fstrip -fsingle-threaded bar2psi.zig)
}

build_lua() {
  command -v clx >/dev/null || { echo "skip lua: clx not in PATH" >&2; return 1; }
  (cd "$ROOT/lua" && clx bar2psi.lua --output bar2psi)
}

ensure_goblin_src() {
  if [ -n "$GOBLIN_SRC" ] && [ -d "$GOBLIN_SRC/.git" ]; then
    return 0
  fi
  GOBLIN_SRC="${TMPDIR:-/tmp}/goblin-src"
  if [ ! -d "$GOBLIN_SRC/.git" ]; then
    git clone https://github.com/aisk/goblin "$GOBLIN_SRC"
    git -C "$GOBLIN_SRC" checkout "$GOBLIN_COMMIT"
  fi
}

build_goblin() {
  command -v goblin >/dev/null || { echo "skip goblin: goblin not in PATH (go install github.com/aisk/goblin@latest)" >&2; return 1; }
  ensure_goblin_src
  (
    cd "$GOBLIN_SRC"
    GOFLAGS='-ldflags=-s -w' goblin build-exe "$ROOT/goblin/bar2psi.goblin" -o "$GO_BIN"
  )
  strip "$GO_BIN" 2>/dev/null || true
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

echo "== bar2psi build-all ($(uname -s) $(uname -m)) =="

ZIG_OK=0 LUA_OK=0 GO_OK=0
build_zig && ZIG_OK=1 || true
build_lua && LUA_OK=1 || true
build_goblin && GO_OK=1 || true

echo
echo "== smoke test (zig reference: 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi) =="
[ "$ZIG_OK" = 1 ] && "$ZIG_BIN" 2.5 || true
[ "$LUA_OK" = 1 ] && "$LUA_BIN" 2.5 || true
[ "$GO_OK" = 1 ] && echo 2.5 | "$GO_BIN" || true

echo
echo "== executable sizes =="
printf "| Language | Bytes | Approx | vs Zig |\n"
printf "|----------|------:|-------:|-------:|\n"

ZIG_SIZE=""
[ "$ZIG_OK" = 1 ] && ZIG_SIZE="$(size_bytes "$ZIG_BIN")"
[ "$LUA_OK" = 1 ] && LUA_SIZE="$(size_bytes "$LUA_BIN")"
[ "$GO_OK" = 1 ] && GO_SIZE="$(size_bytes "$GO_BIN")"

if [ -n "$ZIG_SIZE" ]; then
  printf "| Zig | %s | %s | 1.00x |\n" "$ZIG_SIZE" "$(fmt_kb "$ZIG_SIZE")"
fi
if [ -n "${LUA_SIZE:-}" ]; then
  printf "| Lua (clx) | %s | %s | %s |\n" "$LUA_SIZE" "$(fmt_kb "$LUA_SIZE")" "$(ratio_vs_zig "$ZIG_SIZE" "$LUA_SIZE")"
fi
if [ -n "${GO_SIZE:-}" ]; then
  printf "| Go (goblin, stripped) | %s | %s | %s |\n" "$GO_SIZE" "$(fmt_kb "$GO_SIZE")" "$(ratio_vs_zig "$ZIG_SIZE" "$GO_SIZE")"
fi
