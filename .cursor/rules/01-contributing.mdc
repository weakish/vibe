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

Git `Author` is always the human. Never set the agent as author.

When they apply, trailers in this order:

1. `Reported-by: Name <email>` — someone else reported a bug this commit
   fixes
2. `Suggested-by: Name <email>` — someone else suggested the idea or
   approach
3. `Assisted-by: AGENT_NAME:MODEL_VERSION` — an AI agent produced or
   materially edited the tree

`Assisted-by` is required on every commit an AI agent materially helped
produce. Follows the
[Linux kernel AI coding assistants guidance](https://docs.kernel.org/process/coding-assistants.html).
Message-only rewrites do not qualify — see below.

```
Assisted-by: AGENT_NAME:MODEL_VERSION [TOOL1] [TOOL2]
```

- `AGENT_NAME` — the AI tool or framework (e.g. `Cursor`, `Claude Code`, `Copilot`)
- `MODEL_VERSION` — the model that helped **this** commit’s tree (e.g. `gpt-5.6`, `cursor-grok-4.5`). For a new commit, take it from the current session identity, not from a different commit. Message-only rewrite and amend union: see below.
- `[TOOL1] [TOOL2]` — optional specialized analysis tools only (e.g. `coccinelle`, `sparse`, `clang-tidy`)

Do not list basic development tools (git, compilers, make, editors).

```
:new:foo: scaffold Deno CLI

Assisted-by: Cursor:cursor-grok-4.5
```

- For a **new** commit this session produced: write `Assisted-by` from this session’s agent/model. Do **not** copy a line from `git log`, a different commit, or examples — those often name a different model.
- Message-only rewrite (same tree): keep the existing lines; do not add this session if absent.
- When **amending** a commit to add tree this session produced: union this session’s `AGENT_NAME:MODEL_VERSION` with that commit’s existing `Assisted-by` lines (one line per pair; dedupe exact duplicates). Do not drop the original model.

`Reported-by` and `Suggested-by` name **humans** only — never an agent. Agent
help (including when the user asks an agent to review code) belongs in
`Assisted-by`.

- `Reported-by`: on a `:bug:` fix for a bug the **user** reported and you confirmed valid. Use the reporter’s usual git identity. Do **not** add it when you found the bug without a user report, or when you disagreed and did not fix it.
- `Suggested-by`: when a **human** suggested the idea or approach. Use their usual git identity. Do **not** add it for generic “please fix / please implement” without a substantive suggestion, or when you invented the approach alone.

Never add `Co-authored-by` (or `Co-Authored-By`) naming an agent or bot, e.g.
`Cursor <cursoragent@cursor.com>`. Leave legitimate human `Co-authored-by`
untouched. Do not force-push `master`.

This repo's Cursor hook `.cursor/hooks/strip-agent-coauthor.py`
(`.cursor/hooks.json`, `preToolUse` and `postToolUse`) strips injected Cursor
agent `Co-authored-by` trailers (`cursoragent@cursor.com`). After changing the
hook or its tests, run `python3 -B .cursor/hooks/test_strip_agent_coauthor.py`.

#### Message-only rewrite

Same tree, new commit object — polish message or strip bad trailers. The diff to
the parent must stay identical; do not fold staged or working-tree path changes
into the rewrite. No pathspec, so the index is ignored:

```
git commit --amend --only -m "$(cat <<'EOF'
…message…
EOF
)"
```

- Keep existing `Assisted-by` line(s). Do **not** replace with the rewriting session’s model.
- Do **not** add `Assisted-by` for the rewriter when absent — rewriting the message is not producing the diff.
- Strip agent/bot `Co-authored-by`; leave legitimate human `Co-authored-by` untouched.
- Do not drop `Reported-by` / `Suggested-by` when they still apply; correct them when hygiene requires it (see above).

Agent-only rules in the rest of these instructions add constraints; they do
not replace this section.
