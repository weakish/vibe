# Teal nil-safety (and Pallene)

Notes from adopting Teal for the `bar2psi` Lua/clx path. Teal is used here for
static checking while keeping Lua-shaped source; do not expect nil-safety from
the type checker.

## Teal: every type is nilable

Teal documents this in [local variables](https://teal-language.org/book/latest/local_variables.html):

> Every type in Teal accepts nil as a valid value, even if, like in Lua,
> attempting to use it with some operations would cause a runtime error, so be
> aware!

In the subtype relation, `nil <: T` for all `T`. So `local x: number; x = nil`
typechecks, and annotating `number | nil` is redundant with plain `number`
today.

The stdlib reflects that choice. For example
[`stdlib.d.tl`](https://github.com/teal-language/tl/blob/main/teal/default/stdlib.d.tl)
defines:

```teal
tonumber: function(any): number
```

Lua's `tonumber` returns `nil` on failure; Teal does not use the return type to
force a nil check. The same pattern applies to other “fail” APIs (`io.open`,
`load`, etc.).

### Why Teal does this

Teal is **typed Lua** (successor to Typed Lua), optimized for incremental
annotation and Lua idioms, not for Rust/TypeScript-style nil safety.

Maintainers and contributors frame the tradeoff as:

- **Lua centrality** — `nil` is the usual failure value; guarding it is normal
  Lua style (`if f then`, `if x == nil then`).
- **Ergonomics** — real nil-safety needs unwrap syntax, flow narrowing, and
  decisions about `t[i]` (always potentially `nil` in Lua). Without that,
  strict types become noisy ([discussion #339](https://github.com/teal-language/tl/discussions/339)).
- **Interop** — gradual typing over existing Lua codebases and `.d.tl` stubs;
  strict non-nilable types would break or complicate migration.
- **What you still get** — wrong fields, bad call arity/types, record/map shape
  errors; nil bugs remain your problem at runtime.

Open thread: [issue #598 “Every type contains nil”](https://github.com/teal-language/tl/issues/598)
(👍 14). No shipped fix yet; proposals include opt-in strict nil checking.

### Implication for `bar2psi.tl`

The `if bar == nil then` guard after `tonumber(arg[1])` is **runtime Lua
correctness** for clx, not something Teal's types enforce. Treat Teal here as
catching structural mistakes, not CLI parse failures.

## Pallene: stricter, performance-first subset

[Pallene](https://github.com/pallene-lang/pallene) is a **typed subset of Lua**
compiled AOT to C. It shares Lua's runtime but restricts what you can write so
the compiler can generate predictable native code.

### Nil model

| | Teal | Pallene |
|---|------|---------|
| Goal | Type-check Lua/Teal incrementally | Fast companion modules for Lua |
| `nil` vs `T` | `nil` is a subtype of every `T` | `nil` is only the type `nil` (plus `any`) |
| `{number}` elements | May be `nil` at compile time | **Cannot** be `nil`; `{nil}` invalid |
| `tonumber` / missing-arg patterns | Annotated `: number`; no forced guard | No optional types; Lua “nil means missing arg” idioms often **invalid** |
| OOB `arr[i]` | Lua `nil`, typed as `number` | Runtime **type error** unless element type is `any` |
| Values from Lua | Assumed nilable everywhere | **Runtime tag checks** at the boundary |
| Soundness on nil | Intentionally unsound (Typed Lua lineage) | Stricter in Pallene code; errors at boundary or on tag mismatch |

Pallene's manual ([arrays](https://github.com/pallene-lang/pallene/blob/master/doc/manual.md)):

> Like Lua, reading from an "out of bounds" index produces `nil`, which results
> in a run-time type error unless the type of the array elements is `any`.
> Notice that Pallene doesn't accept arrays of nil.

The Pallene thesis (Gualandi, 2020) states explicitly that **Typed Lua** kept
array elements nullable to accommodate Lua (out-of-bounds → `nil`, sparse
tables), which complicates optimization. Pallene **rejects** that flexibility:
fewer Lua idioms, better AOT performance and stricter in-module typing.

There is no `T?` or `number | nil` optional type in Pallene. Optional
function parameters are limited (often `any` at the FFI boundary). Patterns like
`x and y or z` for defaults do not typecheck on non-`any` types when `x` could
be `nil` or `false`.

### When to pick which

- **Teal** — annotate existing Lua, `tl gen` → Lua, normal Lua toolchain (here:
  clx). Accept nil-un-safety; keep Lua control flow and libraries.
- **Pallene** — rewrite hot paths as a Pallene module, compile to `.so`, call
  from Lua. Accept language subset + patched Lua build; gain stricter types and
  native speed, not full Lua expressiveness.

For this repo's size bake-off, Teal + clx matches “typed Lua → native binary.”
Pallene would be a different experiment (Pallene AOT, not clx on `tl` output).

## References

- Teal book: [local variables / nil](https://teal-language.org/book/latest/local_variables.html)
- Teal: [discussion #339 — Much ado about nil](https://github.com/teal-language/tl/discussions/339)
- Teal: [issue #598 — Every type contains nil](https://github.com/teal-language/tl/issues/598)
- Pallene: [language manual](https://github.com/pallene-lang/pallene/blob/master/doc/manual.md)
- Pallene thesis: [Companion Languages for Lua (Gualandi, 2020)](http://www.lua.inf.puc-rio.br/publications/2020-HugoGualandi-phd-thesis.pdf) — §2.3 contrasts Typed Lua nilability with Pallene
