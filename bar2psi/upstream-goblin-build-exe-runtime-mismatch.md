# `goblin build-exe` generated a `go.mod` with an incompatible Goblin runtime

**Target project:** [aisk/goblin](https://github.com/aisk/goblin)

**Status:** fixed in Goblin `c6f7001` (`goblinRuntimeVersion` from build info).
The reproduction below is historical (`14a7a3f`).

Through `14a7a3f`, `goblin build-exe` failed when the CLI was installed
normally and run outside a Goblin source checkout. The transpiler in the
installed CLI emitted calls to the current runtime API, but the generated
`go.mod` required an older, incompatible version of `github.com/aisk/goblin`.

## Reproduction

Tested on macOS x86_64 with Go 1.26.5 and Goblin
`v0.0.0-20260716163238-14a7a3faa9da` (commit `14a7a3faa9da`). The same failure
was also seen on Linux x86_64. At the time of testing, `go install
github.com/aisk/goblin@latest` resolved to this same commit.

```sh
GOBIN="$(mktemp -d)"
export GOBIN
go install github.com/aisk/goblin@14a7a3faa9da
WORKDIR="$(mktemp -d)"
printf 'print("Hello, world!")\n' > "$WORKDIR/hello.goblin"

cd "$WORKDIR"
"$GOBIN/goblin" build-exe hello.goblin
```

This deliberately runs from a directory that is not inside a Goblin checkout.

### Expected

An installed Goblin CLI compiles the program in a clean directory (no local
Goblin checkout required), and `./hello` prints `Hello, world!` as the README
suggests.

### Actual

`build-exe` transpiles into a temporary Go module and prints the build
directory on stderr, for example:

```text
build dir: /var/folders/.../goblin-335160283
run: (cd /var/folders/.../goblin-335160283 && go build -mod=mod -o /…/hello .)
```

The generated `go.mod` in that temp directory is what pins the stale runtime.
`go build` then fails:

```text
go build -mod=mod -o /…/hello .
go: downloading github.com/aisk/goblin v0.0.0-20260224172520-e2bc1cc1d8a5
not enough arguments in call to object.Call
    have (object.Object, unknown type)
    want (object.Object, object.Args, object.KwArgs)
undefined: object.CallArgs
undefined: object.WithFrame
undefined: object.Frame
```

The README documents this workflow as succeeding:

```sh
go install github.com/aisk/goblin@latest
goblin build-exe hello.goblin
```

## Cause

At commit `14a7a3faa9da`, `transpiler/transpiler.go` contains:

```go
defaultGoblinRuntimeVersion = "v0.0.0-20260224172520-e2bc1cc1d8a5"
```

`generateGoMod` uses that value whenever `detectGoblinRoot()` cannot find a
local checkout. However, the same revision of the transpiler emits
`object.CallArgs` and the new two-argument `object.Call` invocation. The pinned
February revision does not contain `object.CallArgs`; its `object.Call`
signature is:

```go
func Call(obj Object, args Args, kwargs KwArgs) (Object, error)
```

Thus the generated source and generated dependency version are incompatible.

`detectGoblinRoot()` masks the bug when `build-exe` is run from a Goblin
checkout: it adds a `replace github.com/aisk/goblin => <local checkout>` line
to the generated `go.mod`. Normal `go install …@version` users do not have that
replace.

### History on master

- `57dea0a` (2026-02-26): *“Use real goblin runtime version in generated go.mod”*
  — introduced `defaultGoblinRuntimeVersion` and `transpiler/gomod_test.go`
  (fixing an even worse zero pseudo-version).
- `57435fe` (2026-03-09): *“Support kwargs and kwarg spread”* — runtime and
  transpiler moved toward `CallArgs` **after** the pin date.
- `86b6a05` (2026-05-07): deleted `transpiler/gomod_test.go`, removing the
  regression guard that had checked generated `go.mod` content.
- Through `14a7a3f` (2026-07-17): `defaultGoblinRuntimeVersion` was **never
  bumped**.

CI (`.github/workflows/ci.yml`) only runs `go test ./...` inside the repo
checkout. That path naturally has a Goblin `go.mod` nearby, so it **does not**
catch the `go install` → clean-dir `build-exe` failure mode.

## Resolution (`c6f7001`)

Goblin `c6f7001043e00275fc66eafb5c400db3789cee1c` sets `goblinRuntimeVersion`
from `runtime/debug.ReadBuildInfo` when the CLI was installed at a released or
pseudo-version. The generated `require github.com/aisk/goblin` follows the
installed CLI instead of drifting from the transpiler. Development builds
keep the local-checkout `replace` (`GOBLIN_ROOT` still wins over the installed
version); the hard-coded default remains the fallback when build metadata has
no usable version (`(devel)`).

bar2psi pins that revision for `os.argv()` / builtin `eprint`. A versioned
`go install` no longer needs a Goblin source checkout for `build-exe`:

```sh
go install github.com/aisk/goblin@c6f7001043e00275fc66eafb5c400db3789cee1c
GOFLAGS='-ldflags=-s -w' goblin build-exe /abs/path/to/hello.goblin -o /abs/path/to/hello
```

## Regression coverage

Add an end-to-end test that installs a versioned Goblin CLI and runs it from a
fresh temporary directory, with no Goblin checkout in its ancestor directories:

```sh
GOBIN="$(mktemp -d)"
export GOBIN
go install github.com/aisk/goblin@<version-under-test>
WORKDIR="$(mktemp -d)"
printf 'print("ok")\n' > "$WORKDIR/hello.goblin"
( cd "$WORKDIR" && "$GOBIN/goblin" build-exe hello.goblin && ./hello )
```

The test should verify that the generated module resolves a runtime compatible
with the installed CLI. In-repository tests alone can miss this because
`detectGoblinRoot()` injects a local `replace`; restoring coverage similar to
the deleted `transpiler/gomod_test.go` would also help.
