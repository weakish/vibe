---
description: Shared code and commit contract
---

## Contributing

This applies to both humans and agents.

Each top-level directory is its own project unless it opts into shared
tooling. Use that project’s README, scripts, and conventions. Do not add a
root workspace, formatter, or check pipeline, or impose another project’s
stack.

### Code

- One approach per problem. Refactor duplication instead of leaving parallel
  implementations or defaults.
- Propagate failures (throw/exit). Do not swallow errors.
- Prefer a small function with a long name over a comment that restates the
  code. Reserve comments for non-obvious details (formats, limits, platform
  quirks).

### Commits

Use [13 Short Gitmojis](https://mmap.page/dive-into/gitmoji/). Write the
emoji **code** (e.g. `:bug:`), not the glyph.

```
:<type>:[scope:] <summary>
```

Scope is optional; prefer the project directory (`:new:foo: add CLI`).
Imperative summary; first line under 50 characters when practical. Add a
body when the motive is not obvious from the diff. Trailers last.

| code | usage |
|------|--------|
| `:bug:` | bug fix |
| `:new:` | new feature |
| `:fire:` | remove a feature / API surface (not merely deleting files) |
| `:boom:` | breaking changes |
| `:lock:` | security fix |
| `:art:` | refactor |
| `:zap:` | performance |
| `:100:` | test |
| `:memo:` | doc |
| `:zzz:` | chore |
| `:tada:` | release |
| `:poop:` | dirty hack / workaround |
| `:egg:` | Easter eggs |

Do not invent other gitmoji codes.

When they apply, trailers in this order:

1. `Reported-by: Name <email>` — someone else reported a bug this commit
   fixes
2. `Suggested-by: Name <email>` — someone else suggested the idea or
   approach
3. `Assisted-by: AGENT_NAME:MODEL_VERSION` — an AI agent produced or
   materially edited the tree

Do not credit agents with `Co-authored-by`. Do not force-push `master`.

Agent-only rules in the rest of these instructions add constraints; they do
not replace this section.
