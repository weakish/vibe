# bar -> psi converter (multi-language executable-size comparison)

The same `bar` -> `psi` converter implemented in several languages, each
compiled to a single native (or Deno-bundled) executable, to compare binary
sizes. The interesting pair is **clx (Teal→Lua) vs Zig**; **Go (via goblin)**
is the baseline (expected largest among AOT natives). Reason adds an OCaml
native build plus a Melange→JS path frozen with `deno compile`.

Conversion constant: `psi = bar * 14.503773773022` (from `100000 Pa / 6894.757293168 Pa`).

All CLIs print the same format, e.g.
`2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi`
(psi, psi × 9/10, psi × 3/4), using shortest round-trip decimal formatting
(Zig `{d}` / Goblin Go `FormatFloat('f', -1)` / Lua and Reason helpers
intended to match). The Lua/Reason helpers scan fixed `'f'` precisions rather
than Go/Zig's shortest-decimal algorithm, so output could theoretically
diverge for some `f64` values; none observed for bar inputs in smoke tests.

## Layout

| Path | Language | Toolchain |
|------|----------|-----------|
| `zig/bar2psi.zig` | Zig | `zig` (native AOT) |
| `lua/bar2psi.tl` | Teal → Lua 5.5 | `tl gen` then `clx` (AOT Lua → C++20 → native) |
| `goblin/bar2psi.goblin` | Goblin | `goblin` (transpiles to Go, then `go build`) |
| `reason/` | Reason | dune + ocamlopt (native); Melange → `deno compile` (JS binary) |
| `site/` | Melange + DOM | Static article + bar→psi calculator (vanilla DOM, no React) |

Edit `lua/bar2psi.tl` only for the Lua port. `tl gen --check bar2psi.tl` writes
`lua/bar2psi.lua` (gitignored; not committed). Run `tl gen` before `clx` (or
use `./build-all.sh`).

Zig, Lua, Reason, and Goblin read the bar value from a CLI argument.

## Reproducibility

From this directory:

```sh
./build-all.sh
```

The script builds every variant available on the current machine, runs a smoke
test against the expected `2.5 bar = …` line (requires Zig; fails on mismatch
or crash), and prints executable-size tables. Set `GOBLIN_SRC` to a goblin
checkout already at the `GOBLIN_COMMIT` pin in `build-all.sh` to skip cloning;
a different HEAD skips Goblin (no `/tmp` fallback).

## Build + run

### Zig
```sh
cd zig
zig build-exe -O ReleaseSmall -fstrip -fsingle-threaded bar2psi.zig
./bar2psi 2.5        # 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi
```
Written for Zig 0.16.0 (new `std.process.Init` main signature and `std.Io` writer).

### Teal → Lua via clx
Needs `tl` (`luarocks install teal`) and `clx` (see below).

```sh
cd lua
tl gen --check bar2psi.tl   # typecheck + write bar2psi.lua (gitignored)
clx bar2psi.lua --output bar2psi
./bar2psi 2.5        # 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi
```
`tlconfig.lua` sets `gen_target = "5.4"` and `gen_compat = "off"` (closest Teal
target to clx’s Lua 5.5; no compat53 shims).

Build clx from source (`git clone https://github.com/samyeyo/clx && cd clx &&
./build.sh install`). After `cmake --install`, if compiling fails with
`clx_simd.h` not found: upstream's `CMakeLists.txt` only installs `clx.h` and
`clx_runtime.h`, but `clx.h` `#include`s `clx_simd.h`. Copy it manually, e.g.
`cp include/clx_simd.h /usr/local/include/` (or your install prefix). Do NOT
pass `--minimal`: it drops the `io`/`os`/`string` libraries this script uses.
clx has no `io.stderr`, so the usage message is written via `io.write`.

**macOS (Intel)** — clx pins the C++ compiler path at build time. If `clx
bar2psi.lua` fails with `'cstdint' file not found`, the embedded Xcode `c++`
isn't picking up the SDK headers. Either export the SDK before compiling:

```sh
export SDKROOT="$(xcrun --show-sdk-path)"
clx bar2psi.lua --output bar2psi
```

or rebuild clx with the `/usr/bin/c++` wrapper:
`cmake -S . -B build -DCMAKE_CXX_COMPILER=/usr/bin/c++ && cmake --build build`.
You may also see harmless linker warnings about the macOS deployment target
(14.8 vs 14.0).

### Goblin (Go baseline)
```sh
go install github.com/aisk/goblin@c6f7001043e00275fc66eafb5c400db3789cee1c
cd goblin
GOFLAGS='-ldflags=-s -w' goblin build-exe bar2psi.goblin
strip bar2psi
./bar2psi 2.5    # 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi
```

Needs Goblin `c6f7001` for `os.argv()` and builtin `eprint`. Its versioned
`go install` binary derives the generated runtime requirement from build info,
so `build-exe` works outside a Goblin checkout. Usage and parse errors go to
stderr via `eprint`. The Goblin step in `build-all.sh` needs `git` and Go: it
checks out and runs this pin itself, so it does not depend on whichever
`goblin` happens to be on `PATH`.

### Reason (native + Deno JS binary)
Needs an opam switch with `dune`, `melange`, and `reason` (see
`reason/bar2psi.opam`). Deno is only required for the JS binary. A switch named
`bar2psi-reason` is picked up automatically by `reason/ensure-opam.sh` when the
current env cannot build Reason targets:

```sh
opam switch create bar2psi-reason 5.2.1
eval $(opam env --switch=bar2psi-reason)
cd reason && opam install . --deps-only
```

```sh
cd reason
./build.sh native   # ocamlopt only (no deno)
./build.sh js       # Melange → deno compile (needs deno)
./build.sh          # native; js if deno is on PATH (Melange errors fail)
./bar2psi 2.5       # ocamlopt native
./bar2psi-js 2.5    # Melange ES modules → deno compile
```

Shared conversion lives in `reason/shared/Convert.re`. The native CLI is
`reason/native/Bar2psi.re` (`Sys.argv`); the Melange entry is
`reason/Bar2psi_js.re` (`Deno.args`). Native builds with dune's custom
`release_small` profile (`-O2 -noassert`, no `-g`/`-O3`); Melange uses the
default profile. From `_build/default/dist`, `deno check` validates the Melange
emit, then `deno compile --no-check` bundles it (check once, skip re-check on
compile); both use `--node-modules-dir=manual` so Melange’s `node_modules`
layout resolves.

### Site (article + calculator)
Static page under `site/` with a Melange vanilla-DOM calculator that reuses
`reason/shared/Convert.re` (ψ / ψ×9/10 / ψ×3/4 in green / yellow / red):

```sh
cd site && ./build.sh
python3 -m http.server 8080   # from site/; open http://localhost:8080
```

`site/build.sh` runs `dune build @melange-web` and copies the emit into
`site/js/` (gitignored). Serve over HTTP so ES modules and the import map
resolve.

### Cursor Cloud dev VM notes

The clx step below was debugged on a **Cursor Cloud development VM** (Linux
x86_64). It is not required on every machine; use it when building in that
environment.

**clx** — On the Cloud
dev VM, `/etc/alternatives/c++` points at a broken `clang++`, so configure clx
with g++:

```sh
cmake -S . -B build -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ && cmake --build build
```

(See **Teal → Lua via clx** above for install, `clx_simd.h`, and `--minimal` notes.)

## Executable size comparison

Release/size-optimized builds (`zig -O ReleaseSmall -fstrip`, clx default,
`goblin build-exe` with `-ldflags=-s -w` plus `strip`). Re-run `./build-all.sh`
to refresh numbers on your platform.

### Linux x86_64 (Cursor Cloud dev VM)

Measured 2026-07-17 on commit `5f589d7` via `./build-all.sh` (zig 0.16.0, clx
0.1.0, goblin `14a7a3faa9da`, Go 1.22.2).

| Language (toolchain) | Size (bytes) | Approx | vs Zig | Linking |
|----------------------|-------------:|-------:|-------:|---------|
| Zig                  | 160,888      | ~157 KB | 1.00x | static, self-contained |
| Teal→Lua (clx)       | 186,776      | ~182 KB | 1.16x | dynamic (libstdc++, libm, libc) |
| Go (goblin, stripped)| 2,095,288   | ~2.0 MB | 13.02x | dynamic (libc) |

### macOS (Darwin x86_64)

Measured 2026-07-17 on commit `5f589d7` via `./build-all.sh` (zig 0.16.0, clx
0.1.0, goblin `14a7a3faa9da`, Go 1.26.5).

| Language (toolchain) | Size (bytes) | Approx | vs Zig | Linking |
|----------------------|-------------:|-------:|-------:|---------|
| Zig                  | 136,284      | ~133 KB | 1.00x | static, self-contained |
| Teal→Lua (clx)       | 302,144      | ~295 KB | 2.22x | dynamic (libc++, libSystem) |
| Go (goblin, stripped)| 2,512,824   | ~2.45 MB | 18.44x | dynamic (libc) |

### Takeaways

- On Linux, clx and Zig are in the same ballpark; Zig is ~14% smaller than clx
  AND fully static (clx's 182 KB excludes the libstdc++/libm it loads at
  runtime).
- On macOS Intel, clx is ~2.2× Zig — still far smaller than Go, but a wider gap
  than on Linux (libc++/runtime differences).
- Go (goblin) is an order of magnitude larger even after stripping (~13× on
  Linux, ~18× on macOS) — it bundles the Go runtime + GC. Confirms Go as the
  heavyweight baseline.
- Absolute sizes vary by OS and linker; compare within a platform, not across.

## Known gaps

### FIXME

- Error handling diverges: Zig/Goblin/Reason distinguish bad input; Lua treats
  `tonumber` failure like a missing arg (`usage:` only). Zig, Goblin, and both
  Reason builds write errors to stderr; Lua/clx still uses stdout (`io.write`)
  because clx has no `io.stderr`.
- Lua/Reason `fmt` is only an approximation of Zig `{d}` / Go shortest-decimal;
  fine for smoke-test bar values, fragile if identical output is treated as a
  hard invariant.
- macOS “Zig = static, self-contained” is overstated: Zig still links
  `libSystem`. Prefer “no libc++” over “fully static” on Darwin.
- Byte counts are not apples-to-apples across toolchains: Zig is mostly
  static; clx links libc++/libstdc++ (and libm on Linux) at runtime, so its
  on-disk size excludes shared libs the binary still needs.
- Size tables cover Linux x86_64 and macOS Intel only; no arm64 (or other
  arches) yet.
- Repo hygiene: built binaries (`bar2psi`, `bar2psi-js`), Teal output
  (`lua/bar2psi.lua`), Dune `_build/`, and leftover goblin artifacts
  (`bar2psi.{ldflags,stripped,unstripped}`) are gitignored; clean them up
  locally as needed.

### TODO

- Deduplicate the conversion constant `14.503773773022` (hardcoded in several
  sources).
- Expand smoke beyond `2.5`.
- Bump `lua/tlconfig.lua` `gen_target` from `"5.4"` to `"5.5"` once a Teal
  release ships that target (already on `master` via
  [teal-language/tl#1122](https://github.com/teal-language/tl/pull/1122); not
  in v0.24.8).
