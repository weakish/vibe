# bar -> psi converter (three languages, executable-size comparison)

The same `bar` -> `psi` converter implemented in three languages, each compiled
to a single native executable, to compare binary sizes. The interesting pair is
**clx (Lua) vs Zig**; **Go (via goblin)** is the baseline (expected largest).

Conversion constant: `psi = bar * 14.503773773022` (from `100000 Pa / 6894.757293168 Pa`).

All three CLIs print the same format, e.g.
`2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi`
(psi, psi × 9/10, psi × 3/4), using shortest round-trip decimal formatting
(Zig `{d}` / Goblin Go `FormatFloat('f', -1)` / Lua helper intended to match).
The Lua helper scans fixed `'f'` precisions rather than Go/Zig's
shortest-decimal algorithm, so output could theoretically diverge for some
`f64` values; none observed for bar inputs in smoke tests.

## Layout

| Path | Language | Toolchain |
|------|----------|-----------|
| `zig/bar2psi.zig` | Zig | `zig` (native AOT) |
| `lua/bar2psi.lua` | Lua 5.5 | `clx` (AOT Lua -> C++20 -> native) |
| `goblin/bar2psi.goblin` | Goblin | `goblin` (transpiles to Go, then `go build`) |

The Zig and Lua versions read the bar value from a CLI argument. Goblin has no
argv API, so it reads stdin (`echo <bar> | bar2psi`) instead.

## Reproducibility

From this directory:

```sh
./build-all.sh
```

The script builds every variant available on the current machine, runs a smoke
test, and prints an executable-size table. Set `GOBLIN_SRC` to an existing
goblin checkout to skip cloning.

## Build + run

### Zig
```sh
cd zig
zig build-exe -O ReleaseSmall -fstrip -fsingle-threaded bar2psi.zig
./bar2psi 2.5        # 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi
```
Written for Zig 0.16.0 (new `std.process.Init` main signature and `std.Io` writer).

### Lua via clx
```sh
cd lua
clx bar2psi.lua --output bar2psi
./bar2psi 2.5        # 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi
```
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
go install github.com/aisk/goblin@latest
cd goblin
goblin build-exe bar2psi.goblin
strip bar2psi
echo 2.5 | ./bar2psi    # 2.5 bar = 36.259434432555004 32.6334909892995 27.194575824416255 psi
```

Input is read from `/dev/stdin` (Unix only: Linux/macOS). Usage and parse
errors go to stdout via `print`, like Lua/clx; Zig writes those to stderr.

Or use `GOFLAGS='-ldflags=-s -w'` when invoking `goblin build-exe` (as
`build-all.sh` does) and `strip` afterwards.

### Cursor Cloud dev VM notes

The clx and goblin steps below were debugged on a **Cursor Cloud development
VM** (Linux x86_64). They are not required on every machine; use them when
building in that environment.

**clx** — On the Cloud
dev VM, `/etc/alternatives/c++` points at a broken `clang++`, so configure clx
with g++:

```sh
cmake -S . -B build -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ && cmake --build build
```

(See **Lua via clx** above for install, `clx_simd.h`, and `--minimal` notes.)

**goblin** — known upstream issue: `goblin build-exe` pins an older runtime
(`defaultGoblinRuntimeVersion`) than the transpiler emits, so a plain run fails
with `undefined: object.CallArgs`. Workaround: run `build-exe` from inside a
checkout of the matching goblin commit (the transpiler adds a local `replace`
directive when it finds a goblin source tree):

```sh
git clone https://github.com/aisk/goblin ~/goblin-src
cd ~/goblin-src && git checkout 14a7a3faa9da     # == installed CLI commit
GOFLAGS='-ldflags=-s -w' goblin build-exe /abs/path/to/bar2psi.goblin -o /abs/path/to/bar2psi
strip /abs/path/to/bar2psi
```

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
| Lua (clx)            | 186,776      | ~182 KB | 1.16x | dynamic (libstdc++, libm, libc) |
| Go (goblin, stripped)| 2,095,288   | ~2.0 MB | 13.02x | dynamic (libc) |

### macOS (Darwin x86_64)

Measured 2026-07-17 on commit `5f589d7` via `./build-all.sh` (zig 0.16.0, clx
0.1.0, goblin `14a7a3faa9da`, Go 1.26.5).

| Language (toolchain) | Size (bytes) | Approx | vs Zig | Linking |
|----------------------|-------------:|-------:|-------:|---------|
| Zig                  | 136,284      | ~133 KB | 1.00x | static, self-contained |
| Lua (clx)            | 302,144      | ~295 KB | 2.22x | dynamic (libc++, libSystem) |
| Go (goblin, stripped)| 2,512,824   | ~2.45 MB | 18.44x | dynamic (libc) |

### Takeaways

- On Linux, clx and Zig are in the same ballpark; Zig is ~14% smaller than clx
  AND fully static (clx's 182 KB excludes the libstdc++/libm it loads at
  runtime).
- On macOS Intel, clx is ~2.2× Zig — still far smaller than Go, but a wider gap
  than on Linux (libc++/runtime differences).
- Go (goblin) is an order of magnitude larger even after stripping (~13× on
  Linux, ~18× on macOS) — it bundles the Go runtime + GC, and grows further
  with `fs`/`os` for stdin input. Confirms Go as the heavyweight baseline.
- Absolute sizes vary by OS and linker; compare within a platform, not across.

## Known gaps

### FIXME

- CLI surface is not comparable: Zig/Lua take argv; Goblin reads stdin and
  pulls in `fs`/`os`, which inflates the Go binary and muddies “same program,
  different language.” Goblin is Unix-only (`/dev/stdin`); Windows repro needs
  a code change.
- Error handling diverges: Zig/Goblin distinguish bad input; Lua treats
  `tonumber` failure like a missing arg (`usage:` only). Zig writes errors to
  stderr; Lua/Goblin write them to stdout.
- Lua `fmt` is only an approximation of Zig `{d}` / Go shortest-decimal; fine
  for smoke-test bar values, fragile if identical output is treated as a hard
  invariant.
- macOS “Zig = static, self-contained” is overstated: Zig still links
  `libSystem`. Prefer “no libc++” over “fully static” on Darwin.
- Byte counts are not apples-to-apples across toolchains: Zig is mostly
  static; clx links libc++/libstdc++ (and libm on Linux) at runtime, so its
  on-disk size excludes shared libs the binary still needs.
- Size tables cover Linux x86_64 and macOS Intel only; no arm64 (or other
  arches) yet.
- Repo hygiene: built binaries and leftover goblin artifacts
  (`bar2psi.{ldflags,stripped,unstripped}`) sit next to source; keep them
  gitignored and cleaned up.

### TODO

- Deduplicate the conversion constant `14.503773773022` (hardcoded in three
  sources).
- Expand smoke beyond `2.5`; make `build-all.sh` fail if the three outputs
  differ.
- Upstream goblin `build-exe` still needs a matching source-checkout workaround
  (see `upstream-goblin-build-exe-runtime-mismatch.md`); drop the workaround
  once fixed.
