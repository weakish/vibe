# Review: `3653720` — gitignore Teal Lua output

**Commit:** `36537206071904b3a28636e333778d2d000db6a9`  
**Subject:** `:zzz:bar2psi: gitignore Teal Lua output`  
**Reviewed:** 2026-07-21

## Verdict

**Agree.** Right hygiene after making Teal the source of truth: stop tracking
`tl gen` output so `.tl` and committed `.lua` cannot drift. Docs and
`.gitignore` stay in sync; `build-all.sh` already regenerates before `clx`.

## What works

- Narrow ignore (`lua/bar2psi.lua`), not a blanket `*.lua`
- README layout, build steps, and FIXME hygiene all say the same thing
- Bake-off path still works: `tl gen --check` then `clx` (both required)

## Nits

- `Suggested-by: weakish` on a commit authored by weakish is redundant
  self-attribution; harmless, just noise in the trailer block
- Intentional tradeoff: plain `clx bar2psi.lua` without `tl` no longer works
  from a clean tree — documented; fine for this experiment

## Follow-ups

None for this commit. Related: bump `gen_target` to `"5.5"` when Teal releases
it (tracked under README TODO).
